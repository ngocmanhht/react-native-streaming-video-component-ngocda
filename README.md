# react-native-streaming-video-component-ngocda

<p align="center">
  <strong>High-performance streaming video component for React Native New Architect</strong><br/>
  Built with <a href="https://nitro.margelo.com">Nitro Modules</a> for zero-overhead native communication
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-blue" />
  <img src="https://img.shields.io/badge/protocol-HLS%20%7C%20RTSP%20%7C%20RTMP%20%7C%20MP4-green" />
  <img src="https://img.shields.io/badge/architecture-Fabric%20(New%20Architecture)-orange" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" />
</p>

---

## Overview

`react-native-streaming-video-component-ngocda` is a production-grade video streaming library for React Native (New Architecture / Fabric). It provides a unified `<VideoPlayer>` component that automatically routes streams to the most appropriate native engine based on protocol:

| Protocol | iOS Engine | Android Engine | Feature Highlights |
|:---------|:-----------|:---------------|:-------------------|
| **HLS** (`.m3u8`) | `AVPlayer` | `ExoPlayer (Media3)` | Low-latency HLS (`isLive`), smooth VOD buffering |
| **MP4** / progressive | `AVPlayer` | `ExoPlayer (Media3)` | Frame-accurate seeking, loop repeat |
| **RTSP** (`rtsp://`) | `MobileVLCKit` | `LibVLC 3.6` | Direct LibVLC TCP mode — **< 500ms** startup, auto-reconnect |
| **RTMP** (`rtmp://`) | `MobileVLCKit` | `LibVLC 3.6` | Live streaming, instant connection, auto-reconnect |

---

## ✨ Features

- ⚡ **Nitro Modules Powered** — JSI-based native binding with zero bridge serialization overhead
- 📡 **Multi-Protocol** — Unified component supporting HLS, RTSP, RTMP, and MP4 streams
- 🚀 **Sub-500ms RTSP/RTMP Startup** — LibVLC routing bypasses ExoPlayer's slow RTSP authentication
- 🔄 **Smart Exponential Backoff Auto-Reconnect** — Auto-reconnects on stream interruptions (1s, 2s, 4s, 8s, 10s retries)
- 🔒 **Credential Security & Log Masking** — Automatically masks passwords in RTSP/RTMP URLs (`rtsp://admin:***@host`)
- 🖥 **Seamless Fullscreen** — Single-tree native mounting prevents black screen flashes & stream restarts on orientation toggle
- 🎨 **Built-in Professional Controls** — Play/Pause, Seek, Volume, Fullscreen, Frame Capture
- 🔍 **Pinch-to-Zoom** — Smooth gesture-based zoom with pan support (up to 5×) in fullscreen
- 📸 **Frame Capture** — Native screenshot of the current video frame with automatic disk cache pruning
- 🌐 **Auto Fullscreen** — Orientation-locked fullscreen via `react-native-orientation-locker`
- 🔇 **Mute / Volume Control** — Independent mute toggle and fine-grained volume slider
- 🔁 **Repeat Mode** — Seamless loop for MP4/HLS content
- 📐 **Resize Modes** — `contain`, `cover`, `fill`
- 🎛 **Controlled & Uncontrolled Modes** — Drive playback via props or imperative `useVideoPlayer()` ref

---

## 📦 Installation

See the full setup guide: 👉 **[Installation Guide](installation.md)**

```bash
yarn add react-native-streaming-video-component-ngocda
```

---

## 🛠 Quick Start

```tsx
import { VideoPlayer } from 'react-native-streaming-video-component-ngocda';

// HLS stream
<VideoPlayer
  url="https://example.com/live/stream.m3u8"
  streamProtocol="hls"
  showControls
  style={{ width: '100%', height: 220 }}
/>

// RTSP IP camera — instant startup via LibVLC with auto-reconnect
<VideoPlayer
  url="rtsp://admin:123456@192.168.1.100:554/stream"
  streamProtocol="rtsp"
  showControls
  showCameraButton
  onCapture={(path) => console.log('Snapshot saved to:', path)}
  style={{ width: '100%', height: 220 }}
/>

// RTMP live stream
<VideoPlayer
  url="rtmp://live.example.com/app/stream_key"
  streamProtocol="rtmp"
  showControls
  style={{ width: '100%', height: 220 }}
/>
```

