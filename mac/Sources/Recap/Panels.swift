import AppKit
import AVFoundation
import SwiftUI

enum BubbleSize: String, CaseIterable {
    case s, m, l
    var points: CGFloat { switch self { case .s: 140; case .m: 200; case .l: 280 } }
}

/// Floating, non-activating panel that never steals focus from the app being recorded.
class FloatingPanel: NSPanel {
    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: .zero, size: size),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The circular camera bubble. It's a real window on screen, so ScreenCaptureKit records it
/// exactly where you drag it: no compositing needed.
final class BubblePanel: FloatingPanel {
    private let preview: AVCaptureVideoPreviewLayer
    private let ring = CAShapeLayer()

    init(session: AVCaptureSession, size: BubbleSize, on screen: NSScreen) {
        preview = AVCaptureVideoPreviewLayer(session: session)
        super.init(size: NSSize(width: size.points, height: size.points))
        let view = DragView(frame: NSRect(origin: .zero, size: frame.size))
        view.wantsLayer = true
        view.layer?.masksToBounds = true
        preview.videoGravity = .resizeAspectFill
        preview.setAffineTransform(CGAffineTransform(scaleX: -1, y: 1)) // mirror, like a selfie view
        view.layer?.addSublayer(preview)
        ring.fillColor = nil
        ring.strokeColor = NSColor.white.cgColor
        ring.lineWidth = 3
        view.layer?.addSublayer(ring)
        contentView = view
        layout(size.points)
        let vf = screen.visibleFrame
        setFrameOrigin(NSPoint(x: vf.minX + 32, y: vf.minY + 32))
    }

    func resize(to size: BubbleSize) {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        let d = size.points
        setFrame(NSRect(x: center.x - d / 2, y: center.y - d / 2, width: d, height: d), display: true)
        layout(d)
    }

    private func layout(_ d: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentView?.frame = NSRect(x: 0, y: 0, width: d, height: d)
        contentView?.layer?.cornerRadius = d / 2
        preview.frame = CGRect(x: 0, y: 0, width: d, height: d)
        ring.path = CGPath(ellipseIn: CGRect(x: 1.5, y: 1.5, width: d - 3, height: d - 3), transform: nil)
        CATransaction.commit()
    }
}

private final class DragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
}

/// Timer + pause/stop/discard. Excluded from the recording.
final class ControlBarPanel: FloatingPanel {
    init(state: AppState, on screen: NSScreen) {
        let size = NSSize(width: 320, height: 48)
        super.init(size: size)
        let host = NSHostingView(rootView: ControlBarView().environmentObject(state))
        host.frame = NSRect(origin: .zero, size: size)
        contentView = host
        let vf = screen.visibleFrame
        setFrameOrigin(NSPoint(x: vf.midX - size.width / 2, y: vf.minY + 24))
        sharingType = .none // belt and braces; the capture filter also excludes it
    }
}
