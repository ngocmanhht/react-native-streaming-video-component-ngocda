import Foundation
import UIKit
import AVFoundation
import AVKit
import NitroModules

private class HybridVideoPlayerContainerView: UIView {
  var onLayoutSubviews: ((CGRect) -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayoutSubviews?(bounds)
  }
}

class HybridVideoPlayerView: HybridVideoPlayerViewSpec {

  // MARK: - Native view

  private lazy var containerView: HybridVideoPlayerContainerView = {
    let v = HybridVideoPlayerContainerView()
    v.backgroundColor = .black
    v.clipsToBounds = true
    v.onLayoutSubviews = { [weak self] bounds in
      guard let self = self else { return }
      self.avBridge?.updateLayout(bounds: bounds)
      
      // Update VLC rendering subviews frame on bounds change
      if self.useVlcFallback || self.activeProtocol == .rtsp {
        for subview in v.subviews {
          if !(subview is AVRoutePickerView) {
            subview.frame = bounds
          }
        }
      }
    }
    return v
  }()
  var view: UIView { containerView }

  // MARK: - Bridges

  private var avBridge: AVPlayerBridge?
  private var vlcBridge: VLCPlayerBridge?
  private var activeProtocol: StreamProtocol = .hls
  private var useVlcFallback = false

  // MARK: - Init

  override init() {
    super.init()
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.avBridge = AVPlayerBridge()
      self.vlcBridge = VLCPlayerBridge()
      self.bindAVBridge()
      self.bindVLCBridge()
      
      // If a URL was set before main-thread initialization completed, load it now
      if !self.url.isEmpty {
        self.reloadPlayer()
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
  var isLive: Bool = false {
    didSet {
      guard isLive != oldValue else { return }
      DispatchQueue.main.async { [weak self] in
        self?.reloadPlayer()
      }
    }
  }


  // MARK: - Callbacks

  var onReady: ((_ event: ReadyEvent) -> Void)? = nil
  var onProgress: ((_ event: ProgressEvent) -> Void)? = nil
  var onBuffering: ((_ isBuffering: Bool) -> Void)? = nil
  var onStateChange: ((_ state: PlaybackState) -> Void)? = nil
  var onError: ((_ event: ErrorEvent) -> Void)? = nil
  var onEnd: (() -> Void)? = nil

  // MARK: - Helper Utilities

  private func sanitizeUrl(_ rawUrl: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: "(://[^:]+:)[^@]+(@)", options: []) else { return rawUrl }
    let range = NSRange(location: 0, length: rawUrl.utf16.count)
    return regex.stringByReplacingMatches(in: rawUrl, options: [], range: range, withTemplate: "$1***$2")
  }

  // MARK: - Reconnect Logic

  private var retryCount = 0
  private let maxRetries = 5
  private var reconnectWorkItem: DispatchWorkItem?

  private func scheduleReconnect() {
    guard !paused, retryCount < maxRetries else {
      onStateChange?(.error)
      return
    }
    retryCount += 1
    let delay = min(Double(1 << (retryCount - 1)), 10.0) // 1s, 2s, 4s, 8s, 10s
    onStateChange?(.reconnecting)

    reconnectWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      guard let self = self, !self.paused, !self.url.isEmpty else { return }
      self.reloadPlayer()
    }
    reconnectWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
  }

  // MARK: - Player lifecycle

  /// True when RTSP stream was stopped (pause or error) and needs URL reload on next play.
  private var _rtspNeedsReconnect = false

  private func reloadPlayer() {
    guard !url.isEmpty else { return }
    let lowerUrl = url.lowercased()
    if lowerUrl.hasPrefix("rtsp://") {
      activeProtocol = .rtsp
    } else if lowerUrl.hasPrefix("rtmp://") || lowerUrl.hasPrefix("rtmps://") {
      activeProtocol = .rtmp
    } else if lowerUrl.contains(".m3u8") {
      activeProtocol = .hls
    } else if lowerUrl.contains(".mp4") {
      activeProtocol = .mp4
    } else {
      activeProtocol = streamProtocol
    }

    useVlcFallback = false
    onStateChange?(.loading)

    switch activeProtocol {
    case .hls, .mp4:
      loadAVPlayer(isLiveStream: isLive)

    case .rtsp, .rtmp:
      loadVlc()
    }
  }

  private func loadAVPlayer(isLiveStream: Bool) {
    vlcBridge?.stop()
    avBridge?.attach(to: containerView)
    avBridge?.load(url: url, isLiveStream: isLiveStream)
  }

  private func loadVlc() {
    avBridge?.stop()
    vlcBridge?.attach(to: containerView)
    vlcBridge?.load(url: url)
    if !paused { vlcBridge?.play() }
  }

