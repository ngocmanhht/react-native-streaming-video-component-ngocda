"use strict";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Play, Pause, Square, RotateCcw, RotateCw, Volume2, Volume1, VolumeX, Maximize, Minimize, ZoomIn, ZoomOut, Camera } from 'lucide-react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Icon types ───────────────────────────────────────────────────────────────

// ─── Props ────────────────────────────────────────────────────────────────────
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── Default icons (Lucide) ──────────────────────────────────────────────────

const FallbackIcon = ({
  label,
  size = 20,
  color = '#fff'
}) => /*#__PURE__*/_jsx(Text, {
  style: {
    fontSize: size * 0.75,
    color,
    lineHeight: size
  },
  children: label
});
FallbackIcon.displayName = 'FallbackIcon';
const mkIcon = (IconComponent, emoji) => {
  const WrappedIcon = p => {
    if (IconComponent) return /*#__PURE__*/_jsx(IconComponent, {
      ...p
    });
    return /*#__PURE__*/_jsx(FallbackIcon, {
      label: emoji,
      ...p
    });
  };
  WrappedIcon.displayName = `Icon(${IconComponent?.displayName || 'Unknown'})`;
  return WrappedIcon;
};
const DefaultPlay = mkIcon(Play, '▶');
const DefaultPause = mkIcon(Pause, '⏸');
const DefaultStop = mkIcon(Square, '⏹');
const DefaultSeekBack = mkIcon(RotateCcw, '↩');
const DefaultSeekForward = mkIcon(RotateCw, '↪');
const DefaultVolumeHigh = mkIcon(Volume2, '🔊');
const DefaultVolumeLow = mkIcon(Volume1, '🔉');
const DefaultVolumeMute = mkIcon(VolumeX, '🔇');
const DefaultFullscreen = mkIcon(Maximize, '⛶');
const DefaultExitFullscreen = mkIcon(Minimize, '⊠');
const DefaultZoomIn = mkIcon(ZoomIn, '➕');
const DefaultZoomOut = mkIcon(ZoomOut, '➖');
const DefaultCamera = mkIcon(Camera, '📸');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (seconds < 0 || !isFinite(seconds)) return 'LIVE';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
const pad = n => String(n).padStart(2, '0');

/** RTSP and HLS are near-realtime; seeking is not meaningful */
const isLiveProtocol = (p, duration) => p === 'rtsp' || p === 'hls' && duration <= 0;
const isActiveState = s => s === 'playing' || s === 'paused' || s === 'buffering' || s === 'ready';

// ─── Responsive icon sizing ───────────────────────────────────────────────────

const REF_SIZE = 320; // px

function calcIconSizes(width, height) {
  const shortEdge = Math.min(width, height) || REF_SIZE;
  const scale = shortEdge / REF_SIZE;
  const clamp = (v, min, max) => Math.round(Math.min(max, Math.max(min, v)));

  // More aggressive scaling for small containers
  const minScale = shortEdge < 180 ? 0.5 : 1;
  return {
    play: clamp(34 * scale, 14 * minScale, 52),
    seek: clamp(28 * scale, 12 * minScale, 42),
    bottom: clamp(22 * scale, 24 * minScale, 32),
    playBtn: clamp(64 * scale, 32 * minScale, 96),
    seekLabel: clamp(10 * scale, 7, 14),
    timeText: clamp(12 * scale, 8 * minScale, 16),
    padding: clamp(8 * scale, 2, 12)
  };
}

// ─── Animated wrapper (UI-thread with Reanimated) ───────────────────────────

const AUTO_HIDE_MS = 3500;
const FADE_IN_MS = 200;
const FADE_OUT_MS = 300;
const FadeView = ({
  visible,
  children
}) => {
  const opacity = useSharedValue(visible ? 1 : 0);
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value
  }));
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? FADE_IN_MS : FADE_OUT_MS
    });
  }, [visible, opacity]);
  if (!visible && opacity.value === 0) return null;
  return /*#__PURE__*/_jsx(Reanimated.View, {
    style: [StyleSheet.absoluteFill, animStyle],
    children: children
  });
};
FadeView.displayName = 'FadeView';

