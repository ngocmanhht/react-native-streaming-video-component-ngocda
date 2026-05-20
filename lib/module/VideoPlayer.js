"use strict";

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Platform, StatusBar, StyleSheet, View, Text } from 'react-native';
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
  } = useVideoPlayer({
    initialPaused: externalPaused ?? false,
    initialVolume,
    initialMuted
  });

  // Sync external paused prop
  useEffect(() => {
    if (externalPaused === undefined) return;
    if (externalPaused) pause();else play();
  }, [externalPaused, pause, play]);

  // Sync volume if it changes externally
  const isMounted = React.useRef(false);
  useEffect(() => {
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
  const [currentZoom, setCurrentZoom] = useState(1);
  const [showZoomBadge, setShowZoomBadge] = useState(false);
  const zoomTimeoutRef = useRef(null);

  // ── Orientation Management ────────────────────────────────────────────────
  useEffect(() => {
    const changeOrientation = async () => {
      try {
        if (isFullscreen) {
          // Important for iOS
          Orientation.unlockAllOrientations();
          setTimeout(() => {
            Orientation.lockToLandscape();
          }, 100);
        } else {
          Orientation.unlockAllOrientations();
          setTimeout(() => {
            Orientation.lockToPortrait();
          }, 100);
        }
      } catch (e) {
        console.warn('Orientation error:', e);
      }
    };
    changeOrientation();
    return () => {
      try {
        Orientation.unlockAllOrientations();
        Orientation.lockToPortrait();
      } catch (e) {}
    };
  }, [isFullscreen]);
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(fs => !fs);
  }, []);

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
      onStateChange: onStateChange,
      onProgress: onProgress,
      onBuffering: onBuffering,
      onError: onError,
      onEnd: onEnd,
      onReady: onReady,
      ...nativeProps,
      style: StyleSheet.absoluteFill
    });
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

  // ── Fullscreen: DO NOT use Modal for HLS/AVPlayer ────────────────────────────
  // Modal causes NativeVideoPlayer to unmount + remount in a new UIWindow on iOS,
  // which breaks AVPlayerLayer connection → black screen.
  // Fix: keep the native view in ONE place in the React tree always.
  // In fullscreen mode, change the container's style to cover the whole screen.
  // A placeholder View preserves the original layout space.
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [isFullscreen && /*#__PURE__*/_jsx(View, {
      style: [styles.container, style],
      pointerEvents: "none"
    }), /*#__PURE__*/_jsx(View, {
      style: isFullscreen ? [styles.fullscreenOverlay,
      // On Android elevation is also required; on iOS zIndex is enough
      Platform.OS === 'android' ? {
        elevation: 9999
      } : {}] : [styles.container, style],
      children: /*#__PURE__*/_jsxs(GestureHandlerRootView, {
        style: StyleSheet.absoluteFill,
        children: [isFullscreen && /*#__PURE__*/_jsx(StatusBar, {
          hidden: true
        }), renderContent(), showZoomBadge && currentZoom > 1.05 && /*#__PURE__*/_jsx(View, {
          style: styles.zoomBadge,
          children: /*#__PURE__*/_jsxs(Text, {
            style: styles.zoomBadgeText,
            children: [currentZoom.toFixed(1), "x"]
          })
        })]
      })
    })]
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
  // Fullscreen overlay — covers the entire screen without using Modal
  // This prevents AVPlayerLayer from being detached (Modal creates a new UIWindow on iOS)
  fullscreenOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: '#000'
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