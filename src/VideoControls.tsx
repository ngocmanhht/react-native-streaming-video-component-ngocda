import React, { useCallback, useEffect, useRef, useState, type ComponentType, type FC } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import * as Lucide from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import Slider from '@react-native-community/slider'
import type { PlaybackState, StreamProtocol } from './VideoPlayer.nitro'
import type { VideoPlayerState } from './useVideoPlayer'

// ─── Icon types ───────────────────────────────────────────────────────────────

export interface IconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

export interface ControlIcons {
  play?: ComponentType<IconProps>
  pause?: ComponentType<IconProps>
  stop?: ComponentType<IconProps>
  seekBack?: ComponentType<IconProps>
  seekForward?: ComponentType<IconProps>
  volumeHigh?: ComponentType<IconProps>
  volumeLow?: ComponentType<IconProps>
  volumeMute?: ComponentType<IconProps>
  fullscreen?: ComponentType<IconProps>
  exitFullscreen?: ComponentType<IconProps>
  zoomIn?: ComponentType<IconProps>
  zoomOut?: ComponentType<IconProps>
  camera?: ComponentType<IconProps>
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VideoControlsProps {
  state: VideoPlayerState
  streamProtocol: StreamProtocol
  isFullscreen: boolean
  seekInterval?: number
  icons?: ControlIcons
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeekBy: (absoluteSeconds: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
  // Zoom
  zoomEnabled?: boolean
  onZoomIn?: () => void
  onZoomOut?: () => void
  // Capture
  showCameraButton?: boolean
  onCapture?: () => void
}

// ─── Default icons (Lucide) ──────────────────────────────────────────────────

const FallbackIcon: FC<{ label: string } & IconProps> = ({ label, size = 20, color = '#fff' }) => (
  <Text style={{ fontSize: size * 0.75, color, lineHeight: size }}>{label}</Text>
)
FallbackIcon.displayName = 'FallbackIcon'

const mkIcon = (lucideName: keyof typeof Lucide, emoji: string): ComponentType<IconProps> => {
  const IconComponent: FC<IconProps> = p => {
    const LIcon = Lucide[lucideName] as ComponentType<IconProps>
    if (LIcon) return <LIcon {...p} />
    return <FallbackIcon label={emoji} {...p} />
  }
  IconComponent.displayName = `Icon(${String(lucideName)})`
  return IconComponent
}

const DefaultPlay: ComponentType<IconProps> = mkIcon('Play', '▶')
const DefaultPause: ComponentType<IconProps> = mkIcon('Pause', '⏸')
const DefaultStop: ComponentType<IconProps> = mkIcon('Square', '⏹')
const DefaultSeekBack: ComponentType<IconProps> = mkIcon('RotateCcw', '↩')
const DefaultSeekForward: ComponentType<IconProps> = mkIcon('RotateCw', '↪')
const DefaultVolumeHigh: ComponentType<IconProps> = mkIcon('Volume2', '🔊')
const DefaultVolumeLow: ComponentType<IconProps> = mkIcon('Volume1', '🔉')
const DefaultVolumeMute: ComponentType<IconProps> = mkIcon('VolumeX', '🔇')
const DefaultFullscreen: ComponentType<IconProps> = mkIcon('Maximize', '⛶')
const DefaultExitFullscreen: ComponentType<IconProps> = mkIcon('Minimize', '⊠')
const DefaultZoomIn: ComponentType<IconProps> = mkIcon('ZoomIn', '➕')
const DefaultZoomOut: ComponentType<IconProps> = mkIcon('ZoomOut', '➖')
const DefaultCamera: ComponentType<IconProps> = mkIcon('Camera', '📸')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) return 'LIVE'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}
const pad = (n: number) => String(n).padStart(2, '0')

/** RTSP and HLS are near-realtime; seeking is not meaningful */
const isLiveProtocol = (p: StreamProtocol) => p === 'rtsp' || p === 'hls'

const isActiveState = (s: PlaybackState) =>
  s === 'playing' || s === 'paused' || s === 'buffering' || s === 'ready'

// ─── Responsive icon sizing ───────────────────────────────────────────────────

const REF_SIZE = 320 // px

interface IconSizes {
  play: number
  seek: number
  bottom: number
  playBtn: number
  seekLabel: number
  timeText: number
  padding: number
}