// ─── SeekBar ──────────────────────────────────────────────────────────────────

const SeekBar = ({
  currentTime,
  duration,
  disabled,
  onSeek
}) => {
  const [value, setValue] = useState(currentTime);
  const isSliding = useRef(false);
  const lastSeekTime = useRef(0);

  // Keep local slider value in sync with player time when not sliding
  useEffect(() => {
    if (!isSliding.current) {
      setValue(currentTime);
    }
  }, [currentTime]);
  const handleValueChange = useCallback(val => {
    setValue(val);
    // Throttled real-time scrubbing (seek at most once every 150ms) to keep playback rendering responsive
    const now = Date.now();
    if (now - lastSeekTime.current > 150) {
      lastSeekTime.current = now;
      onSeek(val);
    }
  }, [onSeek]);
  const handleSlidingStart = useCallback(() => {
    isSliding.current = true;
  }, []);
  const handleSlidingComplete = useCallback(val => {
    isSliding.current = false;
    onSeek(val);
  }, [onSeek]);
  return /*#__PURE__*/_jsx(View, {
    style: styles.seekContainer,
    children: /*#__PURE__*/_jsx(Slider, {
      style: styles.seekSlider,
      value: value,
      minimumValue: 0,
      maximumValue: duration,
      onValueChange: handleValueChange,
      onSlidingStart: handleSlidingStart,
      onSlidingComplete: handleSlidingComplete,
      disabled: disabled,
      thumbSize: 12,
      minimumTrackTintColor: "#fff",
      maximumTrackTintColor: "rgba(255,255,255,0.25)",
      thumbTintColor: "#fff"
    })
  });
};
SeekBar.displayName = 'SeekBar';

// ─── VolumeControl ────────────────────────────────────────────────────────────

const VolumeControl = ({
  volume,
  isMuted,
  icons,
  iconSize,
  onToggleMute,
  onChange
}) => {
  const [showSlider, setShowSlider] = useState(false);
  const effectiveVolume = isMuted ? 0 : volume;
  const VolumeIcon = isMuted || effectiveVolume === 0 ? icons.volumeMute : effectiveVolume < 0.5 ? icons.volumeLow : icons.volumeHigh;
  return /*#__PURE__*/_jsxs(View, {
    style: styles.volumeWrapper,
    children: [showSlider && /*#__PURE__*/_jsx(View, {
      style: [styles.volumePopup, {
        bottom: iconSize * 1.5 + 25,
        left: (iconSize - 100) / 2 // Precisely centered above the icon
      }],
      children: /*#__PURE__*/_jsx(Slider, {
        style: styles.verticalSlider,
        value: effectiveVolume,
        minimumValue: 0,
        maximumValue: 1,
        onValueChange: onChange,
        thumbSize: iconSize,
        minimumTrackTintColor: "#fff",
        maximumTrackTintColor: "rgba(255,255,255,0.3)",
        thumbTintColor: "#fff"
      })
    }), /*#__PURE__*/_jsx(Pressable, {
      onPress: () => setShowSlider(v => !v),
      onLongPress: onToggleMute,
      style: styles.iconBtn,
      accessibilityLabel: isMuted ? 'Unmute' : 'Volume control',
      children: /*#__PURE__*/_jsx(VolumeIcon, {
        size: iconSize,
        color: "#fff"
      })
    })]
  });
};
VolumeControl.displayName = 'VolumeControl';

// ─── Main VideoControls ───────────────────────────────────────────────────────

