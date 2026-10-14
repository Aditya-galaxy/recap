import AppKit
import AVFoundation
import SwiftUI

enum Mode: String, CaseIterable, Identifiable {
    case screenCam, screen, cam
    var id: String { rawValue }
    var label: String { switch self { case .screenCam: "screen+cam"; case .screen: "screen"; case .cam: "cam" } }
    var usesCamera: Bool { self != .screen }
    var usesScreen: Bool { self != .cam }
}

enum Phase: Equatable {
    case idle
    case countdown(Int)
    case recording
    case paused
    case finishing
    case uploading(Double)
    case error(String)

    var isLive: Bool { self == .recording || self == .paused }
}

struct DeviceOption: Identifiable, Hashable {
    let id: String
    let name: String
}

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    private let defaults = UserDefaults.standard

    @Published var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode") } }
    @Published var cameraID: String { didSet { defaults.set(cameraID, forKey: "camera") } }
    @Published var micID: String { didSet { defaults.set(micID, forKey: "mic") } }
    @Published var micOn: Bool { didSet { defaults.set(micOn, forKey: "micOn") } }
    @Published var systemAudio: Bool { didSet { defaults.set(systemAudio, forKey: "systemAudio") } }
    @Published var bubbleSize: BubbleSize {
        didSet {
            defaults.set(bubbleSize.rawValue, forKey: "bubble")
            bubble?.resize(to: bubbleSize)
        }
    }
    @Published var server: String { didSet { defaults.set(server, forKey: "server"); connection = .unknown } }
    @Published var token: String { didSet { Keychain.write(token); connection = .unknown } }
    @Published var connection: Connection = .unknown

    enum Connection: Equatable { case unknown, checking, ok(String), failed(String) }
    @Published var displayID: CGDirectDisplayID = CGMainDisplayID()
    @Published var title = ""

    @Published var cameras: [DeviceOption] = []
    @Published var mics: [DeviceOption] = []
    @Published var displays: [DeviceOption] = []

    @Published var phase: Phase = .idle
    @Published var elapsed: TimeInterval = 0
    @Published var lastLink: URL?
    @Published var lastFile: URL?

    let camera = CameraController()
    private var bubble: BubblePanel?
    private var controlBar: ControlBarPanel?
    private var screenRecorder: ScreenRecorder?
    private var workDir: URL?
    private var ticker: Timer?
    private var segmentStart: Date?
    private var accumulated: TimeInterval = 0
    private var runID = 0

    private init() {
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? .screenCam
        cameraID = defaults.string(forKey: "camera") ?? ""
        micID = defaults.string(forKey: "mic") ?? ""
        micOn = defaults.object(forKey: "micOn") as? Bool ?? true
        systemAudio = defaults.object(forKey: "systemAudio") as? Bool ?? true
        bubbleSize = BubbleSize(rawValue: defaults.string(forKey: "bubble") ?? "") ?? .m
        server = defaults.string(forKey: "server") ?? "http://localhost:3217"
        token = Keychain.read()
    }

    func checkConnection() {
        guard let url = serverURL else { connection = .failed("Server URL is invalid."); return }
        guard !token.isEmpty else { connection = .failed("Paste an API token from Settings on your Recap server."); return }
        connection = .checking
        Task {
            do { connection = .ok(try await Uploader.check(server: url, token: token)) }
            catch { connection = .failed(error.localizedDescription) }
        }
    }

    var serverURL: URL? {
        URL(string: server.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    func refreshDevices() {
        cameras = Devices.cameras.map { DeviceOption(id: $0.uniqueID, name: $0.localizedName) }
        mics = Devices.microphones.map { DeviceOption(id: $0.uniqueID, name: $0.localizedName) }
        displays = NSScreen.screens.map { s in
            let px = s.frame.size
            return DeviceOption(id: String(s.displayID), name: "\(s.localizedName) · \(Int(px.width))×\(Int(px.height))")
        }
        if !cameras.contains(where: { $0.id == cameraID }) { cameraID = cameras.first?.id ?? "" }
        if !mics.contains(where: { $0.id == micID }) {
            micID = AVCaptureDevice.default(for: .audio)?.uniqueID ?? mics.first?.id ?? ""
        }
        if !NSScreen.screens.contains(where: { $0.displayID == displayID }) { displayID = CGMainDisplayID() }
    }

    // MARK: - Flow

    func toggle() {
        switch phase {
        case .idle, .error: Task { await start() }
        case .recording, .paused: Task { await stop() }
        case .countdown: discard()
        default: break
        }
    }

    func start() async {
        guard phase == .idle || { if case .error = phase { return true }; return false }() else { return }
        runID += 1
        let run = runID

        // Permissions first, so prompts don't land mid-countdown.
        if mode.usesScreen && !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
            phase = .error("Allow Recap in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Recap.")
            return
        }
        if mode.usesCamera, !(await AVCaptureDevice.requestAccess(for: .video)) {
            phase = .error("Camera access is off. Enable Recap in System Settings → Privacy & Security → Camera.")
            return
        }
        if micOn, !(await AVCaptureDevice.requestAccess(for: .audio)) {
            phase = .error("Microphone access is off. Enable Recap in System Settings → Privacy & Security → Microphone.")
            return
        }
        guard serverURL != nil else {
            phase = .error("Server URL is invalid.")
            return
        }
        guard !token.isEmpty else {
            phase = .error("Not connected. Open “server” and paste an API token from Settings on your Recap server.")
            return
        }

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("recap-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        workDir = dir
        let screen = NSScreen.screens.first { $0.displayID == displayID } ?? NSScreen.main ?? NSScreen.screens[0]

        do {
            if mode.usesCamera {
                try camera.configure(cameraID: cameraID.isEmpty ? nil : cameraID,
                                     micID: mode == .cam && micOn ? micID : nil)
                let b = BubblePanel(session: camera.session, size: mode == .cam ? .l : bubbleSize, on: screen)
                b.orderFrontRegardless()
                bubble = b
                await camera.run()
            }
            let bar = ControlBarPanel(state: self, on: screen)
            bar.orderFrontRegardless()
            controlBar = bar

            // Countdown gives the camera time to warm up and you time to place the bubble.
            for n in stride(from: 3, through: 1, by: -1) {
                phase = .countdown(n)
                try await Task.sleep(for: .seconds(1))
                guard run == runID else { return } // discarded during countdown
            }

            if mode == .cam {
                camera.startRecording(to: dir.appendingPathComponent("camera.mov"))
            } else {
                let rec = ScreenRecorder(dir: dir)
                rec.onUnexpectedStop = { [weak self] _ in
                    guard let self, self.phase.isLive else { return }
                    Task { await self.stop() }
                }
                screenRecorder = rec
                try await rec.start(displayID: screen.displayID,
                                    excludingWindowNumbers: [bar.windowNumber],
                                    micID: micOn ? micID : nil,
                                    systemAudio: systemAudio)
            }
            guard run == runID else { return }
            accumulated = 0
            elapsed = 0
            segmentStart = Date()
            phase = .recording
            startTicker()
        } catch {
            await teardown()
            phase = .error(error.localizedDescription)
        }
    }

    func pause() {
        guard phase == .recording else { return }
        if let s = segmentStart { accumulated += Date().timeIntervalSince(s) }
        segmentStart = nil
        phase = .paused
        if mode == .cam {
            camera.pause()
        } else {
            Task {
                do { try await screenRecorder?.pause() } catch { fail(error) }
            }
        }
    }

    func resume() {
        guard phase == .paused else { return }
        do {
            if mode == .cam { camera.resume() } else { try screenRecorder?.resume() }
            segmentStart = Date()
            phase = .recording
        } catch {
            fail(error)
        }
    }

    func stop() async {
        guard phase.isLive else { return }
        if let s = segmentStart { accumulated += Date().timeIntervalSince(s) }
        segmentStart = nil
        stopTicker()
        phase = .finishing
        do {
            let segments: [URL]
            if mode == .cam {
                segments = [try await camera.stopRecording()]
            } else {
                segments = try await screenRecorder?.stop() ?? []
            }
            hidePanels()
            await camera.stop()
            screenRecorder = nil

            let out = Media.libraryDir.appendingPathComponent(Media.newFileName())
            try await Media.stitch(segments, to: out)
            lastFile = out
            cleanupWorkDir()
            await upload(out)
        } catch {
            await teardown()
            phase = .error(error.localizedDescription)
        }
    }

    func upload(_ file: URL) async {
        guard let server = serverURL else { return }
        phase = .uploading(0)
        do {
            let link = try await Uploader.upload(file, title: title, server: server, token: token) { p in
                Task { @MainActor in
                    if case .uploading = AppState.shared.phase { AppState.shared.phase = .uploading(p) }
                }
            }
            lastLink = link
            title = ""
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(link.absoluteString, forType: .string)
            NSWorkspace.shared.open(link)
            phase = .idle
        } catch {
            phase = .error("\(error.localizedDescription) The video is saved in ~/Movies/Recap. Use “retry upload”.")
        }
    }

    func retryUpload() {
        guard let f = lastFile else { return }
        Task { await upload(f) }
    }

    func discard() {
        runID += 1
        stopTicker()
        Task {
            await teardown()
            phase = .idle
            elapsed = 0
        }
    }

    // MARK: - Helpers

    private func fail(_ error: Error) {
        Task {
            await teardown()
            phase = .error(error.localizedDescription)
        }
    }

    private func teardown() async {
        stopTicker()
        await screenRecorder?.cancel()
        screenRecorder = nil
        if mode == .cam { _ = try? await camera.stopRecording() }
        await camera.stop()
        hidePanels()
        cleanupWorkDir()
    }

    private func hidePanels() {
        bubble?.orderOut(nil)
        bubble = nil
        controlBar?.orderOut(nil)
        controlBar = nil
    }

    private func cleanupWorkDir() {
        if let d = workDir { try? FileManager.default.removeItem(at: d) }
        workDir = nil
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
            Task { @MainActor in
                let s = AppState.shared
                s.elapsed = s.accumulated + (s.segmentStart.map { Date().timeIntervalSince($0) } ?? 0)
            }
        }
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }
}
