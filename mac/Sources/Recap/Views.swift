import AppKit
import SwiftUI

private let mono = Font.system(size: 12, design: .monospaced)
private let monoSmall = Font.system(size: 10, design: .monospaced)

struct MenuView: View {
    @EnvironmentObject var state: AppState
    @State private var showSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 0) {
                Text("~/").foregroundStyle(.secondary)
                Text("recap")
                Rectangle().frame(width: 7, height: 13).padding(.leading, 2)
                Spacer()
                Text("⌥⌘R").font(monoSmall).foregroundStyle(.secondary)
            }
            .font(.system(size: 13, weight: .medium, design: .monospaced))

            if state.phase.isLive || state.phase == .finishing || isUploading || isCountdown {
                liveSection
            } else {
                setupSection
            }

            if let link = state.lastLink {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("last recording").font(monoSmall).textCase(.uppercase).foregroundStyle(.secondary)
                    HStack {
                        Text(link.absoluteString).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("copy") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(link.absoluteString, forType: .string)
                        }
                        .buttonStyle(MonoButton())
                        Button("open") { NSWorkspace.shared.open(link) }.buttonStyle(MonoButton())
                    }
                }
            }

            Divider()
            footer
        }
        .font(mono)
        .padding(14)
        .frame(width: 320)
        .onAppear {
            state.refreshDevices()
            if state.token.isEmpty { showSettings = true }
        }
    }

    private var isUploading: Bool { if case .uploading = state.phase { return true }; return false }
    private var isCountdown: Bool { if case .countdown = state.phase { return true }; return false }

    @ViewBuilder private var setupSection: some View {
        Segmented(selection: $state.mode, options: Mode.allCases.map { ($0, $0.label) })

        field("title") {
            TextField("untitled recording", text: $state.title).textFieldStyle(.plain).padding(6).overlay(box)
        }

        if state.mode.usesScreen && state.displays.count > 1 {
            field("display") {
                Picker("", selection: Binding(get: { String(state.displayID) }, set: { state.displayID = CGDirectDisplayID($0) ?? CGMainDisplayID() })) {
                    ForEach(state.displays) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
            }
        }

        if state.mode.usesCamera {
            field("camera") {
                Picker("", selection: $state.cameraID) {
                    ForEach(state.cameras) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
            }
        }

        field("microphone", trailing: AnyView(Toggle("", isOn: $state.micOn).toggleStyle(.switch).controlSize(.mini).labelsHidden())) {
            if state.micOn {
                Picker("", selection: $state.micID) {
                    ForEach(state.mics) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
            }
        }

        if state.mode.usesScreen {
            HStack {
                Text("system audio").font(monoSmall).textCase(.uppercase).foregroundStyle(.secondary)
                Spacer()
                Toggle("", isOn: $state.systemAudio).toggleStyle(.switch).controlSize(.mini).labelsHidden()
            }
        }

        if state.mode == .screenCam {
            field("bubble") {
                Segmented(selection: $state.bubbleSize, options: BubbleSize.allCases.map { ($0, $0.rawValue) })
            }
        }

        if case .error(let msg) = state.phase {
            VStack(alignment: .leading, spacing: 6) {
                Text("error: ").foregroundStyle(.secondary) + Text(msg)
                if state.lastFile != nil, msg.contains("retry") {
                    Button("retry upload") { state.retryUpload() }.buttonStyle(MonoButton())
                }
            }
            .font(monoSmall)
            .fixedSize(horizontal: false, vertical: true)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.primary))
        }

        Button {
            state.toggle()
        } label: {
            HStack(spacing: 6) {
                Circle().frame(width: 7, height: 7)
                Text("start recording")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MonoButton(primary: true))
        .keyboardShortcut(.defaultAction)
    }

    @ViewBuilder private var liveSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(statusText)
            if case .uploading(let p) = state.phase {
                ProgressView(value: p).progressViewStyle(.linear).tint(.primary)
            }
            if state.phase.isLive {
                HStack {
                    if state.phase == .recording {
                        Button("❚❚ pause") { state.pause() }.buttonStyle(MonoButton())
                    } else {
                        Button("▶ resume") { state.resume() }.buttonStyle(MonoButton())
                    }
                    Button("■ stop") { Task { await state.stop() } }.buttonStyle(MonoButton(primary: true))
                    Spacer()
                    Button("discard") { state.discard() }.buttonStyle(MonoButton())
                }
            }
        }
    }

    private var statusText: String {
        switch state.phase {
        case .countdown(let n): "starting in \(n)…"
        case .recording: "● recording  \(formatTime(state.elapsed))"
        case .paused: "❚❚ paused  \(formatTime(state.elapsed))"
        case .finishing: "$ saving…"
        case .uploading(let p): "$ uploading \(Int(p * 100))%"
        default: ""
        }
    }

    @ViewBuilder private var footer: some View {
        if showSettings {
            field("server") {
                TextField("http://localhost:3217", text: $state.server).textFieldStyle(.plain).padding(6).overlay(box)
            }
            field("api token") {
                SecureField("rcp_…  (Settings → create token)", text: $state.token).textFieldStyle(.plain).padding(6).overlay(box)
            }
            HStack {
                Button("check connection") { state.checkConnection() }.buttonStyle(MonoButton())
                Spacer()
                Text(connectionText).font(monoSmall).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        HStack(spacing: 8) {
            Button("library") {
                if let u = state.serverURL { NSWorkspace.shared.open(u) }
            }
            .buttonStyle(MonoButton())
            Button("folder") { NSWorkspace.shared.open(Media.libraryDir) }.buttonStyle(MonoButton())
            Button(showSettings ? "done" : "server") { showSettings.toggle() }.buttonStyle(MonoButton())
            Spacer()
            Button("quit") { NSApp.terminate(nil) }.buttonStyle(MonoButton())
        }
    }

    private var connectionText: String {
        switch state.connection {
        case .unknown: state.token.isEmpty ? "not connected" : ""
        case .checking: "checking…"
        case .ok(let email): "✓ \(email)"
        case .failed(let msg): msg
        }
    }

    private var box: some View { RoundedRectangle(cornerRadius: 3).stroke(Color.primary.opacity(0.2)) }

    private func field<C: View>(_ label: String, trailing: AnyView? = nil, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(monoSmall).textCase(.uppercase).foregroundStyle(.secondary)
                Spacer()
                if let trailing { trailing }
            }
            content()
        }
    }
}

