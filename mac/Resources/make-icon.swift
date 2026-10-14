// Renders the app icon: white ring + dot on black, macOS squircle-ish rounded square.
import AppKit
let size = 1024.0
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let inset = size * 0.1
let rect = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
NSColor.black.setFill()
NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225).fill()
NSColor.white.setStroke()
let ring = NSBezierPath(ovalIn: rect.insetBy(dx: rect.width * 0.22, dy: rect.width * 0.22))
ring.lineWidth = rect.width * 0.055
ring.stroke()
NSColor.white.setFill()
NSBezierPath(ovalIn: rect.insetBy(dx: rect.width * 0.39, dy: rect.width * 0.39)).fill()
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
