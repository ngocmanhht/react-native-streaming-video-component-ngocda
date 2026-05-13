# Usage

The `VideoPlayer` component is designed for high-performance streaming (HLS, RTSP) with a professional UI.

## Basic Usage (HLS)

```tsx
import React from 'react';
import { VideoPlayer } from 'react-native-streaming-video-component-ngocda';

const App = () => {
  return (
    <VideoPlayer
      source="https://example.com/stream.m3u8"
      streamProtocol="hls"
      showControls={true}
      style={{ width: '100%', height: 300 }}
    />
  );
};
```

## RTSP Streaming

```tsx
<VideoPlayer
  source="rtsp://your-camera-url"
  streamProtocol="rtsp"
  showControls={true}
  zoomEnabled={true}
  style={{ width: '100%', height: 300 }}
/>
```

## Advanced Controls

### Controlled Mode
You can control playback via the `paused` prop:

```tsx
const [paused, setPaused] = useState(false);

<VideoPlayer
  source="..."
  paused={paused}
  onPlay={() => setPaused(false)}
  onPause={() => setPaused(true)}
/>
```

### Programmatic Control (Ref)
Use the `useVideoPlayer` hook or a ref to control the player programmatically:

```tsx
import { useVideoPlayer } from 'react-native-streaming-video-component-ngocda';

const { ref, play, pause, seekBy } = useVideoPlayer();

return (
  <>
    <VideoPlayer playerRef={ref} source="..." />
    <Button title="Forward 30s" onPress={() => seekBy(30)} />
  </>
);
```

### Custom Icons
Override the default Lucide icons by passing a component that accepts `{ size, color, strokeWidth }`:

```tsx
const myIcons = {
  play: (props) => <MyCustomPlayIcon {...props} />,
  pause: (props) => <MyCustomPauseIcon {...props} />,
};

<VideoPlayer source="..." icons={myIcons} />
```

## Props Reference

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `source` | `string` | - | The streaming URL (HLS `.m3u8` or RTSP `rtsp://`). |
| `streamProtocol` | `'hls' \| 'rtsp'` | `'hls'` | Defines the underlying engine. RTSP uses a specialized low-latency bridge. |
| `showControls` | `boolean` | `false` | When true, renders a professional UI with Seek, Play, Volume, and Zoom controls. |
| `zoomEnabled` | `boolean` | `false` | Enables pinch-to-zoom and the floating zoom control panel. |
| `paused` | `boolean` | `false` | Controls the playback state. If provided, the component operates in "Controlled Mode". |
| `volume` | `number` | `1.0` | Initial volume level (0.0 to 1.0). |
| `seekInterval` | `number` | `15` | The number of seconds the forward/backward skip buttons jump. |
| `icons` | `ControlIcons` | - | An object to override specific icons (play, pause, camera, etc.). |
| `showCameraButton` | `boolean` | `false` | Shows a capture button in the top bar to take a frame snapshot. |
| `onCapture` | `(path: string) => void` | - | Callback triggered when a screenshot is successfully saved. |
| `style` | `ViewStyle` | - | Custom styles applied to the video container. |
| `playerRef` | `RefObject` | - | Access to the native player methods via `useVideoPlayer`. |

## Performance Recommendations

Streaming multiple video feeds simultaneously is resource-intensive. Below are the recommended limits for concurrent components on a single screen:

| Platform | Recommended Max | Reason |
| :--- | :--- | :--- |
| **iOS (RTSP)** | **4-6 streams** | Each stream consumes ~50-100MB RAM and one dedicated decoding thread. |
| **Android (RTSP)** | **3-4 streams** | Native thread pool for RTSP is typically limited to ~4 concurrent sessions; ~80MB per stream. |
| **iOS/Android (HLS/MP4)** | **8-12 streams** | Native system players (AVPlayer/ExoPlayer) are highly optimized, consuming ~20MB per stream. |

> [!IMPORTANT]
> For RTSP grids with more than 4 cameras, consider using a lower resolution (sub-stream) to prevent memory issues or UI lag.