  private func activePlay() {
    reconnectWorkItem?.cancel()
    if useVlcFallback {
      vlcBridge?.play()
      return
    }
    switch activeProtocol {
    case .hls, .mp4:
      avBridge?.play()

    case .rtsp, .rtmp:
      if _rtspNeedsReconnect {
        _rtspNeedsReconnect = false
        vlcBridge?.load(url: url)
        vlcBridge?.play()
      } else {
        vlcBridge?.play()
      }
    }
  }

  private func activePause() {
    reconnectWorkItem?.cancel()
    if useVlcFallback {
      vlcBridge?.pause()
      return
    }
    switch activeProtocol {
    case .hls, .mp4:
      avBridge?.pause()

    case .rtsp, .rtmp:
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
      if self.useVlcFallback {
        self.vlcBridge?.seek(to: positionSeconds) { success in
          if success {
            promise.resolve(withResult: ())
          } else {
            promise.reject(withError: NSError(domain: "StreamingVideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "VLC seek failed"]))
          }
        }
      } else {
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
        case .rtsp, .rtmp:
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
      if self.useVlcFallback {
        promise.resolve(withResult: self.vlcBridge?.currentTime ?? 0.0)
      } else {
        switch self.activeProtocol {
        case .hls, .mp4: promise.resolve(withResult: self.avBridge?.currentTime ?? 0.0)
        case .rtsp, .rtmp: promise.resolve(withResult: self.vlcBridge?.currentTime ?? 0.0)
        }
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
      if self.useVlcFallback {
        promise.resolve(withResult: self.vlcBridge?.duration ?? -1.0)
      } else {
        switch self.activeProtocol {
        case .hls, .mp4: promise.resolve(withResult: self.avBridge?.duration ?? -1.0)
        case .rtsp, .rtmp: promise.resolve(withResult: self.vlcBridge?.duration ?? -1.0)
        }
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
      if self.useVlcFallback {
        self.vlcBridge?.takeScreenshot { path in
          if let path = path {
            promise.resolve(withResult: path)
          } else {
            promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "VLC capture failed"]))
          }
        }
      } else {
        switch self.activeProtocol {
        case .hls, .mp4:
          self.avBridge?.takeScreenshot { path in
            if let path = path {
              promise.resolve(withResult: path)
            } else {
              promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "AVPlayer capture failed"]))
            }
          }
        case .rtsp, .rtmp:
          self.vlcBridge?.takeScreenshot { path in
            if let path = path {
              promise.resolve(withResult: path)
            } else {
              promise.reject(withError: NSError(domain: "StreamingVideo", code: 3, userInfo: [NSLocalizedDescriptionKey: "VLC capture failed"]))
            }
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
      if !self.paused { self.avBridge?.play() }
    }
    avBridge?.onProgress = { [weak self] current, total, playable in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: playable))
    }
    avBridge?.onBuffering = { [weak self] isBuffering in
      guard let self = self else { return }
      self.onBuffering?(isBuffering)
      if isBuffering {
        self.onStateChange?(.buffering)
      } else {
        self.onStateChange?(self.paused ? .paused : .playing)
      }
    }
    avBridge?.onError = { [weak self] code, message in
      guard let self = self else { return }
      if (self.activeProtocol == .hls || self.activeProtocol == .mp4) && !self.useVlcFallback {
        print("StreamingVideo: AVPlayer failed with code \(code) (\(message)), falling back to VLCPlayer")
        self.useVlcFallback = true
        DispatchQueue.main.async {
          self.loadVlc()
        }
      } else {
        self.onError?(.init(code: Double(code), message: message, protocol: self.activeProtocol, nativeError: nil, recoverable: false))
        self.onStateChange?(.error)
      }
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
    }
    vlcBridge?.onProgress = { [weak self] current, total, _ in
      self?.onProgress?(.init(currentTime: current, duration: total, playableDuration: 0))
    }
    vlcBridge?.onBuffering = { [weak self] isBuffering in
      guard let self = self else { return }
      self.onBuffering?(isBuffering)
      if isBuffering {
        self.onStateChange?(.buffering)
      } else {
        self.onStateChange?(self.paused ? .paused : .playing)
      }
    }
    vlcBridge?.onError = { [weak self] code, message in
      guard let self = self else { return }
      self.onError?(.init(code: Double(code), message: message, protocol: self.activeProtocol, nativeError: nil, recoverable: true))
      if self.activeProtocol == .rtsp || self.activeProtocol == .rtmp {
        self.scheduleReconnect()
      } else {
        self.onStateChange?(.error)
      }
    }
    vlcBridge?.onEnd = { [weak self] in
      guard let self = self else { return }
      if (self.activeProtocol == .rtsp || self.activeProtocol == .rtmp) && self.paused {
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
  }

  // MARK: - Deinit (Memory leak prevention)

  deinit {
    reconnectWorkItem?.cancel()
    let av = avBridge
    let vlc = vlcBridge
    DispatchQueue.main.async {
      av?.stop()
      vlc?.stop()
    }
  }
}
