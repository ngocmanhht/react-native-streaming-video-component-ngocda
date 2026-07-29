import type { HybridView, HybridViewProps, HybridViewMethods } from 'react-native-nitro-modules'

// ── Enums ──────────────────────────────────────────────────────────────────

export type StreamProtocol = 'hls' | 'rtsp' | 'rtmp' | 'mp4'

export type ResizeMode = 'contain' | 'cover' | 'fill'

export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'reconnecting'
  | 'error'
  | 'ended'

// ── Event payloads ─────────────────────────────────────────────────────────

export interface NaturalSize {
  width: number
  height: number
}

export interface ProgressEvent {
  currentTime: number // seconds
  duration: number // seconds, -1 if unknown (live stream)
  playableDuration: number
}

export interface ErrorEvent {
  code: number
  message: string
  streamProtocol?: StreamProtocol
  nativeError?: string
  recoverable?: boolean
}

export interface ReadyEvent {
  duration: number
  naturalSize: NaturalSize
}

// ── Props & Methods ────────────────────────────────────────────────────────

export interface VideoPlayerProps extends HybridViewProps {
  url: string
  streamProtocol: StreamProtocol
  paused: boolean
  resizeMode: ResizeMode
  volume: number // 0.0 – 1.0
  muted: boolean
  shouldRepeat: boolean
  progressInterval: number // ms, default 500
  zoomEnabled: boolean // Enable pinch-to-zoom
  isLive: boolean // If true, optimizes for low-latency live streaming (reduces buffers, disables auto-wait on stall)

  // Callbacks
  onReady?: (event: ReadyEvent) => void
  onProgress?: (event: ProgressEvent) => void
  onBuffering?: (isBuffering: boolean) => void
  onStateChange?: (state: PlaybackState) => void
  onError?: (event: ErrorEvent) => void
  onEnd?: () => void
}

export interface VideoPlayerMethods extends HybridViewMethods {
  play(): void
  pause(): void
  stop(): void
  seekTo(positionSeconds: number): Promise<void>
  getCurrentTime(): Promise<number>
  getDuration(): Promise<number>
  /** iOS only — cast to AirPlay */
  presentAirPlayPicker(): void
  /** Captures the current video frame and returns the file URI */
  takeScreenshot(): Promise<string>
}

export type VideoPlayerView = HybridView<VideoPlayerProps, VideoPlayerMethods>
