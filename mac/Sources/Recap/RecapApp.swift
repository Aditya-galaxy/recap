import AppKit
import SwiftUI

@main
struct RecapApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState.shared

    var body: some Scene {
        MenuBarExtra {
            MenuView().environmentObject(state)
        } label: {
            MenuBarLabel().environmentObject(state)
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var hotKey: HotKey?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // ⌥⌘R starts/stops from anywhere, no Accessibility permission needed (Carbon hot key).
        hotKey = HotKey { Task { @MainActor in AppState.shared.toggle() } }
        Task { @MainActor in AppState.shared.refreshDevices() }
    }
}

struct MenuBarLabel: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        switch state.phase {
        case .recording:
            HStack(spacing: 4) {
                Image(systemName: "stop.circle.fill")
                Text(formatTime(state.elapsed)).monospacedDigit()
            }
        case .paused:
            Image(systemName: "pause.circle")
        case .countdown, .finishing, .uploading:
            Image(systemName: "circle.dotted")
        default:
            Image(systemName: "record.circle")
        }
    }
}

func formatTime(_ t: TimeInterval) -> String {
    let s = max(0, Int(t.rounded(.down)))
    return s >= 3600
        ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
        : String(format: "%d:%02d", s / 60, s % 60)
}
