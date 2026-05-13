import Foundation
import UIKit
import AVFoundation
import AVKit
import NitroModules

class HybridVideoPlayerView: HybridVideoPlayerViewSpec {

  // MARK: - Native view

  private let containerView: UIView = {
    let v = UIView()
    v.backgroundColor = .black
    v.clipsToBounds = true
    return v
  }()
  var view: UIView { containerView }

  // MARK: - Bridges

  private let avBridge  = AVPlayerBridge()
  private let vlcBridge = VLCPlayerBridge()
  private var activeProtocol: StreamProtocol = .hls

  // MARK: - Init

  override init() {
    super.init()
    bindAVBridge()
    bindVLCBridge()
    setupLayoutObserver()
  }

  // MARK: - Layout (fixes AVPlayerLayer not tracking view size)

  private var layoutObserver: NSKeyValueObservation?

  private func setupLayoutObserver() {
    // Observe containerView.bounds so AVPlayerLayer stays in sync on rotation/resize
    layoutObserver = containerView.observe(\.bounds, options: [.new]) { [weak self] view, _ in
      DispatchQueue.main.async {
        self?.avBridge.updateLayout(bounds: view.bounds)
      }
    }
  }

  // MARK: - Props

  var url: String = "" {
    didSet {
      guard url != oldValue, !url.isEmpty else { return }
      reloadPlayer()
    }
  }

  var streamProtocol: StreamProtocol = .hls {
    didSet {
      guard streamProtocol != oldValue else { return }
      reloadPlayer()
    }
  }

  var paused: Bool = false {
    didSet {
      guard paused != oldValue else { return }
      paused ? activePause() : activePlay()
    }
  }

  var volume: Double = 1.0 {
    didSet {
      let v = Float(max(0, min(1, volume)))
      avBridge.setVolume(v)
      vlcBridge.setVolume(Int32(v * 200)) // VLC: 0-200
    }
  }

  var muted: Bool = false {
    didSet {
      avBridge.setMuted(muted)
      vlcBridge.setMuted(muted)
    }
  }

  var shouldRepeat: Bool = false {
    didSet {
      avBridge.enableRepeat(shouldRepeat)
      vlcBridge.setRepeat(shouldRepeat)
    }
  }

  var progressInterval: Double = 500.0 {
    didSet {
      // Convert ms → seconds for AVPlayer
      avBridge.setProgressInterval(progressInterval / 1000.0)
    }
  }

