import MobileVLCKit
import Foundation
import UIKit

final class VLCPlayerBridge: NSObject, VLCMediaPlayerDelegate {
  // Each VLCMediaPlayer instance creates its own decode thread + network buffers
  // → MEMORY LEAK RISK: must call stop() + set player.media = nil before release
  private(set) var player = VLCMediaPlayer()
  private weak var containerView: UIView?
  private var _isRepeating = false

  var onReady: ((Double, CGSize) -> Void)?
  var onProgress: ((Double, Double, CGSize) -> Void)?
  var onBuffering: ((Bool) -> Void)?
  var onError: ((Int, String) -> Void)?
  var onEnd: (() -> Void)?

  override init() {
    super.init()
    player.delegate = self
  }

  func attach(to view: UIView) {
    containerView = view
    view.setNeedsLayout()
    view.layoutIfNeeded()
    player.drawable = view
  }



  private func encodeRtspUrl(_ rawUrl: String) -> String {
    guard rawUrl.lowercased().hasPrefix("rtsp://") else { return rawUrl }
    let scheme = "rtsp://"
    let rest = String(rawUrl.dropFirst(scheme.count))
    
    let pathIndex = rest.firstIndex(of: "/") ?? rest.endIndex
    let authority = String(rest[..<pathIndex])
    let pathAndQuery = String(rest[pathIndex...])
    
    guard let lastAtIndex = authority.lastIndex(of: "@") else { return rawUrl }
    
    let userInfo = String(authority[..<lastAtIndex])
    let hostPort = String(authority[authority.index(after: lastAtIndex)...])
    
    let username: String
    let password: String
    if let colonIndex = userInfo.firstIndex(of: ":") {
        username = String(userInfo[..<colonIndex])
        password = String(userInfo[userInfo.index(after: colonIndex)...])
    } else {
        username = userInfo
        password = ""
    }
    
    let allowedChars = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: ":@?#/"))
    let encodedUser = username.addingPercentEncoding(withAllowedCharacters: allowedChars) ?? username
    let encodedPass = password.addingPercentEncoding(withAllowedCharacters: allowedChars) ?? password
    
    let newAuth = password.isEmpty ? "\(encodedUser)@\(hostPort)" : "\(encodedUser):\(encodedPass)@\(hostPort)"
    return "\(scheme)\(newAuth)\(pathAndQuery)"
  }

  func updateLayout(bounds: CGRect) {
    guard let containerView = containerView, bounds.width > 0, bounds.height > 0 else { return }
    for subview in containerView.subviews {
      subview.frame = bounds
    }
  }

  func load(url: String, options: [String] = [], headers: [String: String]? = nil) {
    player.stop()
    player.media = nil

    let cleanUrlString = encodeRtspUrl(url)
    guard let u = URL(string: cleanUrlString) ?? URL(string: cleanUrlString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") else { return }

    let media = VLCMedia(url: u)
    
    let lowerUrl = cleanUrlString.lowercased()
    let isHls = lowerUrl.contains(".m3u8")
    let isRtsp = lowerUrl.hasPrefix("rtsp://")

    if isHls {
      // 💡 Cho luồng HLS live:
      // Chunks HLS tải qua HTTP theo đợt (2-3s/chunk).
      // Buffer 3500ms để luôn có sẵn ít nhất 1.5 chunks trong bộ nhớ đệm, tránh khựng hình.
      // Không đặt clock-jitter=0 và clock-synchro=0 vì HTTP chunking có độ trễ tự nhiên giữa các chunk,
      // để VLC tự đồng bộ PTS mượt mà không bị drop khung hình.
      media.addOption(":network-caching=3500")
      media.addOption(":live-caching=3500")
      media.addOption(":file-caching=3000")
    } else if isRtsp {
      media.addOption(":rtsp-tcp")
      media.addOption(":network-caching=3000") // 💡 Tăng lên 3000ms
      media.addOption(":live-caching=2000")
      media.addOption(":rtsp-caching=3000")
      media.addOption(":clock-jitter=500")
      media.addOption(":clock-synchro=0")
    } else {
      media.addOption(":network-caching=3000")
      media.addOption(":live-caching=3000")
    }

    if let h = headers {
      for (key, value) in h {
        if key.caseInsensitiveCompare("User-Agent") == .orderedSame {
          media.addOption(":http-user-agent=\(value)")
        } else if key.caseInsensitiveCompare("Referer") == .orderedSame || key.caseInsensitiveCompare("Referrer") == .orderedSame {
          media.addOption(":http-referrer=\(value)")
        }
      }
    }

    #if targetEnvironment(simulator)
    media.addOption(":avcodec-hw=none")
    #endif

    player.media = media
  }

  func play()   { player.play() }
  func pause()  { player.pause() }

  func stop() {
    player.stop()
    // Nil out media to free native network buffers immediately
    player.media = nil
  }

  func detach() {
    player.stop()
    player.media = nil
    player.drawable = nil
    containerView = nil
  }

  func setMuted(_ muted: Bool) { player.audio?.isMuted = muted }
  func setVolume(_ volume: Int32) { player.audio?.volume = volume }  // 0-200

  func setRepeat(_ enabled: Bool) { _isRepeating = enabled }

  func seek(to seconds: Double, completion: @escaping (Bool) -> Void) {
    guard player.isSeekable else { completion(false); return }
    let ms = Int32(seconds * 1000)
    player.time = VLCTime(int: ms)
    completion(true)
  }

  var currentTime: Double { Double(player.time.intValue) / 1000.0 }
  var duration: Double {
    let ms = player.media?.length.intValue ?? -1
    return ms < 0 ? -1 : Double(ms) / 1000.0
  }

  // MARK: - VLCMediaPlayerDelegate

  func mediaPlayerStateChanged(_ aNotification: Notification) {
    switch player.state {
    case .opening:
      onBuffering?(true)
    case .playing:
      if let bounds = containerView?.bounds, bounds.width > 0, bounds.height > 0 {
        updateLayout(bounds: bounds)
      }
      onBuffering?(false)
      onReady?(duration, .zero)
    case .buffering:
      onBuffering?(true)
    case .error:
      onError?(-1, "VLCPlayer stream error")
    case .ended:
      if _isRepeating {
        // Seek to beginning and replay
        player.time = VLCTime(int: 0)
        player.play()
      } else {
        onEnd?()
      }
    case .stopped:
      break
    default: break
    }
  }

  func mediaPlayerTimeChanged(_ aNotification: Notification) {
    onBuffering?(false)
    if let bounds = containerView?.bounds, bounds.width > 0, bounds.height > 0 {
      updateLayout(bounds: bounds)
    }
    onProgress?(currentTime, duration, .zero)
  }

  // MARK: - Screenshot

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

  func takeScreenshot(completion: @escaping (String?) -> Void) {
    pruneSnapshotCache()
    let filename = "snapshot_\(Int(Date().timeIntervalSince1970)).jpg"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

    // MobileVLCKit's saveVideoSnapshot(at:withWidth:andHeight:) returns Void in Swift bindings.
    // We invoke it and then verify file existence to determine success.
    player.saveVideoSnapshot(at: url.path, withWidth: 0, andHeight: 0)

    var attempts = 0
    let maxAttempts = 20
    let delay = 0.05 // 50ms

    func checkFile() {
      if FileManager.default.fileExists(atPath: url.path) {
        completion(url.path)
      } else if attempts < maxAttempts {
        attempts += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
          checkFile()
        }
      } else {
        completion(nil)
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      checkFile()
    }
  }

  deinit {
    // Critical: stop and release all native resources
    // Failure to do this causes retained decode threads → memory leak
    stop()
    player.delegate = nil
  }
}

