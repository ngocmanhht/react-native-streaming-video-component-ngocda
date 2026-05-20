# Usage Guide

Complete API reference and examples for `react-native-streaming-video-component-ngocda`.

---

## Table of Contents

1. [Basic HLS Playback](#1-basic-hls-playback)
2. [RTSP IP Camera](#2-rtsp-ip-camera)
3. [MP4 / VOD Playback](#3-mp4--vod-playback)
4. [Controlled Mode (external paused prop)](#4-controlled-mode)
5. [Programmatic Control via useVideoPlayer](#5-programmatic-control-via-usevideoplayer)
6. [Frame Capture (Screenshot)](#6-frame-capture-screenshot)
7. [Fullscreen & Zoom](#7-fullscreen--zoom)
8. [Custom Icons](#8-custom-icons)
9. [Listening to Playback Events](#9-listening-to-playback-events)
10. [VideoPlayer Props Reference](#10-videoplayer-props-reference)
11. [useVideoPlayer Hook Reference](#11-usevideoplayer-hook-reference)
12. [Type Reference](#12-type-reference)
13. [Performance Recommendations](#13-performance-recommendations)

---

## 1. Basic HLS Playback

```tsx
import React from 'react';
import { VideoPlayer } from 'react-native-streaming-video-component-ngocda';

export default function App() {
  return (
    <VideoPlayer
      source="https://example.com/live/stream.m3u8"
      streamProtocol="hls"
      showControls
      style={{ width: '100%', height: 220 }}
    />
  );
}
```

---

## 2. RTSP IP Camera

RTSP streams bypass ExoPlayer's broken digest-auth implementation and go directly to LibVLC, achieving startup latency of **< 500ms**.

```tsx
<VideoPlayer
  source="rtsp://admin:password@192.168.1.100:554/stream1"
  streamProtocol="rtsp"
  showControls
  muted={false}
  style={{ width: '100%', height: 220 }}
/>
```

> [!NOTE]
> RTSP streams are **live** — seeking and duration are not available. The seek buttons in the control bar are automatically hidden for `streamProtocol="rtsp"`.

---

## 3. MP4 / VOD Playback

```tsx
<VideoPlayer
  source="https://example.com/videos/sample.mp4"
  streamProtocol="mp4"
  showControls
  shouldRepeat={false}
  seekInterval={10}
  style={{ width: '100%', height: 220 }}
/>
```

---

## 4. Controlled Mode

When you pass the `paused` prop, the component enters **controlled mode** — your state fully drives playback.

```tsx
import React, { useState } from 'react';
import { Button } from 'react-native';
import { VideoPlayer } from 'react-native-streaming-video-component-ngocda';

export default function ControlledPlayer() {
  const [paused, setPaused] = useState(false);

  return (
    <>
      <VideoPlayer
        source="https://example.com/live.m3u8"
        streamProtocol="hls"
        paused={paused}
        showControls={false}
        style={{ width: '100%', height: 220 }}
      />
      <Button title={paused ? 'Resume' : 'Pause'} onPress={() => setPaused(p => !p)} />
    </>
  );
}
```

---

## 5. Programmatic Control via `useVideoPlayer`

Use the `useVideoPlayer` hook to get a `playerRef` and imperative methods. Pass the ref to `<VideoPlayer>` via the `playerRef` prop.

```tsx
import React from 'react';
import { Button, View } from 'react-native';
import {
  VideoPlayer,
  useVideoPlayer,
} from 'react-native-streaming-video-component-ngocda';

export default function ProgrammaticControl() {
  const { ref, state, play, pause, stop, seekTo, seekBy, setVolume, toggleMute } =
    useVideoPlayer({ initialMuted: false, initialVolume: 0.8 });

  return (
    <View>
      <VideoPlayer
        source="https://example.com/live.m3u8"
        streamProtocol="hls"
        playerRef={ref}
        style={{ width: '100%', height: 220 }}
      />

      {/* Display current state */}
      <Text>State: {state.playbackState}</Text>
      <Text>Time: {state.currentTime.toFixed(1)}s / {state.duration.toFixed(1)}s</Text>
      <Text>Volume: {(state.volume * 100).toFixed(0)}%</Text>

      {/* Controls */}
      <Button title="Play"         onPress={play} />
      <Button title="Pause"        onPress={pause} />
      <Button title="Stop"         onPress={stop} />
      <Button title="Seek to 60s"  onPress={() => seekTo(60)} />
      <Button title="+ 30s"        onPress={() => seekBy(state.currentTime + 30)} />
      <Button title="Toggle Mute"  onPress={toggleMute} />
      <Button title="Volume 50%"   onPress={() => setVolume(0.5)} />
    </View>
  );
}
```

---

## 6. Frame Capture (Screenshot)

Capture the current video frame as a JPEG file. Works on both iOS and Android.

### Using the built-in camera button

```tsx
<VideoPlayer
  source="rtsp://192.168.1.100:554/stream"
  streamProtocol="rtsp"
  showControls
  showCameraButton           // ← shows the camera icon in the control bar
  onCapture={(path) => {
    console.log('Snapshot saved to:', path);
    // path is a local file URI, e.g. /data/user/0/.../cache/snapshot_1234.jpg
    // You can now display it in an <Image>, upload it, or save to gallery
  }}
  style={{ width: '100%', height: 220 }}
/>
```

### Programmatic capture

```tsx
import { useVideoPlayer } from 'react-native-streaming-video-component-ngocda';

const { ref, takeScreenshot } = useVideoPlayer();

const handleCapture = async () => {
  try {
    const path = await takeScreenshot();
    console.log('Captured frame at:', path);
  } catch (err) {
    console.error('Capture failed:', err);
  }
};

return (
  <>
    <VideoPlayer playerRef={ref} source="rtsp://..." streamProtocol="rtsp" />
    <Button title="Take Snapshot" onPress={handleCapture} />
  </>
);
```

> [!NOTE]
> The returned `path` is a local cache file path (`file:///...`). To display it:
> ```tsx
> <Image source={{ uri: `file://${path}` }} />
> ```
> To save it to the camera roll, use `react-native-camera-roll` or `expo-media-library`.

---

## 7. Fullscreen & Zoom

Fullscreen is toggled by the expand icon in the control bar. When entering fullscreen:

- The player opens in a **Modal** covering the entire screen
- Device orientation is automatically **locked to landscape**
- On exit, orientation returns to **portrait**

Zoom is only active in fullscreen mode when `zoomEnabled={true}`:

```tsx
<VideoPlayer
  source="rtsp://192.168.1.100:554/stream"
  streamProtocol="rtsp"
  showControls
  zoomEnabled       // ← enables pinch-to-zoom in fullscreen (up to 5×)
  style={{ width: '100%', height: 220 }}
/>
```

**Zoom gestures:**
- **Pinch** — zoom in/out (range: 1× – 5×)
- **Pan** — move the zoomed frame when zoom > 1×
- **Pinch back to 1×** — snap-resets to normal scale

---

## 8. Custom Icons

Override any or all control icons. Each icon component receives `{ size, color, strokeWidth }`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import type { ControlIcons } from 'react-native-streaming-video-component-ngocda';

const myIcons: ControlIcons = {
  play:         ({ size, color }) => <Ionicons name="play"           size={size} color={color} />,
  pause:        ({ size, color }) => <Ionicons name="pause"          size={size} color={color} />,
  stop:         ({ size, color }) => <Ionicons name="stop"           size={size} color={color} />,
  camera:       ({ size, color }) => <Ionicons name="camera"         size={size} color={color} />,
  fullscreen:   ({ size, color }) => <Ionicons name="expand"         size={size} color={color} />,
  exitFullscreen:({ size, color })=> <Ionicons name="contract"       size={size} color={color} />,
  volumeOn:     ({ size, color }) => <Ionicons name="volume-high"    size={size} color={color} />,
  volumeOff:    ({ size, color }) => <Ionicons name="volume-mute"    size={size} color={color} />,
  seekForward:  ({ size, color }) => <Ionicons name="play-forward"   size={size} color={color} />,
  seekBackward: ({ size, color }) => <Ionicons name="play-back"      size={size} color={color} />,
};

<VideoPlayer
  source="..."
  showControls
  icons={myIcons}
  style={{ width: '100%', height: 220 }}
/>
```

---

## 9. Listening to Playback Events

```tsx
<VideoPlayer
  source="https://example.com/stream.m3u8"
  streamProtocol="hls"
  onReady={({ duration, naturalSize }) => {
    console.log('Ready! Duration:', duration, 'Size:', naturalSize);
  }}
  onProgress={({ currentTime, duration, playableDuration }) => {
    console.log(`${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
  }}
  onBuffering={(isBuffering) => {
    console.log('Buffering:', isBuffering);
  }}
  onStateChange={(state) => {
    // 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'error' | 'ended'
    console.log('Player state:', state);
  }}
  onError={({ code, message }) => {
    console.error(`Error ${code}:`, message);
  }}
  onEnd={() => {
    console.log('Stream ended');
  }}
  style={{ width: '100%', height: 220 }}
/>
```

---

## 10. VideoPlayer Props Reference

### Playback Props

| Prop | Type | Default | Description |
|:-----|:-----|:--------|:------------|
| `source` | `string` | **required** | Stream URL (`rtsp://`, `https://…m3u8`, `https://…mp4`) |
| `streamProtocol` | `'hls' \| 'rtsp' \| 'mp4'` | `'hls'` | Routing hint. Auto-detected from URL if unambiguous |
| `paused` | `boolean` | `false` | Controlled playback state. Omit for uncontrolled mode |
| `volume` | `number` | `1.0` | Initial volume `0.0 – 1.0` |
| `muted` | `boolean` | `true` | Initial muted state |
| `shouldRepeat` | `boolean` | `false` | Loop on stream end (HLS/MP4 only) |
| `resizeMode` | `'contain' \| 'cover' \| 'fill'` | `'contain'` | Video frame scaling |
| `progressInterval` | `number` | `500` | `onProgress` interval in milliseconds |

### UI Props

| Prop | Type | Default | Description |
|:-----|:-----|:--------|:------------|
| `showControls` | `boolean` | `false` | Show built-in controls overlay |
| `showCameraButton` | `boolean` | `false` | Show snapshot button in controls |
| `zoomEnabled` | `boolean` | `false` | Enable pinch-to-zoom in fullscreen |
| `seekInterval` | `number` | `15` | Seconds per seek button press |
| `icons` | `ControlIcons` | — | Override default Lucide icons |
| `style` | `ViewStyle` | — | Outer container style |

### Ref Props

| Prop | Type | Description |
|:-----|:-----|:------------|
| `playerRef` | `RefObject<VideoPlayerView>` | Pass a ref from `useVideoPlayer()` for imperative control |

### Callbacks

| Prop | Signature | Description |
|:-----|:----------|:------------|
| `onCapture` | `(path: string) => void` | Local file path of captured JPEG frame |
| `onReady` | `(event: ReadyEvent) => void` | Player ready, duration known |
| `onProgress` | `(event: ProgressEvent) => void` | Periodic position update |
| `onBuffering` | `(isBuffering: boolean) => void` | Buffer state change |
| `onStateChange` | `(state: PlaybackState) => void` | Lifecycle state transition |
| `onError` | `(event: ErrorEvent) => void` | Playback error |
| `onEnd` | `() => void` | Playback completed |

---

## 11. `useVideoPlayer` Hook Reference

```ts
const {
  ref,            // RefObject<VideoPlayerView> — pass to playerRef prop
  state,          // VideoPlayerState — current UI state snapshot
  play,           // () => void
  pause,          // () => void
  stop,           // () => void
  seekTo,         // (seconds: number) => void
  seekBy,         // (absoluteSeconds: number) => void
  setVolume,      // (volume: number) => void — 0.0 to 1.0
  toggleMute,     // () => void
  takeScreenshot, // () => Promise<string> — returns local file path
} = useVideoPlayer({
  initialPaused?: boolean,   // default: false
  initialVolume?: number,    // default: 1.0
  initialMuted?:  boolean,   // default: true
});
```

### `VideoPlayerState` shape

```ts
interface VideoPlayerState {
  paused:        boolean         // Current paused state
  playbackState: PlaybackState   // Current lifecycle state
  currentTime:   number          // Current position in seconds
  duration:      number          // Total duration in seconds (-1 for live)
  isBuffering:   boolean         // True while buffering
  volume:        number          // Current volume 0.0 – 1.0
  isMuted:       boolean         // True if muted
  error:         string | null   // Last error message, if any
}
```

---

## 12. Type Reference

```ts
// Stream protocol routing hint
type StreamProtocol = 'hls' | 'rtsp' | 'mp4'

// Video scaling mode
type ResizeMode = 'contain' | 'cover' | 'fill'

// Player lifecycle
type PlaybackState =
  | 'idle'        // No media loaded
  | 'loading'     // Initializing native player
  | 'ready'       // First frame decoded
  | 'playing'     // Active playback
  | 'paused'      // Manually paused
  | 'buffering'   // Waiting for data
  | 'error'       // Unrecoverable error
  | 'ended'       // Stream finished

// onReady payload
interface ReadyEvent {
  duration:    number       // seconds
  naturalSize: { width: number; height: number }
}

// onProgress payload
interface ProgressEvent {
  currentTime:      number  // seconds
  duration:         number  // seconds, -1 if live stream
  playableDuration: number  // buffered ahead in seconds
}

// onError payload
interface ErrorEvent {
  code:        number
  message:     string
  nativeError?: string
}
```

---

## 13. Performance Recommendations

### Concurrent stream limits

| Platform | Protocol | Recommended Max | Notes |
|:---------|:---------|:----------------|:------|
| iOS | RTSP (LibVLC) | **4–6 streams** | ~50–100 MB RAM + 1 decode thread each |
| Android | RTSP (LibVLC) | **3–4 streams** | ~80 MB RAM each; LibVLC thread pool saturates at ~4 |
| iOS | HLS / MP4 | **8–12 streams** | AVPlayer is highly optimized (~20 MB each) |
| Android | HLS / MP4 | **8–12 streams** | ExoPlayer is highly optimized (~20 MB each) |

> [!IMPORTANT]
> For RTSP camera grids with **more than 4 cameras**, use sub-streams (lower resolution) to stay within memory and thread budgets.

### Tips

- **Unmount off-screen players** — call `stop()` or unmount the component when not visible
- **Avoid frequent `source` changes** — each URL change triggers a full native reload
- **Use `shouldRepeat` for loops** — it's more efficient than toggling `paused` in `onEnd`
- **`progressInterval`** — increase to `1000ms` or more if you only need rough position updates
