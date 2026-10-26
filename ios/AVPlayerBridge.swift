import AVFoundation
import Foundation
import UIKit

final class AVPlayerBridge: NSObject {
  private(set) var player: AVPlayer?
  private var playerLayer: AVPlayerLayer?
  private var timeObserver: Any?
  private var itemObservations: [NSKeyValueObservation] = []
  private var progressIntervalSeconds: Double = 0.5
  private var _isRepeating = false
  private var isLive = false
  private var videoOutput: AVPlayerItemVideoOutput?

  // Store target view so we can create the layer AFTER player is ready
  private weak var targetView: UIView?
  private var currentGravity: AVLayerVideoGravity = .resizeAspect

  var onReady: ((Double, CGSize) -> Void)?
  var onProgress: ((Double, Double, Double) -> Void)?
  var onBuffering: ((Bool) -> Void)?
  var onError: ((Int, String) -> Void)?
  var onEnd: (() -> Void)?

  // MARK: - Setup

  /// Store the view that will host the AVPlayerLayer.
  /// The actual layer is created (or updated) inside load() once the player exists.
  func attach(to view: UIView) {
    targetView = view
    // If we already have a player (e.g. switching back from VLC),
    // re-create the layer immediately.
    if let player = player {
      createLayer(in: view, player: player)
    }
  }

  func detach() {
    removeObservers()
    if let item = player?.currentItem, let output = videoOutput {
      item.remove(output)
    }
    videoOutput = nil
    playerLayer?.removeFromSuperlayer()
    playerLayer = nil
    player = nil
    targetView = nil
  }

  /// Called when the host view's bounds change (rotation, resize).
  func updateLayout(bounds: CGRect) {
    let update = { [weak self] in
      CATransaction.begin()
      CATransaction.setDisableActions(true)

      self?.playerLayer?.frame = bounds

      CATransaction.commit()
    }

    if Thread.isMainThread {
      update()
    } else {
      DispatchQueue.main.async {
        update()
      }
    }
  }

  func setVideoGravity(_ gravity: AVLayerVideoGravity) {
    currentGravity = gravity
    playerLayer?.videoGravity = gravity
  }

  func setProgressInterval(_ seconds: Double) {
    progressIntervalSeconds = max(0.1, seconds)
    if player != nil {
      removeTimeObserver()
      addTimeObserver()
    }
  }

