"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useVideoPlayer = useVideoPlayer;
var _react = require("react");
function useVideoPlayer(options = {}) {
  const {
    initialPaused = false,
    initialVolume = 1,
    initialMuted = true
  } = options;
  const ref = (0, _react.useRef)(null);
  const [state, setState] = (0, _react.useState)({
    paused: initialPaused,
    playbackState: 'idle',
    currentTime: 0,
    duration: -1,
    isBuffering: false,
    volume: initialVolume,
    isMuted: initialMuted,
    error: null
  });

  // ── Sync external paused prop changes ──────────────────────────────────────
  // If the consumer controls `paused` from outside (e.g. <VideoPlayer paused={x} />),
  // keep internal state in sync.
  (0, _react.useEffect)(() => {
    setState(prev => {
      if (prev.paused === initialPaused) return prev;
      return {
        ...prev,
        paused: initialPaused
      };
    });
  }, [initialPaused]);

  // ── Playback controls ──────────────────────────────────────────────────────
  // IMPORTANT: we update `paused` STATE (which flows as a prop to the native
  // component) rather than calling the imperative play()/pause() methods.
  // This avoids the race condition where a re-render resets the native state
  // because the prop still says paused=false but we called pause() imperatively.

  const play = (0, _react.useCallback)(() => {
    setState(prev => ({
      ...prev,
      paused: false
    }));
    if (typeof ref.current?.play === 'function') {
      ref.current.play();
    }
  }, []);
  const pause = (0, _react.useCallback)(() => {
    setState(prev => ({
      ...prev,
      paused: true
    }));
    if (typeof ref.current?.pause === 'function') {
      ref.current.pause();
    }
  }, []);
  const stop = (0, _react.useCallback)(() => {
    setState(prev => ({
      ...prev,
      paused: true,
      currentTime: 0,
      playbackState: 'idle'
    }));
    if (typeof ref.current?.stop === 'function') {
      ref.current.stop();
    }
  }, []);

  // ── Seek ───────────────────────────────────────────────────────────────────
  // Seek is always imperative (there's no "seekTo" prop on the native component)

  const seekTo = (0, _react.useCallback)(seconds => {
    if (typeof ref.current?.seekTo === 'function') {
      ref.current.seekTo(seconds);
    }
  }, []);
  const seekBy = (0, _react.useCallback)(targetSeconds => {
    // targetSeconds is already the absolute position (calculated by VideoControls)
    if (typeof ref.current?.seekTo === 'function') {
      ref.current.seekTo(targetSeconds);
    }
  }, []);

  // ── Volume ─────────────────────────────────────────────────────────────────

  const setVolume = (0, _react.useCallback)(v => {
    const clamped = Math.max(0, Math.min(1, v));
    setState(prev => ({
      ...prev,
      volume: clamped,
      isMuted: clamped === 0
    }));
  }, []);
  const toggleMute = (0, _react.useCallback)(() => {
    setState(prev => ({
      ...prev,
      isMuted: !prev.isMuted
    }));
  }, []);

  // ── Native callbacks ───────────────────────────────────────────────────────
  // These are wired to the native component's onXxx props

  const onStateChange = (0, _react.useCallback)(s => setState(prev => {
    // Reconcile: if native says 'playing' but our paused flag is true
    // (user pressed pause mid-load), don't mark as playing in JS.
    // The native component will receive paused=true on next render and pause.
    if (s === 'playing' && prev.paused) return prev;
    return {
      ...prev,
      playbackState: s
    };
  }), []);
  const onProgress = (0, _react.useCallback)(e => setState(prev => ({
    ...prev,
    currentTime: e.currentTime,
    duration: e.duration
  })), []);
  const onBuffering = (0, _react.useCallback)(b => setState(prev => ({
    ...prev,
    isBuffering: b
  })), []);
  const onError = (0, _react.useCallback)(e => setState(prev => ({
    ...prev,
    error: e.message,
    playbackState: 'error'
  })), []);
  const onEnd = (0, _react.useCallback)(() => setState(prev => ({
    ...prev,
    playbackState: 'ended',
    paused: true
  })), []);
  const onReady = (0, _react.useCallback)(() => setState(prev => ({
    ...prev,
    playbackState: 'ready'
  })), []);
  const takeScreenshot = (0, _react.useCallback)(async () => {
    if (typeof ref.current?.takeScreenshot === 'function') {
      return await ref.current.takeScreenshot();
    }
    throw new Error('Native method takeScreenshot not available');
  }, []);
  return {
    ref,
    state,
    // controls
    play,
    pause,
    stop,
    seekTo,
    seekBy,
    setVolume,
    toggleMute,
    takeScreenshot,
    // native callbacks
    onStateChange,
    onProgress,
    onBuffering,
    onError,
    onEnd,
    onReady
  };
}
//# sourceMappingURL=useVideoPlayer.js.map