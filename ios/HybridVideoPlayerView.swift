import Foundation
import UIKit
import AVFoundation
import AVKit
import NitroModules

class HybridVideoPlayerView: HybridVideoPlayerViewSpec {

  // MARK: - Native view

  private lazy var containerView: UIView = {
    let v = UIView()
    v.backgroundColor = .black
    v.clipsToBounds = true
    return v
  }()
  var view: UIView { containerView }

  // MARK: - Bridges

  private var avBridge: AVPlayerBridge?
  private var vlcBridge: VLCPlayerBridge?
  private var activeProtocol: StreamProtocol = .hls

  // MARK: - Init

  override init() {
    super.init()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.avBridge = AVPlayerBridge()
      self.vlcBridge = VLCPlayerBridge()
      self.bindAVBridge()
      self.bindVLCBridge()
      self.setupLayoutObserver()
      
      // If a URL was set before main-thread initialization completed, load it now
      if !self.url.isEmpty {
        self.reloadPlayer()
      }
    }
  }

  // MARK: - Layout (fixes AVPlayerLayer not tracking view size)

  private var layoutObserver: NSKeyValueObservation?

  private func setupLayoutObserver() {
    // Observe containerView.bounds so AVPlayerLayer stays in sync on rotation/resize
    layoutObserver = containerView.observe(\.bounds, options: [.new]) { [weak self] view, _ in
      DispatchQueue.main.async {
        self?.avBridge?.updateLayout(bounds: view.bounds)
      }
    }
  }

  // MARK: - Props

  var url: String = "" {
    didSet {
      guard url != oldValue, !url.isEmpty else { return }
      DispatchQueue.main.async { [weak self] in
        self?.reloadPlayer()
      }
    }
  }

  var streamProtocol: StreamProtocol = .hls {
    didSet {
      guard streamProtocol != oldValue else { return }
      DispatchQueue.main.async { [weak self] in
        self?.reloadPlayer()
      }
    }
  }

  var paused: Bool = false {
    didSet {
      guard paused != oldValue else { return }
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.paused ? self.activePause() : self.activePlay()
      }
    }
  }

  var volume: Double = 1.0 {
    didSet {
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        let v = Float(max(0, min(1, self.volume)))
        self.avBridge?.setVolume(v)
        self.vlcBridge?.setVolume(Int32(v * 200)) // VLC: 0-200
      }
    }
  }

  var muted: Bool = false {
    didSet {
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.avBridge?.setMuted(self.muted)
        self.vlcBridge?.setMuted(self.muted)
      }
    }
  }

  var shouldRepeat: Bool = false {
    didSet {
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.avBridge?.enableRepeat(self.shouldRepeat)
        self.vlcBridge?.setRepeat(self.shouldRepeat)
      }
    }
  }

  var progressInterval: Double = 500.0 {
    didSet {
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        // Convert ms → seconds for AVPlayer
        self.avBridge?.setProgressInterval(self.progressInterval / 1000.0)
      }
    }
  }

  var resizeMode: ResizeMode = .contain {
    didSet {
      DispatchQueue.main.async { [weak self] in
        self?.applyResizeMode()
      }
    }
  }

  var zoomEnabled: Bool = false


  // MARK: - Callbacks

  var onReady: ((_ event: ReadyEvent) -> Void)? = nil
  var onProgress: ((_ event: ProgressEvent) -> Void)? = nil
  var onBuffering: ((_ isBuffering: Bool) -> Void)? = nil
  var onStateChange: ((_ state: PlaybackState) -> Void)? = nil
  var onError: ((_ event: ErrorEvent) -> Void)? = nil
  var onEnd: (() -> Void)? = nil

  // MARK: - Player lifecycle

  /// True when RTSP stream was stopped (pause or error) and needs URL reload on next play.
  /// Most IP cameras don't support RFC 2326 PAUSE, so pause = disconnect; play = reconnect.
  private var _rtspNeedsReconnect = false

  private func reloadPlayer() {
    guard !url.isEmpty else { return }
    activeProtocol = streamProtocol
    onStateChange?(.loading)

    switch activeProtocol {
    case .hls, .mp4:
      // Stop VLC completely to free its network buffers before switching
      vlcBridge?.stop()
      avBridge?.attach(to: containerView)
      avBridge?.load(url: url)
      // AVPlayer: play() called inside onReady (AVPlayer prepares async before ready)

    case .rtsp:
      // Stop AVPlayer before switching to VLC
      avBridge?.stop()
      vlcBridge?.attach(to: containerView)
      vlcBridge?.load(url: url)
      // VLC MUST call play() immediately to START the RTSP connection.
      // Unlike AVPlayer, VLC only fires .playing (our onReady) AFTER play() is called.
      // Waiting for onReady to call play() creates a deadlock → black screen.
      if !paused { vlcBridge?.play() }
    }
  }

  private func activePlay() {
    switch activeProtocol {
    case .hls, .mp4:
      avBridge?.play()

    case .rtsp:
      if _rtspNeedsReconnect {
        // Most IP cameras disconnect on PAUSE (don't support RFC 2326 PAUSE).
        // Reload the URL to reconnect the stream.
        _rtspNeedsReconnect = false
        vlcBridge?.load(url: url)
        vlcBridge?.play()
      } else {
        vlcBridge?.play()
      }
    }
  }

  private func activePause() {
    switch activeProtocol {
    case .hls, .mp4:
      avBridge?.pause()

    case .rtsp:
      // Try VLC pause. If the server doesn't support PAUSE, VLC will fire
      // .stopped state → onEnd callback → we set _rtspNeedsReconnect = true
      // so the next play() call will reconnect.
      vlcBridge?.pause()
    }
  }

  // MARK: - Methods

  func play()  throws { paused = false }
  func pause() throws { paused = true }
  func stop()  throws {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.avBridge?.stop()
      self.vlcBridge?.stop()
      self.onStateChange?(.idle)
    }
  }

  func seekTo(positionSeconds: Double) throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        promise.reject(withError: NSError(domain: "StreamingVideo", code: -1, userInfo: [NSLocalizedDescriptionKey: "Player deallocated"]))
        return
      }
      switch self.activeProtocol {
      case .hls, .mp4:
        self.avBridge?.seek(to: positionSeconds) { finished in
          if finished {
            promise.resolve(withResult: ())
          } else {
            promise.reject(withError: NSError(
              domain: "StreamingVideo", code: 2,
              userInfo: [NSLocalizedDescriptionKey: "AVPlayer seek failed"]))
          }
        }
      case .rtsp:
        self.vlcBridge?.seek(to: positionSeconds) { success in
          if success {
            promise.resolve(withResult: ())
          } else {
            promise.reject(withError: NSError(
              domain: "StreamingVideo", code: 2,
              userInfo: [NSLocalizedDescriptionKey: "VLC seek failed (stream not seekable)"]))
          }
        }
      }
    }
    return promise
  }

  func getCurrentTime() throws -> Promise<Double> {
    let promise = Promise<Double>()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        promise.resolve(withResult: 0.0)
        return
      }
      switch self.activeProtocol {
      case .hls, .mp4: promise.resolve(withResult: self.avBridge?.currentTime ?? 0.0)
      case .rtsp:       promise.resolve(withResult: self.vlcBridge?.currentTime ?? 0.0)
      }
    }
    return promise
  }

  func getDuration() throws -> Promise<Double> {
    let promise = Promise<Double>()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        promise.resolve(withResult: -1.0)
        return
      }
      switch self.activeProtocol {
      case .hls, .mp4: promise.resolve(withResult: self.avBridge?.duration ?? -1.0)
      case .rtsp:       promise.resolve(withResult: self.vlcBridge?.duration ?? -1.0)
      }
    }
    return promise
  }

  func presentAirPlayPicker() throws {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let picker = AVRoutePickerView()
      picker.activeTintColor = .white
      self.containerView.addSubview(picker)
      picker.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
    }
  }

  func takeScreenshot() throws -> Promise<String> {
    let promise = Promise<String>()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        promise.reject(withError: NSError(domain: "StreamingVideo", code: -1, userInfo: [NSLocalizedDescriptionKey: "Player deallocated"]))
        return
      }
      switch self.activeProtocol {
      case .hls, .mp4:
        self.avBridge?.takeScreenshot { path in
          if let path = path {
            promise.resolve(withResult: path)
          } else {
            promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "AVPlayer capture failed"]))
          }
        }
      case .rtsp:
        self.vlcBridge?.takeScreenshot { path in
          if let path = path {
            promise.resolve(withResult: path)
          } else {
            promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "VLC capture failed"]))
          }
        }
      }
    }
    return promise
  }

  // MARK: - Bridge bindings

  private func bindAVBridge() {
    avBridge?.onReady = { [weak self] duration, size in
      guard let self = self else { return }
      self.onReady?(.init(
        duration: duration,
        naturalSize: .init(width: Double(size.width), height: Double(size.height))
      ))
      self.onStateChange?(.ready)
      // Trigger play AFTER ready (async-safe) – fixes "paused but playing=false" bug
      if !self.paused { self.avBridge?.play() }
    }
    avBridge?.onProgress = { [weak self] current, total, playable in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: playable))
    }
    avBridge?.onBuffering = { [weak self] isBuffering in
      self?.onBuffering?(isBuffering)
      self?.onStateChange?(isBuffering ? .buffering : .playing)
    }
    avBridge?.onError = { [weak self] code, message in
      self?.onError?(.init(code: Double(code), message: message, nativeError: nil))
      self?.onStateChange?(.error)
    }
    avBridge?.onEnd = { [weak self] in
      self?.onEnd?()
      self?.onStateChange?(.ended)
    }
  }

  private func bindVLCBridge() {
    vlcBridge?.onReady = { [weak self] duration, _ in
      guard let self = self else { return }
      self.onReady?(.init(
        duration: duration,
        naturalSize: .init(width: 0, height: 0)
      ))
      self.onStateChange?(.ready)
      // NOTE: Do NOT call vlcBridge.play() here.
      // VLC's onReady fires from the .playing delegate state,
      // meaning VLC is ALREADY playing at this point.
      // Calling play() again would be a no-op at best, or cause stuttering.
    }
    vlcBridge?.onProgress = { [weak self] current, total, _ in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: 0))
    }
    vlcBridge?.onBuffering = { [weak self] isBuffering in
      self?.onBuffering?(isBuffering)
      self?.onStateChange?(isBuffering ? .buffering : .playing)
    }
    vlcBridge?.onError = { [weak self] code, message in
      self?.onError?(.init(code: Double(code), message: message, nativeError: nil))
      self?.onStateChange?(.error)
    }
    vlcBridge?.onEnd = { [weak self] in
      guard let self = self else { return }
      // If RTSP stream ends/disconnects (e.g. camera doesn't support PAUSE),
      // mark it so activePlay() will reload the URL on next play().
      if self.activeProtocol == .rtsp && self.paused {
        self._rtspNeedsReconnect = true
      }
      self.onEnd?()
      self.onStateChange?(.ended)
    }
  }

  // MARK: - Helpers

  private func applyResizeMode() {
    switch resizeMode {
    case .contain: avBridge?.setVideoGravity(.resizeAspect)
    case .cover:   avBridge?.setVideoGravity(.resizeAspectFill)
    case .fill:    avBridge?.setVideoGravity(.resize)
    }
    // VLC resize is handled by the drawable view's layout
  }

  // MARK: - Deinit (Memory leak prevention)

  deinit {
    layoutObserver = nil
    
    // Capture variables and release them on main thread to avoid background thread release crash
    let viewToRelease = containerView
    let avBridgeToRelease = avBridge
    let vlcBridgeToRelease = vlcBridge
    DispatchQueue.main.async {
      _ = viewToRelease
      _ = avBridgeToRelease
      _ = vlcBridgeToRelease
    }
  }
}
