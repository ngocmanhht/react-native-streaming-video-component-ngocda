import React, { useCallback, useEffect, useState, useRef, type FC, type RefObject } from 'react'
import {
  Modal,
  StatusBar,
  StyleSheet,
  View,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { getHostComponent, callback } from 'react-native-nitro-modules'
import Reanimated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Orientation from 'react-native-orientation-locker'
import type {
  VideoPlayerProps,
  VideoPlayerView,
  StreamProtocol,
  ReadyEvent,
  ProgressEvent,
  ErrorEvent,
  PlaybackState,
} from './VideoPlayer.nitro'
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

  /** Initial muted state. Default: true */
  muted?: boolean

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
  muted: initialMuted = true,
  showControls = false,
  zoomEnabled = false,
  seekInterval = 15,
  icons,
  playerRef: externalRef,
  streamProtocol = 'hls',
  showCameraButton = false,
  onCapture,

  // Extract user callbacks explicitly to avoid them overriding or blocking internal state updates
  onReady: userOnReady,
  onProgress: userOnProgress,
  onBuffering: userOnBuffering,
  onStateChange: userOnStateChange,
  onError: userOnError,
  onEnd: userOnEnd,

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
  } = useVideoPlayer({
    initialPaused: externalPaused ?? false,
    initialVolume,
    initialMuted,
  })

  // Sync external paused prop
  useEffect(() => {
    if (externalPaused === undefined) return
    if (externalPaused) pause()
    else play()
  }, [externalPaused, pause, play])

  // Sync volume if it changes externally
  const isMounted = React.useRef(false)
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      return
    }
    setVolume(initialVolume)
  }, [initialVolume, setVolume])

  // ── Ref Management ───────────────────────────────────────────────────────
  // We use a callback ref to ensure internalRef is always set (for useVideoPlayer logic)
  // while also forwarding the ref to externalRef if provided.
  // We use hybridRef to get the Nitro HybridObject which contains the actual methods
  const handleHybridRef = useCallback(
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
  const [readyFullscreen, setReadyFullscreen] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(1)
  const [showZoomBadge, setShowZoomBadge] = useState(false)
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Orientation Management ────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (isFullscreen) {
        Orientation.unlockAllOrientations()
        Orientation.lockToLandscape()

        setTimeout(() => {
          setReadyFullscreen(true)
        }, 500)
      } else {
        setReadyFullscreen(false)

        Orientation.unlockAllOrientations()
        Orientation.lockToPortrait()
      }
    } catch (e) {
      console.warn('Orientation error:', e)
    }

    return () => {
      try {
        Orientation.unlockAllOrientations()
        Orientation.lockToPortrait()
      } catch (e) {
        console.warn('Orientation error:', e)
      }
    }
  }, [isFullscreen])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(fs => !fs)
  }, [])

  // ── Unified Callback Handlers (Fires both internal state and user callbacks) ──
  const handleReady = useCallback(
    (event: ReadyEvent) => {
      onReady()
      userOnReady?.(event)
    },
    [onReady, userOnReady],
  )

  const handleProgress = useCallback(
    (event: ProgressEvent) => {
      onProgress(event)
      userOnProgress?.(event)
    },
    [onProgress, userOnProgress],
  )

  const handleBuffering = useCallback(
    (isBuffering: boolean) => {
      onBuffering(isBuffering)
      userOnBuffering?.(isBuffering)
    },
    [onBuffering, userOnBuffering],
  )

  const handleStateChange = useCallback(
    (s: PlaybackState) => {
      onStateChange(s)
      userOnStateChange?.(s)
    },
    [onStateChange, userOnStateChange],
  )

  const handleError = useCallback(
    (event: ErrorEvent) => {
      onError(event)
      userOnError?.(event)
    },
    [onError, userOnError],
  )

  const handleEnd = useCallback(() => {
    onEnd()
    userOnEnd?.()
  }, [onEnd, userOnEnd])

  // ── Shared native player element ──────────────────────────────────────────
  const zoomScale = useSharedValue(1)
  const savedZoomScale = useSharedValue(1)

  const renderContent = () => {
    const playerEl = (
      <NativeVideoPlayer
        key={`${isFullscreen}-${streamProtocol}`}
        hybridRef={callback(handleHybridRef)}
        streamProtocol={streamProtocol}
        paused={state.paused}
        volume={state.isMuted ? 0 : state.volume}
        muted={state.isMuted}
        zoomEnabled={zoomEnabled && isFullscreen}
        onStateChange={handleStateChange}
        onProgress={handleProgress}
        onBuffering={handleBuffering}
        onError={handleError}
        onEnd={handleEnd}
        onReady={handleReady}
        {...(nativeProps as any)}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    )

    const controlsEl = renderControls(streamProtocol)

    return (
      <View style={StyleSheet.absoluteFill}>
        <ZoomableView
          zoomEnabled={zoomEnabled && isFullscreen}
          style={StyleSheet.absoluteFill}
          scale={zoomScale}
          savedScale={savedZoomScale}
          player={playerEl}
          controls={controlsEl}
          onZoomChange={zoom => {
            setCurrentZoom(zoom)
            setShowZoomBadge(true)
            if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
            zoomTimeoutRef.current = setTimeout(() => {
              setShowZoomBadge(false)
            }, 2000)
          }}
        />
      </View>
    )
  }

  const renderControls = (protocol: StreamProtocol) =>
    showControls ? (
      <VideoControls
        state={state}
        streamProtocol={protocol}
        isFullscreen={isFullscreen}
        seekInterval={seekInterval}
        icons={icons}
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
    return <View style={[styles.container, style]}>{renderContent()}</View>
  }

  return (
    <>
      <View style={[styles.container, style]} pointerEvents="none" />
      <Modal
        visible={isFullscreen}
        transparent={false}
        animationType="fade"
        statusBarTranslucent={true}
        supportedOrientations={['landscape-left', 'landscape-right', 'portrait']}
        onRequestClose={toggleFullscreen}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar hidden />
          <View style={styles.fullscreenContainer}>
            {renderContent()}
            {showZoomBadge && currentZoom > 1.05 && (
              <View style={styles.zoomBadge}>
                <Text style={styles.zoomBadgeText}>{currentZoom.toFixed(1)}x</Text>
              </View>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  )
}

const ZoomableView: FC<{
  zoomEnabled: boolean
  style?: StyleProp<ViewStyle>
  player: React.ReactNode
  controls?: React.ReactNode
  scale: any
  savedScale: any
  onZoomChange?: (zoom: number) => void
}> = ({ zoomEnabled, style, player, controls, scale, savedScale, onZoomChange }) => {
  if (!zoomEnabled) {
    return (
      <View style={style}>
        {player}
        {controls}
      </View>
    )
  }

  return (
    <ZoomableInner
      style={style}
      player={player}
      controls={controls}
      scale={scale}
      savedScale={savedScale}
      onZoomChange={onZoomChange}
    />
  )
}
ZoomableView.displayName = 'ZoomableView'

interface SharedValue {
  value: number
}

const ZoomableInner: FC<{
  style?: StyleProp<ViewStyle>
  player: React.ReactNode
  controls?: React.ReactNode
  scale: SharedValue
  savedScale: SharedValue
  onZoomChange?: (zoom: number) => void
}> = ({ style, player, controls, scale, savedScale, onZoomChange }) => {
  const offsetX = useSharedValue(0)
  const offsetY = useSharedValue(0)
  const savedOffsetX = useSharedValue(0)
  const savedOffsetY = useSharedValue(0)

  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(1, Math.min(5, savedScale.value * e.scale))
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withTiming(1)
        savedScale.value = 1
        offsetX.value = withTiming(0)
        offsetY.value = withTiming(0)
        savedOffsetX.value = 0
        savedOffsetY.value = 0
      } else {
        savedScale.value = scale.value
      }
      if (onZoomChange) runOnJS(onZoomChange)(scale.value)
    })

  const panGesture = Gesture.Pan()
    .onUpdate(e => {
      if (scale.value > 1) {
        offsetX.value = savedOffsetX.value + e.translationX
        offsetY.value = savedOffsetY.value + e.translationY
      }
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        offsetX.value = withTiming(0)
        offsetY.value = withTiming(0)
        savedOffsetX.value = 0
        savedOffsetY.value = 0
      } else {
        savedOffsetX.value = offsetX.value
        savedOffsetY.value = offsetY.value
      }
    })

  const composed = Gesture.Simultaneous(pinchGesture, panGesture)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
    ],
  }))

  return (
    <GestureDetector gesture={composed}>
      <View style={style}>
        <Reanimated.View style={[StyleSheet.absoluteFill, animatedStyle]}>{player}</Reanimated.View>
        {controls}
      </View>
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
  zoomBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'absolute',
    top: 40,
  },
  zoomBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