struct ControlBarView: View {
    @EnvironmentObject var state: AppState
    @State private var blink = false

    var body: some View {
        HStack(spacing: 10) {
            switch state.phase {
            case .countdown(let n):
                Text("starting in \(n)").frame(maxWidth: .infinity, alignment: .leading)
                Button("cancel") { state.discard() }.buttonStyle(BarButton())
            case .recording, .paused:
                Circle()
                    .frame(width: 8, height: 8)
                    .opacity(state.phase == .recording ? (blink ? 0.15 : 1) : 0.4)
                    .animation(.easeInOut(duration: 0.6).repeatForever(), value: blink)
                    .onAppear { blink = true }
                Text(formatTime(state.elapsed)).monospacedDigit()
                Spacer()
                if state.phase == .recording {
                    Button("❚❚") { state.pause() }.buttonStyle(BarButton()).help("Pause")
                } else {
                    Button("▶") { state.resume() }.buttonStyle(BarButton()).help("Resume")
                }
                Button("■ stop") { Task { await state.stop() } }.buttonStyle(BarButton(primary: true))
                Button("✕") { state.discard() }.buttonStyle(BarButton()).help("Discard")
            default:
                Text(state.phase == .finishing ? "saving…" : "uploading…").frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .frame(width: 320, height: 48)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.black))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white.opacity(0.2)))
    }
}

struct Segmented<T: Hashable>: View {
    @Binding var selection: T
    let options: [(T, String)]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { value, label in
                Button {
                    selection = value
                } label: {
                    Text(label)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(selection == value ? Color.primary : .clear)
                        .foregroundStyle(selection == value ? Color(nsColor: .windowBackgroundColor) : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .font(.system(size: 11, design: .monospaced))
        .padding(2)
        .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.primary.opacity(0.2)))
    }
}

struct MonoButton: ButtonStyle {
    var primary = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, primary ? 7 : 4)
            .background(primary ? Color.primary : .clear)
            .foregroundStyle(primary ? Color(nsColor: .windowBackgroundColor) : .primary)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.primary.opacity(primary ? 1 : 0.25)))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(Rectangle())
    }
}

struct BarButton: ButtonStyle {
    var primary = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(primary ? Color.white : .clear)
            .foregroundStyle(primary ? Color.black : .white)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.white.opacity(primary ? 1 : 0.3)))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(Rectangle())
    }
}
