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

  /// Called when the host view's bounds change (rotation, resize).
  func updateLayout(bounds: CGRect) {
    // CALayer frame must be updated on main thread
    if Thread.isMainThread {
      playerLayer?.frame = bounds
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.playerLayer?.frame = bounds
      }
    }
  }

  func setVideoGravity(_ gravity: AVLayerVideoGravity) {
    playerLayer?.videoGravity = gravity
  }

  func setProgressInterval(_ seconds: Double) {
    progressIntervalSeconds = max(0.1, seconds)
    if player != nil {
      removeTimeObserver()
      addTimeObserver()
    }
  }

  func load(url: String) {
    removeObservers()
    guard let u = URL(string: url) else { return }
    let item = AVPlayerItem(url: u)

    if player == nil {
      player = AVPlayer(playerItem: item)
    } else {
      player?.replaceCurrentItem(with: item)
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
    player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
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
    // Remove stale layer before creating a new one
    playerLayer?.removeFromSuperlayer()

    let layer = AVPlayerLayer(player: player)
    layer.frame = view.bounds
    layer.videoGravity = .resizeAspect
    view.layer.addSublayer(layer)
    playerLayer = layer
  }

  // MARK: - Observers

  private func addObservers(for item: AVPlayerItem) {
    // Ready-to-play
    let statusObs = item.observe(\.status, options: [.new]) { [weak self] item, _ in
      guard let self = self else { return }
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

    // Buffering state
    let bufObs = item.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
      self?.onBuffering?(!item.isPlaybackLikelyToKeepUp)
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
    if _isRepeating {
      player?.seek(to: .zero)
      player?.play()
    } else {
      onEnd?()
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

    imageGenerator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { _, image, _, _, _ in
      guard let image = image else {
        completion(nil)
        return
      }
      let uiImage = UIImage(cgImage: image)
      let path = self.saveImage(uiImage)
      completion(path)
    }
  }

  private func saveImage(_ image: UIImage) -> String? {
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
