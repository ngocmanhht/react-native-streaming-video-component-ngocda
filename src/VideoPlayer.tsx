import React, { useCallback, useEffect, useState, useRef, type FC, type RefObject } from 'react'
import {
  AppState,
  StatusBar,
  StyleSheet,
  View,
  Text,
  Platform,
  Dimensions,
  Modal,
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

// ─── Default Headers ─────────────────────────────────────────────────────────

export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://cloudcam.vn/',
  'Origin': 'https://cloudcam.vn',
}

// ─── Native wrapper ───────────────────────────────────────────────────────────

const NativeVideoPlayer = getHostComponent<VideoPlayerProps, VideoPlayerView>(
  'VideoPlayerView',
  () => VideoPlayerViewConfig,
)

// ─── Public props ─────────────────────────────────────────────────────────────

export interface VideoPlayerPublicProps extends Omit<
  Partial<VideoPlayerProps>,
  'paused' | 'volume' | 'muted' | 'zoomEnabled' | 'url'
> {
  /** Stream URL */
  url?: string

  /** Stream source string or object { uri: string } */
  source?: string | { uri?: string }

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

  /** Custom HTTP headers for video streaming. Defaults to cloudcam.vn */
  headers?: Record<string, string>
}

// ─── Component ────────────────────────────────────────────────────────────────

