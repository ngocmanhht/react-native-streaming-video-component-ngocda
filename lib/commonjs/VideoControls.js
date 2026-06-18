"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VideoControls = void 0;
var _react = _interopRequireWildcard(require("react"));
var _reactNative = require("react-native");
var _lucideReactNative = require("lucide-react-native");
var _reactNativeReanimated = _interopRequireWildcard(require("react-native-reanimated"));
var _slider = _interopRequireDefault(require("@react-native-community/slider"));
var _reactNativeSafeAreaContext = require("react-native-safe-area-context");
var _jsxRuntime = require("react/jsx-runtime");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// ─── Icon types ───────────────────────────────────────────────────────────────

// ─── Props ────────────────────────────────────────────────────────────────────

// ─── Default icons (Lucide) ──────────────────────────────────────────────────

const FallbackIcon = ({
  label,
  size = 20,
  color = '#fff'
}) => /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
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
    if (IconComponent) return /*#__PURE__*/(0, _jsxRuntime.jsx)(IconComponent, {
      ...p
    });
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(FallbackIcon, {
      label: emoji,
      ...p
    });
  };
  WrappedIcon.displayName = `Icon(${IconComponent?.displayName || 'Unknown'})`;
  return WrappedIcon;
};
const DefaultPlay = mkIcon(_lucideReactNative.Play, '▶');
const DefaultPause = mkIcon(_lucideReactNative.Pause, '⏸');
const DefaultStop = mkIcon(_lucideReactNative.Square, '⏹');
const DefaultSeekBack = mkIcon(_lucideReactNative.RotateCcw, '↩');
const DefaultSeekForward = mkIcon(_lucideReactNative.RotateCw, '↪');
const DefaultVolumeHigh = mkIcon(_lucideReactNative.Volume2, '🔊');
const DefaultVolumeLow = mkIcon(_lucideReactNative.Volume1, '🔉');
const DefaultVolumeMute = mkIcon(_lucideReactNative.VolumeX, '🔇');
const DefaultFullscreen = mkIcon(_lucideReactNative.Maximize, '⛶');
const DefaultExitFullscreen = mkIcon(_lucideReactNative.Minimize, '⊠');
const DefaultZoomIn = mkIcon(_lucideReactNative.ZoomIn, '➕');
const DefaultZoomOut = mkIcon(_lucideReactNative.ZoomOut, '➖');
const DefaultCamera = mkIcon(_lucideReactNative.Camera, '📸');

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
  const opacity = (0, _reactNativeReanimated.useSharedValue)(visible ? 1 : 0);
  const animStyle = (0, _reactNativeReanimated.useAnimatedStyle)(() => ({
    opacity: opacity.value
  }));
  (0, _react.useEffect)(() => {
    opacity.value = (0, _reactNativeReanimated.withTiming)(visible ? 1 : 0, {
      duration: visible ? FADE_IN_MS : FADE_OUT_MS
    });
  }, [visible, opacity]);
  if (!visible && opacity.value === 0) return null;
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNativeReanimated.default.View, {
    style: [_reactNative.StyleSheet.absoluteFill, animStyle],
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
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    style: styles.seekContainer,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_slider.default, {
      style: styles.seekSlider,
      value: currentTime,
      minimumValue: 0,
      maximumValue: duration,
      onSlidingComplete: onSeek,
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
  const [showSlider, setShowSlider] = (0, _react.useState)(false);
  const effectiveVolume = isMuted ? 0 : volume;
  const VolumeIcon = isMuted || effectiveVolume === 0 ? icons.volumeMute : effectiveVolume < 0.5 ? icons.volumeLow : icons.volumeHigh;
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
    style: styles.volumeWrapper,
    children: [showSlider && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: [styles.volumePopup, {
        bottom: iconSize * 1.5 + 25,
        left: (iconSize - 100) / 2 // Precisely centered above the icon
      }],
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_slider.default, {
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
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
      onPress: () => setShowSlider(v => !v),
      onLongPress: onToggleMute,
      style: styles.iconBtn,
      accessibilityLabel: isMuted ? 'Unmute' : 'Volume control',
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(VolumeIcon, {
        size: iconSize,
        color: "#fff"
      })
    })]
  });
};
VolumeControl.displayName = 'VolumeControl';

// ─── Main VideoControls ───────────────────────────────────────────────────────

