"use strict";

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Modal, StatusBar, StyleSheet, View, Text } from 'react-native';
import { getHostComponent, callback } from 'react-native-nitro-modules';
import Reanimated, { useSharedValue, withTiming, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Orientation from 'react-native-orientation-locker';
import VideoPlayerViewConfig from '../nitrogen/generated/shared/json/VideoPlayerViewConfig.json';
import { VideoControls } from './VideoControls';
import { useVideoPlayer } from './useVideoPlayer';

// ─── Native wrapper ───────────────────────────────────────────────────────────
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const NativeVideoPlayer = getHostComponent('VideoPlayerView', () => VideoPlayerViewConfig);

// ─── Public props ─────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export const VideoPlayer = ({
  style,
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
    takeScreenshot
  } = useVideoPlayer({
    initialPaused: externalPaused ?? false,
    initialVolume,
    initialMuted
  });

  // Sync external paused prop → chỉ chạy khi externalPaused thực sự thay đổi
  // Dùng ref để phân biệt lần mount đầu tiên vs thay đổi thực sự
  const prevExternalPaused = useRef(externalPaused);
  useEffect(() => {
    if (prevExternalPaused.current === externalPaused) return;
    prevExternalPaused.current = externalPaused;
    if (externalPaused) pause();else play();
  }, [externalPaused, pause, play]);

  // ── Ref Management ───────────────────────────────────────────────────────
  // We use a callback ref to ensure internalRef is always set (for useVideoPlayer logic)
  // while also forwarding the ref to externalRef if provided.
  // We use hybridRef to get the Nitro HybridObject which contains the actual methods
  const handleHybridRef = useCallback(node => {
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [readyFullscreen, setReadyFullscreen] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [showZoomBadge, setShowZoomBadge] = useState(false);
  const zoomTimeoutRef = useRef(null);

  // ── Orientation Management ────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (isFullscreen) {
        Orientation.unlockAllOrientations();
        Orientation.lockToLandscape();
        setTimeout(() => {
          setReadyFullscreen(true);
        }, 500);
      } else {
        setReadyFullscreen(false);
        Orientation.unlockAllOrientations();
        Orientation.lockToPortrait();
      }
    } catch (e) {
      console.warn('Orientation error:', e);
    }
    return () => {
      try {
        Orientation.unlockAllOrientations();
        Orientation.lockToPortrait();
      } catch (e) {
        console.warn('Orientation error:', e);
      }
    };
  }, [isFullscreen]);
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(fs => !fs);
  }, []);

  // ── Unified Callback Handlers (Fires both internal state and user callbacks) ──
  const handleReady = useCallback(event => {
    onReady(event);
    userOnReady?.(event);
  }, [onReady, userOnReady]);
  const handleProgress = useCallback(event => {
    onProgress(event);
    userOnProgress?.(event);
  }, [onProgress, userOnProgress]);
  const handleBuffering = useCallback(isBuffering => {
    onBuffering(isBuffering);
    userOnBuffering?.(isBuffering);
  }, [onBuffering, userOnBuffering]);
  const handleStateChange = useCallback(s => {
    onStateChange(s);
    userOnStateChange?.(s);
  }, [onStateChange, userOnStateChange]);
  const handleError = useCallback(event => {
    onError(event);
    userOnError?.(event);
  }, [onError, userOnError]);
  const handleEnd = useCallback(() => {
    onEnd();
    userOnEnd?.();
  }, [onEnd, userOnEnd]);

  // ── Shared native player element ──────────────────────────────────────────
  const zoomScale = useSharedValue(1);
  const savedZoomScale = useSharedValue(1);
  const renderContent = () => {
    const playerEl = /*#__PURE__*/_jsx(NativeVideoPlayer, {
      hybridRef: callback(handleHybridRef),
      streamProtocol: streamProtocol,
      paused: state.paused,
      volume: state.isMuted ? 0 : state.volume,
      muted: state.isMuted,
      zoomEnabled: zoomEnabled && isFullscreen,
      isLive: isLive,
      onStateChange: callback(handleStateChange),
      onProgress: callback(handleProgress),
      onBuffering: callback(handleBuffering),
      onError: callback(handleError),
      onEnd: callback(handleEnd),
      onReady: callback(handleReady),
      ...nativeProps,
      style: {
        width: '100%',
        height: '100%'
      }
    }, streamProtocol);
    const controlsEl = renderControls(streamProtocol);
    return /*#__PURE__*/_jsx(View, {
      style: StyleSheet.absoluteFill,
      children: /*#__PURE__*/_jsx(ZoomableView, {
        zoomEnabled: zoomEnabled && isFullscreen,
        style: StyleSheet.absoluteFill,
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
  const renderControls = protocol => showControls ? /*#__PURE__*/_jsx(VideoControls, {
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
    return /*#__PURE__*/_jsx(View, {
      style: [styles.container, style],
      children: renderContent()
    });
  }
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx(View, {
      style: [styles.container, style],
      pointerEvents: "none"
    }), /*#__PURE__*/_jsx(Modal, {
      visible: isFullscreen,
      transparent: false,
      animationType: "fade",
      statusBarTranslucent: true,
      supportedOrientations: ['landscape-left', 'landscape-right', 'portrait'],
      onRequestClose: toggleFullscreen,
      children: /*#__PURE__*/_jsxs(GestureHandlerRootView, {
        style: {
          flex: 1
        },
        children: [/*#__PURE__*/_jsx(StatusBar, {
          hidden: true
        }), /*#__PURE__*/_jsxs(View, {
          style: styles.fullscreenContainer,
          children: [readyFullscreen ? renderContent() : null, showZoomBadge && currentZoom > 1.05 && /*#__PURE__*/_jsx(View, {
            style: styles.zoomBadge,
            children: /*#__PURE__*/_jsxs(Text, {
              style: styles.zoomBadgeText,
              children: [currentZoom.toFixed(1), "x"]
            })
          })]
        })]
      })
    }, `${isFullscreen}-${streamProtocol}`)]
  });
};
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
    return /*#__PURE__*/_jsxs(View, {
      style: style,
      children: [player, controls]
    });
  }
  return /*#__PURE__*/_jsx(ZoomableInner, {
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
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const savedOffsetX = useSharedValue(0);
  const savedOffsetY = useSharedValue(0);
  const pinchGesture = Gesture.Pinch().onUpdate(e => {
    scale.value = Math.max(1, Math.min(5, savedScale.value * e.scale));
  }).onEnd(() => {
    if (scale.value < 1.05) {
      scale.value = withTiming(1);
      savedScale.value = 1;
      offsetX.value = withTiming(0);
      offsetY.value = withTiming(0);
      savedOffsetX.value = 0;
      savedOffsetY.value = 0;
    } else {
      savedScale.value = scale.value;
    }
    if (onZoomChange) runOnJS(onZoomChange)(scale.value);
  });
  const panGesture = Gesture.Pan().onUpdate(e => {
    if (scale.value > 1) {
      offsetX.value = savedOffsetX.value + e.translationX;
      offsetY.value = savedOffsetY.value + e.translationY;
    }
  }).onEnd(() => {
    if (scale.value <= 1) {
      offsetX.value = withTiming(0);
      offsetY.value = withTiming(0);
      savedOffsetX.value = 0;
      savedOffsetY.value = 0;
    } else {
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
    }
  });
  const composed = Gesture.Simultaneous(pinchGesture, panGesture);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: offsetX.value
    }, {
      translateY: offsetY.value
    }, {
      scale: scale.value
    }]
  }));
  return /*#__PURE__*/_jsx(GestureDetector, {
    gesture: composed,
    children: /*#__PURE__*/_jsxs(View, {
      style: style,
      children: [/*#__PURE__*/_jsx(Reanimated.View, {
        style: [StyleSheet.absoluteFill, animatedStyle],
        children: player
      }), controls]
    })
  });
};
ZoomableInner.displayName = 'ZoomableInner';
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#000',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  fullscreenContainer: {
    backgroundColor: '#000',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center'
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