import AVFoundation

/// One capture session drives both the on-screen bubble preview and, in camera-only mode,
/// the movie file output.
@MainActor
final class CameraController: NSObject {
    let session = AVCaptureSession()
    private let movieOutput = AVCaptureMovieFileOutput()
    private let queue = DispatchQueue(label: "recap.camera")
    private var finishing: CheckedContinuation<URL, Error>?
    private(set) var running = false

    func start(cameraID: String?, micID: String?) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        session.sessionPreset = .high

        guard let cam = cameraID.flatMap(AVCaptureDevice.init(uniqueID:)) ?? AVCaptureDevice.default(for: .video) else {
            throw RecapError("No camera found.")
        }
        let camInput = try AVCaptureDeviceInput(device: cam)
        guard session.canAddInput(camInput) else { throw RecapError("Camera is busy.") }
        session.addInput(camInput)

        if let micID, let mic = AVCaptureDevice(uniqueID: micID) ?? AVCaptureDevice.default(for: .audio) {
            let micInput = try AVCaptureDeviceInput(device: mic)
            if session.canAddInput(micInput) { session.addInput(micInput) }
        }
        if session.canAddOutput(movieOutput) { session.addOutput(movieOutput) }

        let s = session
        queue.async { s.startRunning() }
        running = true
    }

    func stop() {
        guard running else { return }
        running = false
        let s = session
        queue.async { s.stopRunning() }
    }

    func startRecording(to url: URL) {
        movieOutput.startRecording(to: url, recordingDelegate: self)
    }

    func pause() { movieOutput.pauseRecording() }
    func resume() { movieOutput.resumeRecording() }

    func stopRecording() async throws -> URL {
        guard movieOutput.isRecording else { throw RecapError("Camera wasn't recording.") }
        return try await withCheckedThrowingContinuation { c in
            finishing = c
            movieOutput.stopRecording()
        }
    }

    fileprivate func finished(_ url: URL, _ error: Error?) {
        guard let c = finishing else { return }
        finishing = nil
        // AVFoundation reports an "error" even on success; it flags success in userInfo.
        if let error = error as NSError?, (error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool) != true {
            c.resume(throwing: error)
        } else {
            c.resume(returning: url)
        }
    }
}

extension CameraController: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        Task { @MainActor in self.finished(outputFileURL, error) }
    }
}

enum Devices {
    static var cameras: [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            mediaType: .video, position: .unspecified
        ).devices
    }

    static var microphones: [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio, position: .unspecified
        ).devices
    }
}