const VideoControls = ({
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
  const insets = (0, _reactNativeSafeAreaContext.useSafeAreaInsets)();
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
  const [visible, setVisible] = (0, _react.useState)(true);
  const hideTimer = (0, _react.useRef)(null);
  const [containerSize, setContainerSize] = (0, _react.useState)({
    width: REF_SIZE,
    height: REF_SIZE
  });
  const iconSizes = calcIconSizes(containerSize.width, containerSize.height);
  const onOverlayLayout = (0, _react.useCallback)(e => {
    const {
      width,
      height
    } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setContainerSize({
      width,
      height
    });
  }, []);
  const scheduleHide = (0, _react.useCallback)(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, []);
  const showAndScheduleHide = (0, _react.useCallback)(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  (0, _react.useEffect)(() => {
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
  const handleSeekBy = (0, _react.useCallback)(delta => {
    if (seekDisabled) return;
    const next = Math.max(0, Math.min(state.duration, state.currentTime + delta));
    onSeekBy(next);
    showAndScheduleHide();
  }, [seekDisabled, state.duration, state.currentTime, onSeekBy, showAndScheduleHide]);
  const handlePlayPause = (0, _react.useCallback)(() => {
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
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
    style: _reactNative.StyleSheet.absoluteFill,
    onPress: showAndScheduleHide,
    accessibilityLabel: "Toggle controls",
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(FadeView, {
      visible: visible,
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
        style: styles.overlay,
        onLayout: onOverlayLayout,
        children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
          style: [styles.topBar, {
            paddingTop: safeTop + 10,
            paddingLeft: safeLeft + iconSizes.padding * 1.5,
            paddingRight: safeRight + iconSizes.padding * 1.5
          }],
          children: [isLive && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: styles.liveBadge,
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
              style: [styles.liveBadgeText, {
                fontSize: iconSizes.timeText * 1.5
              }],
              children: "\u25CF LIVE"
            })
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: styles.flexSpacer
          }), showCamera && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
            style: styles.iconBtn,
            onPress: onCapture,
            accessibilityLabel: "Take screenshot",
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(icons.camera, {
              size: iconSizes.bottom + 2,
              color: "#fff"
            })
          })]
        }), /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
          style: styles.centerRow,
          children: [showCenterSeeks && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
            style: [styles.iconBtn, seekDisabled && styles.disabled],
            onPress: () => handleSeekBy(-seekInterval),
            disabled: seekDisabled,
            accessibilityLabel: `Seek back ${seekInterval} seconds`,
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(icons.seekBack, {
              size: iconSizes.seek,
              color: seekDisabled ? '#555' : '#fff'
            })
          }), !isRtsp && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
            style: [styles.iconBtn, styles.playBtn, {
              width: iconSizes.playBtn,
              height: iconSizes.playBtn,
              borderRadius: iconSizes.playBtn / 2
            }],
            onPress: handlePlayPause,
            accessibilityLabel: isPaused ? 'Play' : 'Pause',
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(PlayPauseIcon, {
              size: iconSizes.play,
              color: "#fff"
            })
          }), showCenterSeeks && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
            style: [styles.iconBtn, seekDisabled && styles.disabled],
            onPress: () => handleSeekBy(seekInterval),
            disabled: seekDisabled,
            accessibilityLabel: `Seek forward ${seekInterval} seconds`,
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(icons.seekForward, {
              size: iconSizes.seek,
              color: seekDisabled ? '#555' : '#fff'
            })
          })]
        }), /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
          style: [styles.bottomBar, {
            paddingLeft: safeLeft + iconSizes.padding,
            paddingRight: safeRight + iconSizes.padding,
            paddingBottom: safeBottom + 10
          }],
          children: [showSeek && /*#__PURE__*/(0, _jsxRuntime.jsx)(SeekBar, {
            currentTime: state.currentTime,
            duration: state.duration,
            disabled: seekDisabled,
            onSeek: onSeekBy
          }), showBottomControls && /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
            style: styles.bottomControlsRow,
            children: [!isRtsp && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
              style: styles.iconBtn,
              onPress: handlePlayPause,
              accessibilityLabel: "Play/Pause",
              children: /*#__PURE__*/(0, _jsxRuntime.jsx)(PlayPauseIcon, {
                size: iconSizes.bottom,
                color: "#fff"
              })
            }), !isLive && showTime && /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.Text, {
              style: [styles.timeText, {
                fontSize: iconSizes.timeText
              }],
              children: [formatTime(state.currentTime), state.duration > 0 ? ` / ${formatTime(state.duration)}` : '']
            }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
              style: styles.flexSpacer
            }), showFullscreen && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
              style: styles.iconBtn,
              onPress: onToggleFullscreen,
              accessibilityLabel: "Toggle Fullscreen",
              children: /*#__PURE__*/(0, _jsxRuntime.jsx)(FullscreenIcon, {
                size: iconSizes.bottom,
                color: "#fff"
              })
            }), showVolume && /*#__PURE__*/(0, _jsxRuntime.jsx)(VolumeControl, {
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
exports.VideoControls = VideoControls;
VideoControls.displayName = 'VideoControls';
const styles = _reactNative.StyleSheet.create({
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