function calcIconSizes(width: number, height: number): IconSizes {
  const shortEdge = Math.min(width, height) || REF_SIZE
  const scale = shortEdge / REF_SIZE
  const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)))

  // More aggressive scaling for small containers
  const minScale = shortEdge < 180 ? 0.45 : 1

  return {
    play: clamp(34 * scale, 14 * minScale, 52),
    seek: clamp(28 * scale, 12 * minScale, 42),
    bottom: clamp(22 * scale, 12 * minScale, 32),
    playBtn: clamp(64 * scale, 32 * minScale, 96),
    seekLabel: clamp(10 * scale, 7, 14),
    timeText: clamp(12 * scale, 8 * minScale, 16),
    padding: clamp(8 * scale, 2, 12),
  }
}

// ─── Animated wrapper (UI-thread with Reanimated) ───────────────────────────

const AUTO_HIDE_MS = 3500
const FADE_IN_MS = 200
const FADE_OUT_MS = 300

interface FadeViewProps {
  visible: boolean
  children: React.ReactNode
}

const FadeView: FC<FadeViewProps> = ({ visible, children }) => {
  const opacity = useSharedValue(visible ? 1 : 0)
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? FADE_IN_MS : FADE_OUT_MS,
    })
  }, [visible, opacity])

  if (!visible && opacity.value === 0) return null

  return <Reanimated.View style={[StyleSheet.absoluteFill, animStyle]}>{children}</Reanimated.View>
}
FadeView.displayName = 'FadeView'

// ─── SeekBar ──────────────────────────────────────────────────────────────────

interface SeekBarProps {
  currentTime: number
  duration: number
  disabled: boolean
  onSeek: (t: number) => void
}

const SeekBar: FC<SeekBarProps> = ({ currentTime, duration, disabled, onSeek }) => {
  return (
    <View style={styles.seekContainer}>
      <Slider
        style={styles.seekSlider}
        value={currentTime}
        minimumValue={0}
        maximumValue={duration}
        onSlidingComplete={onSeek}
        disabled={disabled}
        minimumTrackTintColor="#fff"
        maximumTrackTintColor="rgba(255,255,255,0.25)"
        thumbTintColor="#fff"
      />
    </View>
  )
}
SeekBar.displayName = 'SeekBar'

// ─── VolumeControl ────────────────────────────────────────────────────────────

interface VolumeControlProps {
  volume: number
  isMuted: boolean
  icons: Required<ControlIcons>
  iconSize: number
  onToggleMute: () => void
  onChange: (v: number) => void
}

const VolumeControl: FC<VolumeControlProps> = ({
  volume,
  isMuted,
  icons,
  iconSize,
  onToggleMute,
  onChange,
}) => {
  const [showSlider, setShowSlider] = useState(false)
  const effectiveVolume = isMuted ? 0 : volume

  const VolumeIcon =
    isMuted || effectiveVolume === 0
      ? icons.volumeMute
      : effectiveVolume < 0.5
        ? icons.volumeLow
        : icons.volumeHigh

  return (
    <View style={styles.volumeWrapper}>
      {showSlider && (
        <View
          style={[
            styles.volumePopup,
            { bottom: iconSize * 1.5 + 10, left: -45 + (iconSize - 22) * 1.5 },
          ]}>
          <Slider
            style={styles.verticalSlider}
            value={effectiveVolume}
            minimumValue={0}
            maximumValue={1}
            onValueChange={onChange}
            minimumTrackTintColor="#fff"
            maximumTrackTintColor="rgba(255,255,255,0.3)"
            thumbTintColor="#fff"
          />
        </View>
      )}
      <Pressable
        onPress={() => setShowSlider(v => !v)}
        onLongPress={onToggleMute}
        style={styles.iconBtn}
        accessibilityLabel={isMuted ? 'Unmute' : 'Volume control'}>
        <VolumeIcon size={iconSize} color="#fff" />
      </Pressable>
    </View>
  )
}
VolumeControl.displayName = 'VolumeControl'

// ─── Main VideoControls ───────────────────────────────────────────────────────