export const VideoPlayer: FC<VideoPlayerPublicProps> = ({
  style,
  url: propUrl,
  source: propSource,
  paused: externalPaused = false,
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
  isLive = false,
  headers: propHeaders = DEFAULT_HEADERS,

  // Extract user callbacks explicitly to avoid them overriding or blocking internal state updates
  onReady: userOnReady,
  onProgress: userOnProgress,
  onBuffering: userOnBuffering,
  onStateChange: userOnStateChange,
  onError: userOnError,
  onEnd: userOnEnd,

  ...nativeProps
}) => {
  const resolvedHeaders = React.useMemo(() => {
    return { ...DEFAULT_HEADERS, ...(propHeaders || {}) }
  }, [propHeaders])

  // Resolve raw stream URL string from either `url` or `source` prop
  const rawUrl =
    propUrl ||
    (typeof propSource === 'string'
      ? propSource
      : typeof propSource === 'object' && propSource?.uri
      ? propSource.uri
      : '') ||
    ''
  // Internal player state management
  const {
    ref: internalRef,
    state,
    play,
    pause,
    stop,
    seekTo,
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

  // Sync external paused prop → chỉ chạy khi externalPaused thực sự thay đổi
  // Dùng ref để phân biệt lần mount đầu tiên vs thay đổi thực sự
  const prevExternalPaused = useRef(externalPaused)
  useEffect(() => {
    if (prevExternalPaused.current === externalPaused) return
    prevExternalPaused.current = externalPaused
    if (externalPaused) pause()
    else play()
  }, [externalPaused, pause, play])

  // App lifecycle management (pause in background, resume when active)
  const wasPlayingBeforeBackground = useRef(false)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (!state.paused) {
          wasPlayingBeforeBackground.current = true
          pause()
        }
      } else if (nextAppState === 'active') {
        if (wasPlayingBeforeBackground.current) {
          wasPlayingBeforeBackground.current = false
          play()
        }
      }
    })
    return () => {
      subscription.remove()
    }
  }, [state.paused, pause, play])

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
  const [, setReadyFullscreen] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(1)
  const [showZoomBadge, setShowZoomBadge] = useState(false)
  const [showShutterFlash, setShowShutterFlash] = useState(false)
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSeekAfterRemount = useRef<number | null>(null)

  // ── Orientation Management ────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'ios') {
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
    } else {
      // Android: Do not lock orientation physically to avoid rotating the entire MainActivity.
      if (isFullscreen) {
        setReadyFullscreen(true)
      } else {
        setReadyFullscreen(false)
      }
    }

    return () => {
      if (Platform.OS === 'ios') {
        try {
          Orientation.unlockAllOrientations()
          Orientation.lockToPortrait()
        } catch (e) {
          console.warn('Orientation error:', e)
        }
      }
    }
  }, [isFullscreen])

  const toggleFullscreen = useCallback(() => {
    if (!isLive && state.currentTime > 0) {
      pendingSeekAfterRemount.current = state.currentTime
    }
    setIsFullscreen(fs => !fs)
  }, [isLive, state.currentTime])

  // ── Unified Callback Handlers (Fires both internal state and user callbacks) ──
  const handleReady = useCallback(
    (event: ReadyEvent) => {
      onReady(event)
      userOnReady?.(event)
      if (!isLive && pendingSeekAfterRemount.current !== null && pendingSeekAfterRemount.current > 0) {
        const target = pendingSeekAfterRemount.current
        pendingSeekAfterRemount.current = null
        setTimeout(() => {
          seekTo(target)
        }, 150)
      }
    },
    [onReady, userOnReady, isLive, seekTo],
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

  const renderControls = (protocol: StreamProtocol) =>
    showControls ? (
      <VideoControls
        state={state}
        streamProtocol={protocol}
        isFullscreen={isFullscreen}
        isLive={isLive}
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
            setShowShutterFlash(true)
            setTimeout(() => {
              setShowShutterFlash(false)
            }, 150)
            const path = await takeScreenshot()
            onCapture?.(path)
          } catch (e) {
            console.error('Capture failed:', e)
          }
        }}
      />
    ) : null

  const playerEl = (
    <NativeVideoPlayer
      key={`${streamProtocol}-${rawUrl}`}
      hybridRef={callback(handleHybridRef)}
      url={rawUrl}
      headers={resolvedHeaders}
      streamProtocol={streamProtocol}
      paused={state.paused}
      volume={state.isMuted ? 0 : state.volume}
      muted={state.isMuted}
      zoomEnabled={zoomEnabled && isFullscreen}
      isLive={isLive}
      onStateChange={callback(handleStateChange)}
      onProgress={callback(handleProgress)}
      onBuffering={callback(handleBuffering)}
      onError={callback(handleError)}
      onEnd={callback(handleEnd)}
      onReady={callback(handleReady)}
      {...(nativeProps as any)}
      style={styles.playerNativeStyle}
    />
  )

  const controlsEl = renderControls(streamProtocol)

  const { width: W, height: H } = Dimensions.get('window')
  const screenWidth = Math.min(W, H)
  const screenHeight = Math.max(W, H)

  const containerStyle = isFullscreen
    ? Platform.OS === 'android'
      ? [
          styles.fullscreenContainer,
          {
            width: screenHeight,
            height: screenWidth,
            position: 'absolute' as const,
            top: (screenHeight - screenWidth) / 2,
            left: (screenWidth - screenHeight) / 2,
            transform: [{ rotate: '90deg' }],
          },
        ]
      : styles.fullscreenContainer
    : [styles.container, style]

  const playerComponent = (
    <GestureHandlerRootView style={containerStyle}>
      <StatusBar hidden={isFullscreen} animated />
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
      {showShutterFlash && (
        <View
          style={[StyleSheet.absoluteFill, styles.shutterFlash]}
          pointerEvents="none"
        />
      )}
      {isFullscreen && showZoomBadge && currentZoom > 1.05 && (
        <View style={styles.zoomBadge}>
          <Text style={styles.zoomBadgeText}>{currentZoom.toFixed(1)}x</Text>
        </View>
      )}
    </GestureHandlerRootView>
  )

  if (isFullscreen) {
    return (
      <Modal
        visible={true}
        transparent={false}
        statusBarTranslucent
        animationType="none"
        supportedOrientations={[
          'portrait',
          'portrait-upside-down',
          'landscape',
          'landscape-left',
          'landscape-right',
        ]}
        onRequestClose={toggleFullscreen}
      >
        {playerComponent}
      </Modal>
    )
  }

  return playerComponent
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
    width: '100%',
  },
  fullscreenContainer: {
    alignItems: 'center',
    backgroundColor: '#000',
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  playerNativeStyle: {
    height: '100%',
    width: '100%',
  },
  shutterFlash: {
    backgroundColor: '#fff',
    opacity: 0.8,
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
