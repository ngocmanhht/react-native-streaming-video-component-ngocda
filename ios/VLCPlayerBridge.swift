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

  func updateLayout(bounds: CGRect) {
    guard let containerView = containerView, bounds.width > 0, bounds.height > 0 else { return }
    for subview in containerView.subviews {
      subview.frame = bounds
    }
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
    let encodedPass = password.addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? password
    
    let newAuth = password.isEmpty ? "\(encodedUser)@\(hostPort)" : "\(encodedUser):\(encodedPass)@\(hostPort)"
    return "\(scheme)\(newAuth)\(pathAndQuery)"
  }

  func load(url: String, options: [String] = []) {
    // Stop current stream and nil out media before loading new URL.
    // Setting player.media = nil releases the native network buffers (~50MB/stream).
    // In Swift ARC, we do NOT call release() manually – ARC handles it when
    // 'media' goes out of scope at the end of this function.
    player.stop()
    player.media = nil

    let cleanUrlString = encodeRtspUrl(url)
    guard let u = URL(string: cleanUrlString) else { return }
    var mediaOptions: [String: Any] = [
      ":rtsp-tcp": true,         // Force TCP – more reliable over NAT/firewall
      ":network-caching": 1000,  // 1000 ms network buffer – WAN/4G stability
    ]

    let media = VLCMedia(url: u)
    media.addOptions(mediaOptions)
    player.media = media
    // ARC will release 'media' local var here automatically – no manual release() needed
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
      onBuffering?(false)
      onReady?(duration, .zero)
    case .buffering:
      onBuffering?(true)
    case .error:
      onError?(-1, "VLCPlayer stream error")
    case .ended, .stopped:
      if _isRepeating {
        // Seek to beginning and replay
        player.time = VLCTime(int: 0)
        player.play()
      } else {
        onEnd?()
      }
    default: break
    }
  }

  func mediaPlayerTimeChanged(_ aNotification: Notification) {
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

    if FileManager.default.fileExists(atPath: url.path) {
      completion(url.path)
    } else {
      completion(nil)
    }
  }

  deinit {
    // Critical: stop and release all native resources
    // Failure to do this causes retained decode threads → memory leak
    stop()
    player.delegate = nil
  }
}

