import AVFoundation
import Foundation

enum Media {
    /// Joins pause-separated segments into one MP4 without re-encoding.
    static func stitch(_ segments: [URL], to out: URL) async throws {
        try? FileManager.default.removeItem(at: out)
        var usable: [(URL, CMTime)] = []
        for url in segments where FileManager.default.fileExists(atPath: url.path) {
            let d = try await AVURLAsset(url: url).load(.duration)
            if d.seconds > 0.1 { usable.append((url, d)) }
        }
        guard !usable.isEmpty else { throw RecapError("Nothing was recorded.") }

        if usable.count == 1, usable[0].0.pathExtension == out.pathExtension {
            try FileManager.default.moveItem(at: usable[0].0, to: out)
            return
        }
        let comp = AVMutableComposition()
        var cursor = CMTime.zero
        for (url, d) in usable {
            try await comp.insertTimeRange(CMTimeRange(start: .zero, duration: d), of: AVURLAsset(url: url), at: cursor)
            cursor = cursor + d
        }
        guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else {
            throw RecapError("Couldn't create exporter.")
        }
        try await export.export(to: out, as: .mp4)
    }

    static var libraryDir: URL {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies/Recap", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func newFileName() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        return "Recap \(f.string(from: Date())).mp4"
    }
}

enum Uploader {
    private struct Created: Decodable { let id: String }

    static func upload(_ file: URL, title: String, server: URL, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        var req = URLRequest(url: server.appendingPathComponent("api/videos"))
        req.httpMethod = "POST"
        req.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty, let enc = t.addingPercentEncoding(withAllowedCharacters: .alphanumerics) {
            req.setValue(enc, forHTTPHeaderField: "x-title")
        }
        let (data, resp) = try await URLSession.shared.upload(for: req, fromFile: file, delegate: ProgressDelegate(progress))
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 201 else {
            throw RecapError("Upload failed (HTTP \(code)): \(String(data: data, encoding: .utf8)?.prefix(200) ?? "")")
        }
        let id = try JSONDecoder().decode(Created.self, from: data).id
        return server.appendingPathComponent("v/\(id)")
    }

    private final class ProgressDelegate: NSObject, URLSessionTaskDelegate {
        let progress: @Sendable (Double) -> Void
        init(_ progress: @escaping @Sendable (Double) -> Void) { self.progress = progress }

        func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                        totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
            guard totalBytesExpectedToSend > 0 else { return }
            progress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
        }
    }
}
