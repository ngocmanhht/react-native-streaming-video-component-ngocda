import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoPlayerView, PlaybackState, ProgressEvent } from './VideoPlayer.nitro'

export interface VideoPlayerState {
  /** Single source of truth for playback – drives the native `paused` prop */
  paused: boolean
  playbackState: PlaybackState
  currentTime: number
  duration: number
  isBuffering: boolean
  volume: number // 0.0 – 1.0
  isMuted: boolean
  error: string | null
}

interface UseVideoPlayerOptions {
  /** Initial paused state (can be kept in sync with an external prop) */
  initialPaused?: boolean
}

export function useVideoPlayer(options: UseVideoPlayerOptions = {}) {
  const { initialPaused = false } = options
  const ref = useRef<VideoPlayerView>(null)

  const [state, setState] = useState<VideoPlayerState>({
    paused: initialPaused,
    playbackState: 'idle',
    currentTime: 0,
    duration: -1,
    isBuffering: false,
    volume: 1,
    isMuted: true,
    error: null,
  })

  // ── Sync external paused prop changes ──────────────────────────────────────
  // If the consumer controls `paused` from outside (e.g. <VideoPlayer paused={x} />),
  // keep internal state in sync.
  useEffect(() => {
    setState(prev => {
      if (prev.paused === initialPaused) return prev
      return { ...prev, paused: initialPaused }
    })
  }, [initialPaused])

  // ── Playback controls ──────────────────────────────────────────────────────
  // IMPORTANT: we update `paused` STATE (which flows as a prop to the native
  // component) rather than calling the imperative play()/pause() methods.
  // This avoids the race condition where a re-render resets the native state
  // because the prop still says paused=false but we called pause() imperatively.

  const play = useCallback(() => {
    setState(prev => ({ ...prev, paused: false }))
    if (typeof ref.current?.play === 'function') {
      ref.current.play()
    }
  }, [])

  const pause = useCallback(() => {
    setState(prev => ({ ...prev, paused: true }))
    if (typeof ref.current?.pause === 'function') {
      ref.current.pause()
    }
  }, [])

  const stop = useCallback(() => {
    setState(prev => ({ ...prev, paused: true, currentTime: 0, playbackState: 'idle' }))
    if (typeof ref.current?.stop === 'function') {
      ref.current.stop()
    }
  }, [])

  // ── Seek ───────────────────────────────────────────────────────────────────
  // Seek is always imperative (there's no "seekTo" prop on the native component)

  const seekTo = useCallback((seconds: number) => {
    if (typeof ref.current?.seekTo === 'function') {
      ref.current.seekTo(seconds)
    }
  }, [])

  const seekBy = useCallback((targetSeconds: number) => {
    // targetSeconds is already the absolute position (calculated by VideoControls)
    if (typeof ref.current?.seekTo === 'function') {
      ref.current.seekTo(targetSeconds)
    }
  }, [])

  // ── Volume ─────────────────────────────────────────────────────────────────

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setState(prev => ({ ...prev, volume: clamped, isMuted: clamped === 0 }))
  }, [])

  const toggleMute = useCallback(() => {
    setState(prev => ({ ...prev, isMuted: !prev.isMuted }))
  }, [])

  // ── Native callbacks ───────────────────────────────────────────────────────
  // These are wired to the native component's onXxx props

  const onStateChange = useCallback(
    (s: PlaybackState) =>
      setState(prev => {
        // Reconcile: if native says 'playing' but our paused flag is true
        // (user pressed pause mid-load), don't mark as playing in JS.
        // The native component will receive paused=true on next render and pause.
        if (s === 'playing' && prev.paused) return prev
        return { ...prev, playbackState: s }
      }),
    [],
  )

  const onProgress = useCallback(
    (e: ProgressEvent) =>
      setState(prev => ({
        ...prev,
        currentTime: e.currentTime,
        duration: e.duration,
      })),
    [],
  )

  const onBuffering = useCallback(
    (b: boolean) => setState(prev => ({ ...prev, isBuffering: b })),
    [],
  )

  const onError = useCallback(
    (e: { message: string }) =>
      setState(prev => ({ ...prev, error: e.message, playbackState: 'error' })),
    [],
  )

  const onEnd = useCallback(
    () => setState(prev => ({ ...prev, playbackState: 'ended', paused: true })),
    [],
  )

  const onReady = useCallback(() => setState(prev => ({ ...prev, playbackState: 'ready' })), [])

  const takeScreenshot = useCallback(async () => {
    if (typeof ref.current?.takeScreenshot === 'function') {
      return await ref.current.takeScreenshot()
    }
    throw new Error('Native method takeScreenshot not available')
  }, [])

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
    onReady,
  }
}