  var resizeMode: ResizeMode = .contain {
    didSet { applyResizeMode() }
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
      vlcBridge.stop()
      avBridge.attach(to: containerView)
      avBridge.load(url: url)
      // AVPlayer: play() called inside onReady (AVPlayer prepares async before ready)

    case .rtsp:
      // Stop AVPlayer before switching to VLC
      avBridge.stop()
      vlcBridge.attach(to: containerView)
      vlcBridge.load(url: url)
      // VLC MUST call play() immediately to START the RTSP connection.
      // Unlike AVPlayer, VLC only fires .playing (our onReady) AFTER play() is called.
      // Waiting for onReady to call play() creates a deadlock → black screen.
      if !paused { vlcBridge.play() }
    }
  }

  private func activePlay() {
    switch activeProtocol {
    case .hls, .mp4:
      avBridge.play()

    case .rtsp:
      if _rtspNeedsReconnect {
        // Most IP cameras disconnect on PAUSE (don't support RFC 2326 PAUSE).
        // Reload the URL to reconnect the stream.
        _rtspNeedsReconnect = false
        vlcBridge.load(url: url)
        vlcBridge.play()
      } else {
        vlcBridge.play()
      }
    }
  }

  private func activePause() {
    switch activeProtocol {
    case .hls, .mp4:
      avBridge.pause()

    case .rtsp:
      // Try VLC pause. If the server doesn't support PAUSE, VLC will fire
      // .stopped state → onEnd callback → we set _rtspNeedsReconnect = true
      // so the next play() call will reconnect.
      vlcBridge.pause()
    }
  }

  // MARK: - Methods

  func play()  throws { paused = false }
  func pause() throws { paused = true }
  func stop()  throws {
    avBridge.stop()
    vlcBridge.stop()
    onStateChange?(.idle)
  }

  func seekTo(positionSeconds: Double) throws -> Promise<Void> {
    let promise = Promise<Void>()
    switch activeProtocol {
    case .hls, .mp4:
      avBridge.seek(to: positionSeconds) { finished in
        if finished {
          promise.resolve(withResult: ())
        } else {
          promise.reject(withError: NSError(
            domain: "StreamingVideo", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "AVPlayer seek failed"]))
        }
      }
    case .rtsp:
      vlcBridge.seek(to: positionSeconds) { success in
        if success {
          promise.resolve(withResult: ())
        } else {
          promise.reject(withError: NSError(
            domain: "StreamingVideo", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "VLC seek failed (stream not seekable)"]))
        }
      }
    }
    return promise
  }

  func getCurrentTime() throws -> Promise<Double> {
    let promise = Promise<Double>()
    switch activeProtocol {
    case .hls, .mp4: promise.resolve(withResult: avBridge.currentTime)
    case .rtsp:       promise.resolve(withResult: vlcBridge.currentTime)
    }
    return promise
  }

  func getDuration() throws -> Promise<Double> {
    let promise = Promise<Double>()
    switch activeProtocol {
    case .hls, .mp4: promise.resolve(withResult: avBridge.duration)
    case .rtsp:       promise.resolve(withResult: vlcBridge.duration)
    }
    return promise
  }

  func presentAirPlayPicker() throws {
    let picker = AVRoutePickerView()
    picker.activeTintColor = .white
    containerView.addSubview(picker)
    picker.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
  }

  func takeScreenshot() throws -> Promise<String> {
    let promise = Promise<String>()
    switch activeProtocol {
    case .hls, .mp4:
      avBridge.takeScreenshot { path in
        if let path = path {
          promise.resolve(withResult: path)
        } else {
          promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "AVPlayer capture failed"]))
        }
      }
    case .rtsp:
      vlcBridge.takeScreenshot { path in
        if let path = path {
          promise.resolve(withResult: path)
        } else {
          promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "VLC capture failed"]))
        }
      }
    }
    return promise
  }

  // MARK: - Bridge bindings

  private func bindAVBridge() {
    avBridge.onReady = { [weak self] duration, size in
      guard let self = self else { return }
      self.onReady?(.init(
        duration: duration,
        naturalSize: .init(width: Double(size.width), height: Double(size.height))
      ))
      self.onStateChange?(.ready)
      // Trigger play AFTER ready (async-safe) – fixes "paused but playing=false" bug
      if !self.paused { self.avBridge.play() }
    }
    avBridge.onProgress = { [weak self] current, total, playable in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: playable))
    }
    avBridge.onBuffering = { [weak self] isBuffering in
      self?.onBuffering?(isBuffering)
      self?.onStateChange?(isBuffering ? .buffering : .playing)
    }
    avBridge.onError = { [weak self] code, message in
      self?.onError?(.init(code: Double(code), message: message, nativeError: nil))
      self?.onStateChange?(.error)
    }
    avBridge.onEnd = { [weak self] in
      self?.onEnd?()
      self?.onStateChange?(.ended)
    }
  }

  private func bindVLCBridge() {
    vlcBridge.onReady = { [weak self] duration, _ in
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
    vlcBridge.onProgress = { [weak self] current, total, _ in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: 0))
    }
    vlcBridge.onBuffering = { [weak self] isBuffering in
      self?.onBuffering?(isBuffering)
      self?.onStateChange?(isBuffering ? .buffering : .playing)
    }
    vlcBridge.onError = { [weak self] code, message in
      self?.onError?(.init(code: Double(code), message: message, nativeError: nil))
      self?.onStateChange?(.error)
    }
    vlcBridge.onEnd = { [weak self] in
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
    case .contain: avBridge.setVideoGravity(.resizeAspect)
    case .cover:   avBridge.setVideoGravity(.resizeAspectFill)
    case .fill:    avBridge.setVideoGravity(.resize)
    }
    // VLC resize is handled by the drawable view's layout
  }

  // MARK: - Deinit (Memory leak prevention)

  deinit {
    layoutObserver = nil
    // Bridges will clean up their own native resources in their deinit
  }
}