export const VideoControls = ({
  state,
  streamProtocol,
  isFullscreen,
  seekInterval = 15,
  icons: customIcons,
  onPlay,
  onPause,
  onStop,
  onSeekBy,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  showCameraButton = false,
  onCapture
}) => {
  const insets = useSafeAreaInsets();
  const safeTop = isFullscreen ? insets.top : 0;
  const safeBottom = isFullscreen ? insets.bottom : 0;
  const safeLeft = isFullscreen ? insets.left : 0;
  const safeRight = isFullscreen ? insets.right : 0;
  const icons = {
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
    camera: customIcons?.camera ?? DefaultCamera
  };
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef(null);
  const [containerSize, setContainerSize] = useState({
    width: REF_SIZE,
    height: REF_SIZE
  });
  const iconSizes = calcIconSizes(containerSize.width, containerSize.height);
  const onOverlayLayout = useCallback(e => {
    const {
      width,
      height
    } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setContainerSize({
      width,
      height
    });
  }, []);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, []);
  const showAndScheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    if (state.playbackState === 'playing') {
      scheduleHide();
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [state.playbackState, scheduleHide]);
  const isLive = isLiveProtocol(streamProtocol, state.duration);
  const isRtsp = streamProtocol === 'rtsp';
  const seekDisabled = isLive || state.duration <= 0;
  const isActive = isActiveState(state.playbackState);
  const isPaused = state.paused;
  const handleSeekBy = useCallback(delta => {
    if (seekDisabled) return;
    const next = Math.max(0, Math.min(state.duration, state.currentTime + delta));
    onSeekBy(next);
    showAndScheduleHide();
  }, [seekDisabled, state.duration, state.currentTime, onSeekBy, showAndScheduleHide]);
  const handlePlayPause = useCallback(() => {
    if (isPaused) {
      onPlay();
    } else {
      onPause();
    }
    showAndScheduleHide();
  }, [isPaused, onPlay, onPause, showAndScheduleHide]);
  const PlayPauseIcon = isPaused ? icons.play : icons.pause;
  const FullscreenIcon = isFullscreen ? icons.exitFullscreen : icons.fullscreen;

  // Dynamic hiding logic
  const showSeek = containerSize.height > 180 && !isLive && isActive;
  const showTime = containerSize.width > 260;
  const showBottomControls = containerSize.height > 100;
  // Show volume and fullscreen only if enough width
  const showVolume = containerSize.width > 200 && showBottomControls;
  const showFullscreen = containerSize.width > 100 && showBottomControls;
  const showCenterSeeks = containerSize.width > 180;
  const showCamera = showCameraButton && containerSize.width > 120 && showBottomControls;
  return /*#__PURE__*/_jsx(Pressable, {
    style: StyleSheet.absoluteFill,
    onPress: showAndScheduleHide,
    accessibilityLabel: "Toggle controls",
    children: /*#__PURE__*/_jsx(FadeView, {
      visible: visible,
      children: /*#__PURE__*/_jsxs(View, {
        style: styles.overlay,
        onLayout: onOverlayLayout,
        children: [/*#__PURE__*/_jsxs(View, {
          style: [styles.topBar, {
            paddingTop: safeTop + 10,
            paddingLeft: safeLeft + iconSizes.padding * 1.5,
            paddingRight: safeRight + iconSizes.padding * 1.5
          }],
          children: [isLive && /*#__PURE__*/_jsx(View, {
            style: styles.liveBadge,
            children: /*#__PURE__*/_jsx(Text, {
              style: [styles.liveBadgeText, {
                fontSize: iconSizes.timeText * 1.5
              }],
              children: "\u25CF LIVE"
            })
          }), /*#__PURE__*/_jsx(View, {
            style: styles.flexSpacer
          }), showCamera && /*#__PURE__*/_jsx(Pressable, {
            style: styles.iconBtn,
            onPress: onCapture,
            accessibilityLabel: "Take screenshot",
            children: /*#__PURE__*/_jsx(icons.camera, {
              size: iconSizes.bottom + 2,
              color: "#fff"
            })
          })]
        }), /*#__PURE__*/_jsxs(View, {
          style: styles.centerRow,
          children: [showCenterSeeks && /*#__PURE__*/_jsx(Pressable, {
            style: [styles.iconBtn, seekDisabled && styles.disabled],
            onPress: () => handleSeekBy(-seekInterval),
            disabled: seekDisabled,
            accessibilityLabel: `Seek back ${seekInterval} seconds`,
            children: /*#__PURE__*/_jsx(icons.seekBack, {
              size: iconSizes.seek,
              color: seekDisabled ? '#555' : '#fff'
            })
          }), !isRtsp && /*#__PURE__*/_jsx(Pressable, {
            style: [styles.iconBtn, styles.playBtn, {
              width: iconSizes.playBtn,
              height: iconSizes.playBtn,
              borderRadius: iconSizes.playBtn / 2
            }],
            onPress: handlePlayPause,
            accessibilityLabel: isPaused ? 'Play' : 'Pause',
            children: /*#__PURE__*/_jsx(PlayPauseIcon, {
              size: iconSizes.play,
              color: "#fff"
            })
          }), showCenterSeeks && /*#__PURE__*/_jsx(Pressable, {
            style: [styles.iconBtn, seekDisabled && styles.disabled],
            onPress: () => handleSeekBy(seekInterval),
            disabled: seekDisabled,
            accessibilityLabel: `Seek forward ${seekInterval} seconds`,
            children: /*#__PURE__*/_jsx(icons.seekForward, {
              size: iconSizes.seek,
              color: seekDisabled ? '#555' : '#fff'
            })
          })]
        }), /*#__PURE__*/_jsxs(View, {
          style: [styles.bottomBar, {
            paddingLeft: safeLeft + iconSizes.padding,
            paddingRight: safeRight + iconSizes.padding,
            paddingBottom: safeBottom + 10
          }],
          children: [showSeek && /*#__PURE__*/_jsx(SeekBar, {
            currentTime: state.currentTime,
            duration: state.duration,
            disabled: seekDisabled,
            onSeek: onSeekBy
          }), showBottomControls && /*#__PURE__*/_jsxs(View, {
            style: styles.bottomControlsRow,
            children: [!isRtsp && /*#__PURE__*/_jsx(Pressable, {
              style: styles.iconBtn,
              onPress: handlePlayPause,
              accessibilityLabel: "Play/Pause",
              children: /*#__PURE__*/_jsx(PlayPauseIcon, {
                size: iconSizes.bottom,
                color: "#fff"
              })
            }), !isLive && showTime && /*#__PURE__*/_jsxs(Text, {
              style: [styles.timeText, {
                fontSize: iconSizes.timeText
              }],
              children: [formatTime(state.currentTime), state.duration > 0 ? ` / ${formatTime(state.duration)}` : '']
            }), /*#__PURE__*/_jsx(View, {
              style: styles.flexSpacer
            }), showFullscreen && /*#__PURE__*/_jsx(Pressable, {
              style: styles.iconBtn,
              onPress: onToggleFullscreen,
              accessibilityLabel: "Toggle Fullscreen",
              children: /*#__PURE__*/_jsx(FullscreenIcon, {
                size: iconSizes.bottom,
                color: "#fff"
              })
            }), showVolume && /*#__PURE__*/_jsx(VolumeControl, {
              volume: state.volume,
              isMuted: state.isMuted,
              icons: icons,
              iconSize: iconSizes.bottom,
              onToggleMute: onToggleMute,
              onChange: onVolumeChange
            })]
          })]
        })]
      })
    })
  });
};
VideoControls.displayName = 'VideoControls';
const styles = StyleSheet.create({
  bottomBar: {
    backgroundColor: 'transparent',
    paddingBottom: 10
  },
  bottomControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: -4
  },
  centerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center'
  },
  disabled: {
    opacity: 0.3
  },
  flexSpacer: {
    flex: 1
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  liveBadge: {
    backgroundColor: '#e53935',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  liveBadgeText: {
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 8
  },
  playBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.55)',
    borderWidth: 2
  },
  seekContainer: {
    height: 30,
    justifyContent: 'center',
    width: '100%'
  },
  seekSlider: {
    height: 40,
    width: '100%'
  },
  timeText: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
    marginLeft: 8
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 6,
    paddingTop: 10
  },
  verticalSlider: {
    height: 30,
    width: 90
  },
  volumePopup: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    transform: [{
      rotate: '-90deg'
    }],
    width: 100
  },
  volumeWrapper: {
    alignItems: 'center',
    position: 'relative'
  }
});
//# sourceMappingURL=VideoControls.js.map