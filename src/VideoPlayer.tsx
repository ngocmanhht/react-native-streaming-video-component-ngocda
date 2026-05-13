import React, { useCallback, useEffect, useState, type FC, type RefObject } from 'react'
import { Modal, StatusBar, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { getHostComponent } from 'react-native-nitro-modules'
import Reanimated, { useSharedValue, withTiming, useAnimatedStyle } from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Orientation from 'react-native-orientation-locker'
import type { VideoPlayerProps, VideoPlayerView, StreamProtocol } from './VideoPlayer.nitro'
import VideoPlayerViewConfig from '../nitrogen/generated/shared/json/VideoPlayerViewConfig.json'
import { VideoControls, type ControlIcons } from './VideoControls'
import { useVideoPlayer } from './useVideoPlayer'

// ─── Native wrapper ───────────────────────────────────────────────────────────

const NativeVideoPlayer = getHostComponent<VideoPlayerProps, VideoPlayerView>(
  'VideoPlayerView',
  () => VideoPlayerViewConfig,
)

// ─── Public props ─────────────────────────────────────────────────────────────

export interface VideoPlayerPublicProps extends Omit<
  Partial<VideoPlayerProps>,
  'paused' | 'volume' | 'muted' | 'zoomEnabled'
> {
  /** Custom styles applied to the container */
  style?: StyleProp<ViewStyle>

  /**
   * Controls playback. When provided, the component is "controlled" –
   * you must update this prop to play/pause. When omitted, the component
   * manages playback internally (uncontrolled mode).
   */
  paused?: boolean

  /** Initial volume, 0.0 – 1.0. Default: 1.0 */
  volume?: number

  /** Show the built-in controls overlay. Default: false */
  showControls?: boolean

  /** Enable pinch-to-zoom. Default: false */
  zoomEnabled?: boolean

  /**
   * How many seconds seek-back / seek-forward buttons jump.
   * Ignored for RTSP and HLS (live streams). Default: 15
   */
  seekInterval?: number

  /**
   * Override individual control icons.
   * Each value should be a React component accepting { size, color, strokeWidth }.
   */
  icons?: ControlIcons

  /** Externally controlled ref – use with useVideoPlayer() */
  playerRef?: RefObject<VideoPlayerView>

  /** Show the camera capture button. Default: false */
  showCameraButton?: boolean

  /** Callback when screenshot is taken. Returns the file path. */
  onCapture?: (path: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export const VideoPlayer: FC<VideoPlayerPublicProps> = ({
  style,
  paused: externalPaused,
  volume: initialVolume = 1,
  showControls = false,
  zoomEnabled = false,
  seekInterval = 15,
  icons,
  playerRef: externalRef,
  streamProtocol = 'hls',
  showCameraButton = false,
  onCapture,
  ...nativeProps
}) => {
  // Internal player state management
  const {
    ref: internalRef,
    state,
    play,
    pause,
    stop,
    seekBy,
    setVolume,
    toggleMute,
    onStateChange,
    onProgress,
    onBuffering,
    onError,
    onEnd,
    onReady,
    takeScreenshot,
  } = useVideoPlayer({ initialPaused: externalPaused ?? false })

  // Sync external paused prop
  useEffect(() => {
    if (externalPaused === undefined) return
    if (externalPaused) pause()
    else play()
  }, [externalPaused, pause, play])

  // Sync initial volume
  useEffect(() => {
    setVolume(initialVolume)
  }, [initialVolume, setVolume])

  // ── Ref Management ───────────────────────────────────────────────────────
  // We use a callback ref to ensure internalRef is always set (for useVideoPlayer logic)
  // while also forwarding the ref to externalRef if provided.
  const handleRef = useCallback(
    (node: VideoPlayerView | null) => {
      ;(internalRef as any).current = node
      if (externalRef) {
        if (typeof externalRef === 'function') {
          ;(externalRef as (node: VideoPlayerView | null) => void)(node)
        } else {
          ;(externalRef as any).current = node
        }
      }
    },
    [externalRef, internalRef],
  )

  const [isFullscreen, setIsFullscreen] = useState(false)

  // ── Orientation Management ────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (isFullscreen) {
        Orientation.lockToLandscape()
      } else {
        Orientation.lockToPortrait()
      }
    } catch (e) {
      console.warn('Orientation error:', e)
    }

    return () => {
      try {
        Orientation.lockToPortrait()
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, [isFullscreen])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(fs => !fs)
  }, [])

  // ── Zoom Logic ────────────────────────────────────────────────────────────
  const zoomScale = useSharedValue(1)
  const savedZoomScale = useSharedValue(1)

  const handleZoom = (delta: number) => {
    const next = Math.max(1, Math.min(5, zoomScale.value + delta))
    zoomScale.value = withTiming(next)
    savedZoomScale.value = next
  }

  // ── Shared native player element ──────────────────────────────────────────
  const renderNativePlayer = () => (
    <ZoomableView
      zoomEnabled={zoomEnabled}
      style={StyleSheet.absoluteFill}
      scale={zoomScale}
      savedScale={savedZoomScale}>
      <NativeVideoPlayer
        ref={handleRef}
        streamProtocol={streamProtocol}
        paused={state.paused}
        volume={state.isMuted ? 0 : state.volume}
        muted={state.isMuted}
        zoomEnabled={zoomEnabled}
        onStateChange={onStateChange}
        onProgress={onProgress}
        onBuffering={onBuffering}
        onError={onError}
        onEnd={onEnd}
        onReady={onReady}
        {...(nativeProps as any)}
        style={StyleSheet.absoluteFill}
      />
    </ZoomableView>
  )

  const renderControls = (protocol: StreamProtocol) =>
    showControls ? (
      <VideoControls
        state={state}
        streamProtocol={protocol}
        isFullscreen={isFullscreen}
        seekInterval={seekInterval}
        icons={icons}
        zoomEnabled={zoomEnabled}
        onZoomIn={() => handleZoom(0.5)}
        onZoomOut={() => handleZoom(-0.5)}
        onPlay={play}
        onPause={pause}
        onStop={stop}
        onSeekBy={seekBy}
        onVolumeChange={setVolume}
        onToggleMute={toggleMute}
        onToggleFullscreen={toggleFullscreen}
        showCameraButton={showCameraButton}
        onCapture={async () => {
          try {
            const path = await takeScreenshot()
            onCapture?.(path)
          } catch (e) {
            console.error('Capture failed:', e)
          }
        }}
      />
    ) : null

  if (!isFullscreen) {
    return (
      <View style={[styles.container, style]}>
        {renderNativePlayer()}
        {renderControls(streamProtocol)}
      </View>
    )
  }

  return (
    <>
      <View style={[styles.container, style]} pointerEvents="none" />
      <Modal
        visible={isFullscreen}
        transparent={false}
        animationType="fade"
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={toggleFullscreen}>
        <StatusBar hidden />
        <View style={styles.fullscreenContainer}>
          {renderNativePlayer()}
          {renderControls(streamProtocol)}
        </View>
      </Modal>
    </>
  )
}

const ZoomableView: FC<{
  zoomEnabled: boolean
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
  scale: any
  savedScale: any
}> = ({ zoomEnabled, style, children, scale, savedScale }) => {
  if (!zoomEnabled) {
    return <View style={style}>{children}</View>
  }

  return (
    <ZoomableInner style={style} scale={scale} savedScale={savedScale}>
      {children}
    </ZoomableInner>
  )
}
ZoomableView.displayName = 'ZoomableView'

interface SharedValue {
  value: number
}

const ZoomableInner: FC<{
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
  scale: SharedValue
  savedScale: SharedValue
}> = ({ style, children, scale, savedScale }) => {
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e: any) => {
      scale.value = savedScale.value * e.scale
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1)
      }
      savedScale.value = scale.value
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={pinchGesture}>
      <Reanimated.View style={[style, animatedStyle]}>{children}</Reanimated.View>
    </GestureDetector>
  )
}
ZoomableInner.displayName = 'ZoomableInner'

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#000',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullscreenContainer: {
    alignItems: 'center',
    backgroundColor: '#000',
    flex: 1,
    justifyContent: 'center',
  },
})
