"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VideoPlayer = exports.DEFAULT_HEADERS = void 0;
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
// ─── Default Headers ─────────────────────────────────────────────────────────

const DEFAULT_HEADERS = exports.DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://cloudcam.vn/',
  'Origin': 'https://cloudcam.vn'
};

// ─── Native wrapper ───────────────────────────────────────────────────────────

const NativeVideoPlayer = (0, _reactNativeNitroModules.getHostComponent)('VideoPlayerView', () => _VideoPlayerViewConfig.default);

// ─── Public props ─────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

const VideoPlayer = ({
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
  const resolvedHeaders = _react.default.useMemo(() => {
    return {
      ...DEFAULT_HEADERS,
      ...(propHeaders || {})
    };
  }, [propHeaders]);

  // Resolve raw stream URL string from either `url` or `source` prop
  const rawUrl = propUrl || (typeof propSource === 'string' ? propSource : typeof propSource === 'object' && propSource?.uri ? propSource.uri : '') || '';
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
    takeScreenshot
  } = (0, _useVideoPlayer.useVideoPlayer)({
    initialPaused: externalPaused ?? false,
    initialVolume,
    initialMuted
  });

  // Sync external paused prop → chỉ chạy khi externalPaused thực sự thay đổi
  // Dùng ref để phân biệt lần mount đầu tiên vs thay đổi thực sự
  const prevExternalPaused = (0, _react.useRef)(externalPaused);
  (0, _react.useEffect)(() => {
    if (prevExternalPaused.current === externalPaused) return;
    prevExternalPaused.current = externalPaused;
    if (externalPaused) pause();else play();
  }, [externalPaused, pause, play]);

  // App lifecycle management (pause in background, resume when active)
  const wasPlayingBeforeBackground = (0, _react.useRef)(false);
  (0, _react.useEffect)(() => {
    const subscription = _reactNative.AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (!state.paused) {
          wasPlayingBeforeBackground.current = true;
          pause();
        }
      } else if (nextAppState === 'active') {
        if (wasPlayingBeforeBackground.current) {
          wasPlayingBeforeBackground.current = false;
          play();
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [state.paused, pause, play]);

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
  const [, setReadyFullscreen] = (0, _react.useState)(false);
  const [currentZoom, setCurrentZoom] = (0, _react.useState)(1);
  const [showZoomBadge, setShowZoomBadge] = (0, _react.useState)(false);
  const [showShutterFlash, setShowShutterFlash] = (0, _react.useState)(false);
  const zoomTimeoutRef = (0, _react.useRef)(null);
  const pendingSeekAfterRemount = (0, _react.useRef)(null);

  // ── Orientation Management ────────────────────────────────────────────────
  (0, _react.useEffect)(() => {
    if (_reactNative.Platform.OS === 'ios') {
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
    } else {
      // Android: Do not lock orientation physically to avoid rotating the entire MainActivity.
      if (isFullscreen) {
        setReadyFullscreen(true);
      } else {
        setReadyFullscreen(false);
      }
    }
    return () => {
      if (_reactNative.Platform.OS === 'ios') {
        try {
          _reactNativeOrientationLocker.default.unlockAllOrientations();
          _reactNativeOrientationLocker.default.lockToPortrait();
        } catch (e) {
          console.warn('Orientation error:', e);
        }
      }
    };
  }, [isFullscreen]);
  const toggleFullscreen = (0, _react.useCallback)(() => {
    if (!isLive && state.currentTime > 0) {
      pendingSeekAfterRemount.current = state.currentTime;
    }
    setIsFullscreen(fs => !fs);
  }, [isLive, state.currentTime]);

  // ── Unified Callback Handlers (Fires both internal state and user callbacks) ──
  const handleReady = (0, _react.useCallback)(event => {
    onReady(event);
    userOnReady?.(event);
    if (!isLive && pendingSeekAfterRemount.current !== null && pendingSeekAfterRemount.current > 0) {
      const target = pendingSeekAfterRemount.current;
      pendingSeekAfterRemount.current = null;
      setTimeout(() => {
        seekTo(target);
      }, 150);
    }
  }, [onReady, userOnReady, isLive, seekTo]);
  const handleProgress = (0, _react.useCallback)(event => {
    onProgress(event);
    userOnProgress?.(event);
  }, [onProgress, userOnProgress]);
  const handleBuffering = (0, _react.useCallback)(isBuffering => {
    onBuffering(isBuffering);
    userOnBuffering?.(isBuffering);
  }, [onBuffering, userOnBuffering]);
  const handleStateChange = (0, _react.useCallback)(s => {
    onStateChange(s);
    userOnStateChange?.(s);
  }, [onStateChange, userOnStateChange]);
  const handleError = (0, _react.useCallback)(event => {
    onError(event);
    userOnError?.(event);
  }, [onError, userOnError]);
  const handleEnd = (0, _react.useCallback)(() => {
    onEnd();
    userOnEnd?.();
  }, [onEnd, userOnEnd]);

  // ── Shared native player element ──────────────────────────────────────────
  const zoomScale = (0, _reactNativeReanimated.useSharedValue)(1);
  const savedZoomScale = (0, _reactNativeReanimated.useSharedValue)(1);
  const renderControls = protocol => showControls ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_VideoControls.VideoControls, {
    state: state,
    streamProtocol: protocol,
    isFullscreen: isFullscreen,
    isLive: isLive,
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
        setShowShutterFlash(true);
        setTimeout(() => {
          setShowShutterFlash(false);
        }, 150);
        const path = await takeScreenshot();
        onCapture?.(path);
      } catch (e) {
        console.error('Capture failed:', e);
      }
    }
  }) : null;
  const playerEl = /*#__PURE__*/(0, _jsxRuntime.jsx)(NativeVideoPlayer, {
    hybridRef: (0, _reactNativeNitroModules.callback)(handleHybridRef),
    url: rawUrl,
    headers: resolvedHeaders,
    streamProtocol: streamProtocol,
    paused: state.paused,
    volume: state.isMuted ? 0 : state.volume,
    muted: state.isMuted,
    zoomEnabled: zoomEnabled && isFullscreen,
    isLive: isLive,
    onStateChange: (0, _reactNativeNitroModules.callback)(handleStateChange),
    onProgress: (0, _reactNativeNitroModules.callback)(handleProgress),
    onBuffering: (0, _reactNativeNitroModules.callback)(handleBuffering),
    onError: (0, _reactNativeNitroModules.callback)(handleError),
    onEnd: (0, _reactNativeNitroModules.callback)(handleEnd),
    onReady: (0, _reactNativeNitroModules.callback)(handleReady),
    ...nativeProps,
    style: styles.playerNativeStyle
  }, `${streamProtocol}-${rawUrl}`);
  const controlsEl = renderControls(streamProtocol);
  const {
    width: W,
    height: H
  } = _reactNative.Dimensions.get('window');
  const screenWidth = Math.min(W, H);
  const screenHeight = Math.max(W, H);
  const containerStyle = isFullscreen ? _reactNative.Platform.OS === 'android' ? [styles.fullscreenContainer, {
    width: screenHeight,
    height: screenWidth,
    position: 'absolute',
    top: (screenHeight - screenWidth) / 2,
    left: (screenWidth - screenHeight) / 2,
    transform: [{
      rotate: '90deg'
    }]
  }] : styles.fullscreenContainer : [styles.container, style];
  const playerComponent = /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNativeGestureHandler.GestureHandlerRootView, {
    style: containerStyle,
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.StatusBar, {
      hidden: isFullscreen,
      animated: true
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
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
    }), showShutterFlash && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: [_reactNative.StyleSheet.absoluteFill, styles.shutterFlash],
      pointerEvents: "none"
    }), isFullscreen && showZoomBadge && currentZoom > 1.05 && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: styles.zoomBadge,
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.Text, {
        style: styles.zoomBadgeText,
        children: [currentZoom.toFixed(1), "x"]
      })
    })]
  });
  if (isFullscreen) {
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Modal, {
      visible: true,
      transparent: false,
      statusBarTranslucent: true,
      animationType: "none",
      supportedOrientations: ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'],
      onRequestClose: toggleFullscreen,
      children: playerComponent
    });
  }
  return playerComponent;
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
    overflow: 'hidden',
    width: '100%'
  },
  fullscreenContainer: {
    alignItems: 'center',
    backgroundColor: '#000',
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    width: '100%'
  },
  playerNativeStyle: {
    height: '100%',
    width: '100%'
  },
  shutterFlash: {
    backgroundColor: '#fff',
    opacity: 0.8
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