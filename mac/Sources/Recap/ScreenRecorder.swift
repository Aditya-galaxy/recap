import AppKit
import ScreenCaptureKit

struct RecapError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Records a display with ScreenCaptureKit straight to MP4 (system audio + mic as separate tracks).
/// Pausing ends the current file segment; resuming starts a new one. Segments are stitched later.
@MainActor
final class ScreenRecorder: NSObject {
    private var stream: SCStream?
    private var output: SCRecordingOutput?
    private(set) var segments: [URL] = []
    private let dir: URL
    private var finishing: CheckedContinuation<Void, Error>?
    private let sampleQueue = DispatchQueue(label: "recap.samples")
    /// Called if capture ends on its own, e.g. the user hits "Stop" in the system's screen-sharing menu.
    var onUnexpectedStop: ((Error) -> Void)?

    init(dir: URL) {
        self.dir = dir
    }

    func start(displayID: CGDirectDisplayID, excludingWindowNumbers: [Int], micID: String?, systemAudio: Bool) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayID }) ?? content.displays.first else {
            throw RecapError("No display available to record.")
        }
        // Keep our own control bar out of the video; the camera bubble stays in, on purpose.
        let excluded = content.windows.filter { excludingWindowNumbers.contains(Int($0.windowID)) }
        let filter = SCContentFilter(display: display, excludingWindows: excluded)

        let cfg = SCStreamConfiguration()
        let scale = NSScreen.screens.first { $0.displayID == display.displayID }?.backingScaleFactor ?? 2
        var w = Double(display.width) * scale
        var h = Double(display.height) * scale
        if w > 2560 { h *= 2560 / w; w = 2560 } // keep uploads sane on 5K/6K displays
        cfg.width = Int(w) & ~1
        cfg.height = Int(h) & ~1
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        cfg.queueDepth = 6
        cfg.showsCursor = true
        cfg.showMouseClicks = true
        cfg.capturesAudio = systemAudio
        cfg.excludesCurrentProcessAudio = true
        if let micID {
            cfg.captureMicrophone = true
            cfg.microphoneCaptureDeviceID = micID
        }

        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        // Recording output does the writing; these no-op outputs just keep each stream type flowing.
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        if systemAudio { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue) }
        if micID != nil { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue) }
        stream = s
        try beginSegment()
        try await s.startCapture()
    }

    func pause() async throws {
        try await endSegment()
    }

    func resume() throws {
        try beginSegment()
    }

    /// Stops capture and returns the recorded segment files, in order.
    func stop() async throws -> [URL] {
        try await endSegment()
        try? await stream?.stopCapture()
        stream = nil
        return segments
    }

    func cancel() async {
        if let output, let stream { try? stream.removeRecordingOutput(output) }
        try? await stream?.stopCapture()
        stream = nil
        output = nil
    }

    private func beginSegment() throws {
        guard let stream else { return }
        let url = dir.appendingPathComponent("segment-\(segments.count).mp4")
        let cfg = SCRecordingOutputConfiguration()
        cfg.outputURL = url
        cfg.outputFileType = .mp4
        cfg.videoCodecType = .h264
        let out = SCRecordingOutput(configuration: cfg, delegate: self)
        try stream.addRecordingOutput(out)
        output = out
        segments.append(url)
    }

    private func endSegment() async throws {
        guard let stream, let out = output else { return }
        output = nil
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            finishing = c
            do {
                try stream.removeRecordingOutput(out)
            } catch {
                finishing = nil
                c.resume(throwing: error)
                return
            }
            // Don't hang forever if the finish callback never arrives.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.finishing?.resume()
                self?.finishing = nil
            }
        }
    }

    fileprivate func finished(_ error: Error?) {
        guard let c = finishing else { return }
        finishing = nil
        if let error { c.resume(throwing: error) } else { c.resume() }
    }
}

extension ScreenRecorder: SCStreamDelegate, SCStreamOutput, SCRecordingOutputDelegate {
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {}

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in self.onUnexpectedStop?(error) }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in self.finished(nil) }
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        Task { @MainActor in self.finished(error) }
    }
}

extension NSScreen {
    var displayID: CGDirectDisplayID {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }
}
