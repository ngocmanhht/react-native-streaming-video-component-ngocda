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

  func load(url: String, isLiveStream: Bool = false) {
    removeObservers()
    guard let u = URL(string: url) else { return }

    // ── AVURLAsset options ─────────────────────────────────────────────────────
    let assetOptions: [String: Any] = [
      // Forward cookies (helps with authenticated HLS / CDN-protected MP4)
      AVURLAssetHTTPCookiesKey: HTTPCookieStorage.shared.cookies ?? [],
    ]
    let asset = AVURLAsset(url: u, options: assetOptions)
    let item = AVPlayerItem(asset: asset)

    if isLiveStream {
      // ── HLS live stream: optimise for low latency ───────────────────────────────
      // Set to 0.0 to let AVPlayer automatically determine the optimal buffer duration
      // based on playlist chunk size, avoiding micro-stuttering on larger chunk streams.
      item.preferredForwardBufferDuration = 0.0
    } else {
      // ── MP4 / VOD: optimise for smooth, stall-free playback ────────────────────
      // Buffer 10 s ahead so seeking & playback are smooth
      item.preferredForwardBufferDuration = 10.0
    }

    if player == nil {
      let p = AVPlayer(playerItem: item)

      if isLiveStream {
        // HLS live: play immediately without waiting to buffer more
        // (reduces perceived latency on live cameras / streams)
        p.automaticallyWaitsToMinimizeStalling = false
      } else {
        // MP4 / VOD: keep the default ‘true’ so AVPlayer buffers before playing,
        // preventing mid-playback stalls on slower connections
        p.automaticallyWaitsToMinimizeStalling = true
      }

      player = p
    } else {
      player?.replaceCurrentItem(with: item)
      // Re-apply stalling preference when reusing the same AVPlayer instance
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

    addTimeObserver()
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
    guard let asset = player?.currentItem?.asset else {
      completion(nil)
      return
    }
    let imageGenerator = AVAssetImageGenerator(asset: asset)
    imageGenerator.appliesPreferredTrackTransform = true
    let time = player?.currentTime() ?? .zero

    imageGenerator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { [weak self] _, image, _, _, _ in
      guard let self = self else {
        completion(nil)
        return
      }
      guard let image = image else {
        DispatchQueue.main.async { completion(nil) }
        return
      }
      let uiImage = UIImage(cgImage: image)
      let path = self.saveImage(uiImage)
      DispatchQueue.main.async { completion(path) }
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
