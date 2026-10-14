// Tray icons: ring + dot. tray.png is white (Windows/Linux trays are dark);
// trayTemplate.png is black-on-alpha so macOS can tint it.
import AppKit
func draw(_ px: Int, _ color: NSColor, _ out: String) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    color.setStroke(); color.setFill()
    let ring = NSBezierPath(ovalIn: NSRect(x: s * 0.12, y: s * 0.12, width: s * 0.76, height: s * 0.76))
    ring.lineWidth = s * 0.1
    ring.stroke()
    NSBezierPath(ovalIn: NSRect(x: s * 0.34, y: s * 0.34, width: s * 0.32, height: s * 0.32)).fill()
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
}
draw(32, .white, "build/tray.png")
draw(16, .black, "build/trayTemplate.png")
draw(32, .black, "build/trayTemplate@2x.png")
