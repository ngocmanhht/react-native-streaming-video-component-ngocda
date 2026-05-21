"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VideoPlayer = void 0;
var _react = _interopRequireWildcard(require("react"));
var _reactNative = require("react-native");
var _reactNativeNitroModules = require("react-native-nitro-modules");
var _reactNativeReanimated = _interopRequireWildcard(require("react-native-reanimated"));
var _reactNativeGestureHandler = require("react-native-gesture-handler");
var _reactNativeOrientationLocker = _interopRequireDefault(require("react-native-orientation-locker"));
var _VideoPlayerViewConfig = _interopRequireDefault(require("../nitrogen/generated/shared/json/VideoPlayerViewConfig.json"));
var _VideoControls = require("./VideoControls");
var _useVideoPlayer = require("./useVideoPlayer");
var _jsxRuntime = require("react/jsx-runtime");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// ─── Native wrapper ───────────────────────────────────────────────────────────
const NativeVideoPlayer = (0, _reactNativeNitroModules.getHostComponent)('VideoPlayerView', () => _VideoPlayerViewConfig.default);

// ─── Public props ─────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

const VideoPlayer = ({
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
    takeScreenshot
  } = (0, _useVideoPlayer.useVideoPlayer)({
    initialPaused: externalPaused ?? false,
    initialVolume,
    initialMuted
  });

  // Sync external paused prop
  (0, _react.useEffect)(() => {
    if (externalPaused === undefined) return;
    if (externalPaused) pause();else play();
  }, [externalPaused, pause, play]);

  // Sync volume if it changes externally
  const isMounted = _react.default.useRef(false);
  (0, _react.useEffect)(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    setVolume(initialVolume);
  }, [initialVolume, setVolume]);

  // ── Ref Management ───────────────────────────────────────────────────────
  // We use a callback ref to ensure internalRef is always set (for useVideoPlayer logic)
  // while also forwarding the ref to externalRef if provided.
  // We use hybridRef to get the Nitro HybridObject which contains the actual methods
  const handleHybridRef = (0, _react.useCallback)(node => {
    ;
    internalRef.current = node;
    if (externalRef) {
      if (typeof externalRef === 'function') {
        ;
        externalRef(node);
      } else {
        ;
        externalRef.current = node;
      }
    }
  }, [externalRef, internalRef]);
  const [isFullscreen, setIsFullscreen] = (0, _react.useState)(false);
  const [readyFullscreen, setReadyFullscreen] = (0, _react.useState)(false);
  const [currentZoom, setCurrentZoom] = (0, _react.useState)(1);
  const [showZoomBadge, setShowZoomBadge] = (0, _react.useState)(false);
  const zoomTimeoutRef = (0, _react.useRef)(null);

  // ── Orientation Management ────────────────────────────────────────────────
  (0, _react.useEffect)(() => {
    try {
      if (isFullscreen) {
        _reactNativeOrientationLocker.default.unlockAllOrientations();
        _reactNativeOrientationLocker.default.lockToLandscape();
        setTimeout(() => {
          setReadyFullscreen(true);
        }, 500);
      } else {
        setReadyFullscreen(false);
        _reactNativeOrientationLocker.default.unlockAllOrientations();
        _reactNativeOrientationLocker.default.lockToPortrait();
      }
    } catch (e) {
      console.warn('Orientation error:', e);
    }
    return () => {
      try {
        _reactNativeOrientationLocker.default.unlockAllOrientations();
        _reactNativeOrientationLocker.default.lockToPortrait();
      } catch (e) {}
    };
  }, [isFullscreen]);
  const toggleFullscreen = (0, _react.useCallback)(() => {
    setIsFullscreen(fs => !fs);
  }, []);

  // ── Shared native player element ──────────────────────────────────────────
  const zoomScale = (0, _reactNativeReanimated.useSharedValue)(1);
  const savedZoomScale = (0, _reactNativeReanimated.useSharedValue)(1);
  const renderContent = () => {
    const playerEl = /*#__PURE__*/(0, _jsxRuntime.jsx)(NativeVideoPlayer, {
      hybridRef: (0, _reactNativeNitroModules.callback)(handleHybridRef),
      streamProtocol: streamProtocol,
      paused: state.paused,
      volume: state.isMuted ? 0 : state.volume,
      muted: state.isMuted,
      zoomEnabled: zoomEnabled && isFullscreen,
      onStateChange: onStateChange,
      onProgress: onProgress,
      onBuffering: onBuffering,
      onError: onError,
      onEnd: onEnd,
      onReady: onReady,
      ...nativeProps,
      style: {
        width: '100%',
        height: '100%'
      }
    }, `${isFullscreen}-${streamProtocol}`);
    const controlsEl = renderControls(streamProtocol);
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: _reactNative.StyleSheet.absoluteFill,
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(ZoomableView, {
        zoomEnabled: zoomEnabled && isFullscreen,
        style: _reactNative.StyleSheet.absoluteFill,
        scale: zoomScale,
        savedScale: savedZoomScale,
        player: playerEl,
        controls: controlsEl,
        onZoomChange: zoom => {
          setCurrentZoom(zoom);
          setShowZoomBadge(true);
          if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = setTimeout(() => {
            setShowZoomBadge(false);
          }, 2000);
        }
      })
    });
  };
  const renderControls = protocol => showControls ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_VideoControls.VideoControls, {
    state: state,
    streamProtocol: protocol,
    isFullscreen: isFullscreen,
    seekInterval: seekInterval,
    icons: icons,
    onPlay: play,
    onPause: pause,
    onStop: stop,
    onSeekBy: seekBy,
    onVolumeChange: setVolume,
    onToggleMute: toggleMute,
    onToggleFullscreen: toggleFullscreen,
    showCameraButton: showCameraButton,
    onCapture: async () => {
      try {
        const path = await takeScreenshot();
        onCapture?.(path);
      } catch (e) {
        console.error('Capture failed:', e);
      }
    }
  }) : null;
  if (!isFullscreen) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: [styles.container, style],
      children: renderContent()
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: [styles.container, style],
      pointerEvents: "none"
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Modal, {
      visible: isFullscreen,
      transparent: false,
      animationType: "fade",
      statusBarTranslucent: true,
      supportedOrientations: ['landscape-left', 'landscape-right', 'portrait'],
      onRequestClose: toggleFullscreen,
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNativeGestureHandler.GestureHandlerRootView, {
        style: {
          flex: 1
        },
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.StatusBar, {
          hidden: true
        }), /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
          style: styles.fullscreenContainer,
          children: [renderContent(), showZoomBadge && currentZoom > 1.05 && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: styles.zoomBadge,
            children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.Text, {
              style: styles.zoomBadgeText,
              children: [currentZoom.toFixed(1), "x"]
            })
          })]
        })]
      })
    })]
  });
};
exports.VideoPlayer = VideoPlayer;
const ZoomableView = ({
  zoomEnabled,
  style,
  player,
  controls,
  scale,
  savedScale,
  onZoomChange
}) => {
  if (!zoomEnabled) {
    return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
      style: style,
      children: [player, controls]
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(ZoomableInner, {
    style: style,
    player: player,
    controls: controls,
    scale: scale,
    savedScale: savedScale,
    onZoomChange: onZoomChange
  });
};
ZoomableView.displayName = 'ZoomableView';
const ZoomableInner = ({
  style,
  player,
  controls,
  scale,
  savedScale,
  onZoomChange
}) => {
  const offsetX = (0, _reactNativeReanimated.useSharedValue)(0);
  const offsetY = (0, _reactNativeReanimated.useSharedValue)(0);
  const savedOffsetX = (0, _reactNativeReanimated.useSharedValue)(0);
  const savedOffsetY = (0, _reactNativeReanimated.useSharedValue)(0);
  const pinchGesture = _reactNativeGestureHandler.Gesture.Pinch().onUpdate(e => {
    scale.value = Math.max(1, Math.min(5, savedScale.value * e.scale));
  }).onEnd(() => {
    if (scale.value < 1.05) {
      scale.value = (0, _reactNativeReanimated.withTiming)(1);
      savedScale.value = 1;
      offsetX.value = (0, _reactNativeReanimated.withTiming)(0);
      offsetY.value = (0, _reactNativeReanimated.withTiming)(0);
      savedOffsetX.value = 0;
      savedOffsetY.value = 0;
    } else {
      savedScale.value = scale.value;
    }
    if (onZoomChange) (0, _reactNativeReanimated.runOnJS)(onZoomChange)(scale.value);
  });
  const panGesture = _reactNativeGestureHandler.Gesture.Pan().onUpdate(e => {
    if (scale.value > 1) {
      offsetX.value = savedOffsetX.value + e.translationX;
      offsetY.value = savedOffsetY.value + e.translationY;
    }
  }).onEnd(() => {
    if (scale.value <= 1) {
      offsetX.value = (0, _reactNativeReanimated.withTiming)(0);
      offsetY.value = (0, _reactNativeReanimated.withTiming)(0);
      savedOffsetX.value = 0;
      savedOffsetY.value = 0;
    } else {
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
    }
  });
  const composed = _reactNativeGestureHandler.Gesture.Simultaneous(pinchGesture, panGesture);
  const animatedStyle = (0, _reactNativeReanimated.useAnimatedStyle)(() => ({
    transform: [{
      translateX: offsetX.value
    }, {
      translateY: offsetY.value
    }, {
      scale: scale.value
    }]
  }));
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNativeGestureHandler.GestureDetector, {
    gesture: composed,
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
      style: style,
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNativeReanimated.default.View, {
        style: [_reactNative.StyleSheet.absoluteFill, animatedStyle],
        children: player
      }), controls]
    })
  });
};
ZoomableInner.displayName = 'ZoomableInner';
const styles = _reactNative.StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#000',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  fullscreenContainer: {
    alignItems: 'center',
    backgroundColor: '#000',
    flex: 1,
    justifyContent: 'center'
  },
  zoomBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'absolute',
    top: 40
  },
  zoomBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  }
});
//# sourceMappingURL=VideoPlayer.js.map