For full usage examples: 👉 **[Usage Guide](usage.md)**

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────┐
│                  <VideoPlayer />                      │
│  React component — manages state, gestures, UI       │
├──────────────────────────────────────────────────────┤
│             useVideoPlayer() hook                     │
│  Stateful bridge: play/pause/seek/volume/screenshot  │
├─────────────────────┬────────────────────────────────┤
│   NativeVideoPlayer │  Nitro HybridView (JSI)        │
│   (iOS: Swift)      │  (Android: Kotlin + JNI)       │
├─────────────┬───────┴────────────┬───────────────────┤
│  AVPlayer   │  ExoPlayer (Media3)│  LibVLC           │
│  (HLS/MP4)  │  (HLS/MP4)        │ (RTSP/RTMP all)   │
└─────────────┴────────────────────┴───────────────────┘
```

---

## 🔌 Props Reference

| Prop | Type | Default | Description |
|:-----|:-----|:--------|:------------|
| `url` | `string` | **required** | Stream URL. Supports `rtsp://`, `rtmp://`, `https://…m3u8`, `https://…mp4` |
| `streamProtocol` | `'hls' \| 'rtsp' \| 'rtmp' \| 'mp4'` | `'hls'` | Hint for the routing engine. Auto-detected from URL if possible |
| `paused` | `boolean` | `false` | Controlled playback state |
| `volume` | `number` | `1.0` | Initial volume `0.0 – 1.0` |
| `muted` | `boolean` | `true` | Initial muted state |
| `showControls` | `boolean` | `false` | Show built-in control overlay |
| `showCameraButton` | `boolean` | `false` | Show snapshot button in control bar |
| `zoomEnabled` | `boolean` | `false` | Enable pinch-to-zoom (active in fullscreen) |
| `seekInterval` | `number` | `15` | Seconds per seek-forward / seek-back button press |
| `shouldRepeat` | `boolean` | `false` | Loop playback on end |
| `resizeMode` | `'contain' \| 'cover' \| 'fill'` | `'contain'` | Video scaling mode |
| `progressInterval` | `number` | `500` | `onProgress` firing interval in ms |
| `icons` | `ControlIcons` | — | Override individual control icons |
| `playerRef` | `RefObject<VideoPlayerView>` | — | Ref for imperative control via `useVideoPlayer()` |
| `style` | `ViewStyle` | — | Container style |
| `onCapture` | `(path: string) => void` | — | Called with local file path after screenshot |
| `onReady` | `(event: ReadyEvent) => void` | — | Native player ready, duration & size known |
| `onProgress` | `(event: ProgressEvent) => void` | — | Playback position update |
| `onBuffering` | `(isBuffering: boolean) => void` | — | Buffering state change |
| `onStateChange` | `(state: PlaybackState) => void` | — | Player lifecycle state change |
| `onError` | `(event: ErrorEvent) => void` | — | Playback error |
| `onEnd` | `() => void` | — | Stream finished |

---

## 📐 Playback States

```ts
type PlaybackState =
  | 'idle'          // No media loaded / stopped
  | 'loading'       // URL set, native player initializing
  | 'ready'         // First frame decoded, ready to play
  | 'playing'       // Active playback
  | 'paused'        // Manually paused
  | 'buffering'     // Waiting for data (network stall)
  | 'reconnecting'  // Stream dropped, auto-reconnect backoff active
  | 'error'         // Unrecoverable error
  | 'ended'         // Stream finished
```sition update |
| `onBuffering` | `(isBuffering: boolean) => void` | — | Buffering state change |
| `onStateChange` | `(state: PlaybackState) => void` | — | Player lifecycle state change |
| `onError` | `(event: ErrorEvent) => void` | — | Playback error |
| `onEnd` | `() => void` | — | Stream ended |

---

## 📐 Playback States

```ts
type PlaybackState =
  | 'idle'       // No media loaded
  | 'loading'    // URL set, native player initializing
  | 'ready'      // First frame decoded, can play
  | 'playing'    // Active playback
  | 'paused'     // Manually paused
  | 'buffering'  // Waiting for data (network stall)
  | 'error'      // Unrecoverable error
  | 'ended'      // Stream finished
```

---

## 📄 License

MIT © [ngocda](https://github.com/ngocmanhht)