  func load(url: String, isLiveStream: Bool = false, headers: [String: String]? = nil) {
    self.isLive = isLiveStream
    removeObservers()
    guard let u = URL(string: url) else { return }

    // ── AVURLAsset options ─────────────────────────────────────────────────────
    var assetOptions: [String: Any] = [
      // Forward cookies (helps with authenticated HLS / CDN-protected MP4)
      AVURLAssetHTTPCookiesKey: HTTPCookieStorage.shared.cookies ?? [],
    ]
    if let h = headers, !h.isEmpty {
      assetOptions["AVURLAssetHTTPHeaderFieldsKey"] = h
    }
    let asset = AVURLAsset(url: u, options: assetOptions)
    let item = AVPlayerItem(asset: asset)

    let outputSettings: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
    ]
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: outputSettings)
    item.add(output)
    self.videoOutput = output

    if isLiveStream {
      // ── HLS live stream: cho phép buffer nhỏ (0.5s) và không chờ stall để hỗ trợ playlist ngắn
      item.preferredForwardBufferDuration = 0.5
    } else {
      // ── MP4 / VOD: optimise for smooth, stall-free playback
      item.preferredForwardBufferDuration = 10.0
    }

    if player == nil {
      let p = AVPlayer(playerItem: item)
      p.automaticallyWaitsToMinimizeStalling = !isLiveStream
      player = p
    } else {
      player?.replaceCurrentItem(with: item)
      player?.automaticallyWaitsToMinimizeStalling = !isLiveStream
    }

    // CRITICAL: create or re-link the layer NOW, after player exists.
    // This is what was missing – calling attach() before load() created a
    // layer with player=nil, resulting in a black screen.
    if let view = targetView, let player = player {
      createLayer(in: view, player: player)
    }

    addObservers(for: item)
  }

  // MARK: - Controls

  func play()  { player?.play() }
  func pause() { player?.pause() }
  func stop()  {
    player?.pause()
    player?.seek(to: .zero)
    removeTimeObserver()
  }

  func setVolume(_ volume: Float) { player?.volume = max(0, min(1, volume)) }
  func setMuted(_ muted: Bool)    { player?.isMuted = muted }

  func enableRepeat(_ enabled: Bool) {
    _isRepeating = enabled
  }

  func seek(to seconds: Double, completion: @escaping (Bool) -> Void) {
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    player?.seek(to: time) { finished in
      completion(finished)
    }
  }

  var currentTime: Double { player?.currentTime().seconds ?? 0 }
  var duration: Double {
    let d = player?.currentItem?.duration.seconds ?? -1
    return (d.isNaN || d.isInfinite) ? -1 : d
  }

  // MARK: - Private helpers

  private func createLayer(in view: UIView, player: AVPlayer) {
    playerLayer?.removeFromSuperlayer()

    let layer = AVPlayerLayer(player: player)

    layer.frame = view.bounds
    layer.videoGravity = currentGravity
    layer.needsDisplayOnBoundsChange = true

    view.layer.addSublayer(layer)

    playerLayer = layer
  }

  // MARK: - Observers

  private func addObservers(for item: AVPlayerItem) {
    // Ready-to-play
    let statusObs = item.observe(\.status, options: [.new]) { [weak self] item, _ in
      guard let self = self else { return }
      DispatchQueue.main.async {
        switch item.status {
        case .readyToPlay:
          let dur = item.duration.seconds
          let track = item.tracks.first(where: { $0.assetTrack?.mediaType == .video })
          let size  = track?.assetTrack?.naturalSize ?? .zero
          self.onReady?((dur.isNaN || dur.isInfinite) ? -1 : dur, size)
        case .failed:
          let code = item.error?._code ?? -1
          self.onError?(code, item.error?.localizedDescription ?? "Unknown AVPlayer error")
        default: break
        }
      }
    }

    // Buffering state
    let bufObs = item.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
      DispatchQueue.main.async {
        print("[AVPlayer] isPlaybackLikelyToKeepUp: \(item.isPlaybackLikelyToKeepUp), isPlaybackBufferEmpty: \(item.isPlaybackBufferEmpty)")
        self?.onBuffering?(!item.isPlaybackLikelyToKeepUp)
      }
    }

    itemObservations = [statusObs, bufObs]

    // End-of-item notification
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(playerItemDidEnd),
      name: AVPlayerItem.didPlayToEndTimeNotification,
      object: item
    )

    // Error log notification (bắt mã lỗi HTTP 403, 404, network failure)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleErrorLogEntry(_:)),
      name: AVPlayerItem.newErrorLogEntryNotification,
      object: item
    )

    // Access log notification (bắt khi tải chunk/playlist thành công)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAccessLogEntry(_:)),
      name: AVPlayerItem.newAccessLogEntryNotification,
      object: item
    )

    addTimeObserver()
  }

  @objc private func handleErrorLogEntry(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem,
          let event = item.errorLog()?.events.last else { return }
    print("❌ [AVPlayer ErrorLog] HTTP Status: \(event.errorStatusCode) | URI: \(event.uri ?? "nil") | Comment: \(event.errorComment ?? "nil") | Domain: \(event.errorDomain)")
    if event.errorStatusCode >= 400 {
      DispatchQueue.main.async { [weak self] in
        self?.onError?(event.errorStatusCode, event.errorComment ?? "HTTP Error \(event.errorStatusCode)")
      }
    }
  }

  @objc private func handleAccessLogEntry(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem,
          let event = item.accessLog()?.events.last else { return }
    print("✅ [AVPlayer AccessLog] Server: \(event.serverAddress ?? "nil") | URI: \(event.uri ?? "nil") | Bitrate: \(event.observedBitrate)")
  }

  private func addTimeObserver() {
    guard let player = player else { return }
    let interval = CMTime(seconds: progressIntervalSeconds, preferredTimescale: 600)
    timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
      guard let self = self, let item = self.player?.currentItem else { return }
      let current  = time.seconds
      let total    = item.duration.seconds
      let playable = item.loadedTimeRanges.first
                       .map { CMTimeRangeGetEnd($0.timeRangeValue).seconds } ?? 0
      self.onProgress?(current, (total.isNaN || total.isInfinite) ? -1 : total, playable)
    }
  }

  private func removeTimeObserver() {
    if let obs = timeObserver { player?.removeTimeObserver(obs) }
    timeObserver = nil
  }

  private func removeObservers() {
    itemObservations.removeAll()
    removeTimeObserver()
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func playerItemDidEnd() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if self.isLive { return }
      if self._isRepeating {
        self.player?.seek(to: .zero)
        self.player?.play()
      } else {
        self.onEnd?()
      }
    }
  }

  // MARK: - Screenshot

  func takeScreenshot(completion: @escaping (String?) -> Void) {
    // 1. Try AVPlayerItemVideoOutput (Native HLS / m3u8 frame decoding from GPU)
    if let item = player?.currentItem, let output = videoOutput {
      let currentTime = item.currentTime()
      if output.hasNewPixelBuffer(forItemTime: currentTime),
         let pixelBuffer = output.copyPixelBuffer(forItemTime: currentTime, itemTimeForDisplay: nil) {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext(options: nil)
        if let cgImage = context.createCGImage(ciImage, from: ciImage.extent) {
          let uiImage = UIImage(cgImage: cgImage)
          if let path = self.saveImage(uiImage) {
            DispatchQueue.main.async { completion(path) }
            return
          }
        }
      }
    }

    // 2. Try AVAssetImageGenerator (for MP4 / non-HLS files)
    if let asset = player?.currentItem?.asset {
      let imageGenerator = AVAssetImageGenerator(asset: asset)
      imageGenerator.appliesPreferredTrackTransform = true
      imageGenerator.requestedTimeToleranceBefore = .zero
      imageGenerator.requestedTimeToleranceAfter = .zero
      let time = player?.currentTime() ?? .zero

      imageGenerator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { [weak self] _, image, _, result, _ in
        guard let self = self else {
          completion(nil)
          return
        }
        if result == .succeeded, let image = image {
          let uiImage = UIImage(cgImage: image)
          if let path = self.saveImage(uiImage) {
            DispatchQueue.main.async { completion(path) }
            return
          }
        }

        // 3. Fallback to UIView / Layer render (works for any active video frame)
        DispatchQueue.main.async {
          if let view = self.targetView, view.bounds.width > 0, view.bounds.height > 0 {
            let renderer = UIGraphicsImageRenderer(bounds: view.bounds)
            let uiImage = renderer.image { ctx in
              view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
            }
            let path = self.saveImage(uiImage)
            completion(path)
          } else {
            completion(nil)
          }
        }
      }
      return
    }

    // 3. Fallback to UIView / Layer render
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        completion(nil)
        return
      }
      if let view = self.targetView, view.bounds.width > 0, view.bounds.height > 0 {
        let renderer = UIGraphicsImageRenderer(bounds: view.bounds)
        let uiImage = renderer.image { ctx in
          view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
        }
        let path = self.saveImage(uiImage)
        completion(path)
      } else {
        completion(nil)
      }
    }
  }

  private func pruneSnapshotCache() {
    let tmp = FileManager.default.temporaryDirectory
    guard let files = try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: [.fileSizeKey], options: []) else { return }
    let snapshots = files.filter { $0.lastPathComponent.hasPrefix("snapshot_") }
    var totalSize: UInt64 = 0
    let maxSizeBytes: UInt64 = 52_428_800 // 50MB
    for file in snapshots {
      if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
         let size = attrs[.size] as? UInt64 {
        totalSize += size
        if totalSize > maxSizeBytes {
          try? FileManager.default.removeItem(at: file)
        }
      }
    }
  }

  private func saveImage(_ image: UIImage) -> String? {
    pruneSnapshotCache()
    guard let data = image.jpegData(compressionQuality: 0.8) else { return nil }
    let filename = "snapshot_\(Int(Date().timeIntervalSince1970)).jpg"
    let path = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
    do {
      try data.write(to: path)
      return path.path
    } catch {
      return nil
    }
  }

  // MARK: - Deinit

  deinit {
    removeObservers()
    playerLayer?.removeFromSuperlayer()
    playerLayer = nil
    player = nil
    targetView = nil
  }
}