export const VideoControls: FC<VideoControlsProps> = ({
  state,
  streamProtocol,
  isFullscreen,
  seekInterval = 15,
  icons: customIcons,
  onPlay,
  onPause,
  onSeekBy,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  zoomEnabled,
  onZoomIn,
  onZoomOut,
  showCameraButton = false,
  onCapture,
}) => {
  const icons: Required<ControlIcons> = {
    play: customIcons?.play ?? DefaultPlay,
    pause: customIcons?.pause ?? DefaultPause,
    stop: customIcons?.stop ?? DefaultStop,
    seekBack: customIcons?.seekBack ?? DefaultSeekBack,
    seekForward: customIcons?.seekForward ?? DefaultSeekForward,
    volumeHigh: customIcons?.volumeHigh ?? DefaultVolumeHigh,
    volumeLow: customIcons?.volumeLow ?? DefaultVolumeLow,
    volumeMute: customIcons?.volumeMute ?? DefaultVolumeMute,
    fullscreen: customIcons?.fullscreen ?? DefaultFullscreen,
    exitFullscreen: customIcons?.exitFullscreen ?? DefaultExitFullscreen,
    zoomIn: customIcons?.zoomIn ?? DefaultZoomIn,
    zoomOut: customIcons?.zoomOut ?? DefaultZoomOut,
    camera: customIcons?.camera ?? DefaultCamera,
  }

  const [visible, setVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [containerSize, setContainerSize] = useState({ width: REF_SIZE, height: REF_SIZE })
  const iconSizes = calcIconSizes(containerSize.width, containerSize.height)

  const onOverlayLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    if (width > 0 && height > 0) setContainerSize({ width, height })
  }, [])

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS)
  }, [])

  const showAndScheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    if (state.playbackState === 'playing') {
      scheduleHide()
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setVisible(true)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [state.playbackState, scheduleHide])

  const isLive = isLiveProtocol(streamProtocol)
  const seekDisabled = isLive || state.duration <= 0
  const isActive = isActiveState(state.playbackState)
  const isPaused = state.paused

  const handleSeekBy = useCallback(
    (delta: number) => {
      if (seekDisabled) return
      const next = Math.max(0, Math.min(state.duration, state.currentTime + delta))
      onSeekBy(next)
      showAndScheduleHide()
    },
    [seekDisabled, state.duration, state.currentTime, onSeekBy, showAndScheduleHide],
  )

  const handlePlayPause = useCallback(() => {
    if (isPaused) onPlay()
    else onPause()
    showAndScheduleHide()
  }, [isPaused, onPlay, onPause, showAndScheduleHide])

  const PlayPauseIcon = isPaused ? icons.play : icons.pause
  const FullscreenIcon = isFullscreen ? icons.exitFullscreen : icons.fullscreen

  // Dynamic hiding logic
  const showSeek = containerSize.height > 180 && !isLive && isActive
  const showTime = containerSize.width > 260
  const showBottomControls = containerSize.height > 130
  // Zoom only if enough space
  const showZoom = zoomEnabled && containerSize.height > 220 && containerSize.width > 220
  // Show volume and fullscreen only if enough width
  const showVolume = containerSize.width > 200 && showBottomControls
  const showFullscreen = containerSize.width > 160 && showBottomControls
  const showCenterSeeks = containerSize.width > 180
  const showCamera = showCameraButton && containerSize.width > 120 && showBottomControls

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={showAndScheduleHide}
      accessibilityLabel="Toggle controls">
      <FadeView visible={visible}>
        <View style={styles.overlay} onLayout={onOverlayLayout}>
          <View style={[styles.topBar, { paddingHorizontal: iconSizes.padding * 1.5 }]}>
            {isLive && (
              <View style={styles.liveBadge}>
                <Text style={[styles.liveBadgeText, { fontSize: iconSizes.timeText - 1 }]}>
                  ● LIVE
                </Text>
              </View>
            )}
            <View style={styles.flexSpacer} />
            {showCamera && (
              <Pressable style={styles.iconBtn} onPress={onCapture} accessibilityLabel="Take screenshot">
                <icons.camera size={iconSizes.bottom + 2} color="#fff" />
              </Pressable>
            )}
          </View>

          <View style={styles.centerRow}>
            {showCenterSeeks && (
              <Pressable
                style={[styles.iconBtn, seekDisabled && styles.disabled]}
                onPress={() => handleSeekBy(-seekInterval)}
                disabled={seekDisabled}
                accessibilityLabel={`Seek back ${seekInterval} seconds`}>
                <icons.seekBack size={iconSizes.seek} color={seekDisabled ? '#555' : '#fff'} />
              </Pressable>
            )}

            <Pressable
              style={[
                styles.iconBtn,
                styles.playBtn,
                {
                  width: iconSizes.playBtn,
                  height: iconSizes.playBtn,
                  borderRadius: iconSizes.playBtn / 2,
                },
              ]}
              onPress={handlePlayPause}
              accessibilityLabel={isPaused ? 'Play' : 'Pause'}>
              <PlayPauseIcon size={iconSizes.play} color="#fff" />
            </Pressable>

            {showCenterSeeks && (
              <Pressable
                style={[styles.iconBtn, seekDisabled && styles.disabled]}
                onPress={() => handleSeekBy(seekInterval)}
                disabled={seekDisabled}
                accessibilityLabel={`Seek forward ${seekInterval} seconds`}>
                <icons.seekForward size={iconSizes.seek} color={seekDisabled ? '#555' : '#fff'} />
              </Pressable>
            )}
          </View>

          {showZoom && (
            <View style={[styles.zoomPill, { right: iconSizes.padding * 2, top: '35%' }]}>
              <Pressable style={styles.zoomBtn} onPress={onZoomIn} accessibilityLabel="Zoom in">
                <icons.zoomIn size={iconSizes.bottom} color="#fff" />
              </Pressable>
              <View style={styles.zoomDivider} />
              <Pressable style={styles.zoomBtn} onPress={onZoomOut} accessibilityLabel="Zoom out">
                <icons.zoomOut size={iconSizes.bottom} color="#fff" />
              </Pressable>
            </View>
          )}

          <View style={[styles.bottomBar, { paddingHorizontal: iconSizes.padding }]}>
            {showSeek && (
              <SeekBar
                currentTime={state.currentTime}
                duration={state.duration}
                disabled={seekDisabled}
                onSeek={onSeekBy}
              />
            )}

            {showBottomControls && (
              <View style={styles.bottomControlsRow}>
                <Pressable
                  style={styles.iconBtn}
                  onPress={handlePlayPause}
                  accessibilityLabel="Play/Pause">
                  <PlayPauseIcon size={iconSizes.bottom + 4} color="#fff" />
                </Pressable>

                {!isLive && showTime && (
                  <Text style={[styles.timeText, { fontSize: iconSizes.timeText }]}>
                    {formatTime(state.currentTime)}
                    {state.duration > 0 ? ` / ${formatTime(state.duration)}` : ''}
                  </Text>
                )}

                <View style={styles.flexSpacer} />

                {showFullscreen && (
                  <Pressable
                    style={styles.iconBtn}
                    onPress={onToggleFullscreen}
                    accessibilityLabel="Toggle Fullscreen">
                    <FullscreenIcon size={iconSizes.bottom} color="#fff" />
                  </Pressable>
                )}

                {showVolume && (
                  <VolumeControl
                    volume={state.volume}
                    isMuted={state.isMuted}
                    icons={icons}
                    iconSize={iconSizes.bottom}
                    onToggleMute={onToggleMute}
                    onChange={onVolumeChange}
                  />
                )}
              </View>
            )}
          </View>
        </View>
      </FadeView>
    </Pressable>
  )
}
VideoControls.displayName = 'VideoControls'

const styles = StyleSheet.create({
  bottomBar: {
    backgroundColor: 'transparent',
    paddingBottom: 10,
  },
  bottomControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: -4,
  },
  centerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
  },
  flexSpacer: {
    flex: 1,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  liveBadge: {
    backgroundColor: '#e53935',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveBadgeText: {
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'space-between',
  },
  playBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.55)',
    borderWidth: 2,
  },
  seekContainer: {
    height: 30,
    justifyContent: 'center',
    width: '100%',
  },
  seekSlider: {
    height: 40,
    width: '100%',
  },
  timeText: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
    marginLeft: 8,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 6,
    paddingTop: 10,
  },
  verticalSlider: {
    height: 30,
    width: 90,
  },
  volumePopup: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
    width: 100,
  },
  volumeWrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  zoomBtn: {
    padding: 10,
  },
  zoomDivider: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    height: 1,
    marginVertical: 2,
    width: 16,
  },
  zoomPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 4,
    position: 'absolute',
  },
})
