package com.streamingvideongocda

import android.widget.FrameLayout
import com.facebook.react.bridge.ReactApplicationContext
import com.margelo.nitro.core.Promise
import com.videolan.libvlc.util.VLCVideoLayout
import com.streamingvideongocda.generated.HybridVideoPlayerViewSpec
import com.streamingvideongocda.generated.StreamProtocol
import com.streamingvideongocda.generated.ResizeMode
import com.streamingvideongocda.generated.PlaybackState
import com.streamingvideongocda.generated.ReadyEvent
import com.streamingvideongocda.generated.NaturalSize
import com.streamingvideongocda.generated.ProgressEvent
import com.streamingvideongocda.generated.ErrorEvent

class HybridVideoPlayerView(private val ctx: ReactApplicationContext)
    : HybridVideoPlayerViewSpec() {

    // ── Native view ──────────────────────────────────────────────────────────
    private val rootLayout = FrameLayout(ctx)
    override val view: android.view.View get() = rootLayout

    // ── Bridges ──────────────────────────────────────────────────────────────
    private val exo = ExoPlayerBridge(ctx)
    private val vlc = VlcPlayerBridge(ctx)
    private var activeProtocol: StreamProtocol = StreamProtocol.HLS

    // Whether VLC fallback was triggered for this RTSP session
    private var useVlcFallback = false
    // Most IP cameras don't support RTSP PAUSE; they just disconnect.
    // We set this to true when paused on RTSP so play() reloads the URL.
    private var vlcNeedsReconnect = false

    init {
        bindExo()
        bindVlc()
    }

    // ── Props ────────────────────────────────────────────────────────────────

    override var url: String = ""
        set(value) {
            if (value == field || value.isEmpty()) return
            field = value
            reloadPlayer()
        }

    override var streamProtocol: StreamProtocol = StreamProtocol.HLS
        set(value) {
            if (value == field) return
            field = value
            reloadPlayer()
        }

    override var paused: Boolean = false
        set(value) {
            if (value == field) return
            field = value
            if (value) activePause() else activePlay()
        }

    override var volume: Double = 1.0
        set(value) {
            field = value
            val clamped = value.coerceIn(0.0, 1.0).toFloat()
            exo.setVolume(clamped)
            vlc.setVolume((clamped * 200).toInt()) // VLC uses 0-200
        }

    override var muted: Boolean = false
        set(value) {
            field = value
            exo.setMuted(value)
            vlc.setMuted(value)
        }

    override var shouldRepeat: Boolean = false
        set(value) {
            field = value
            exo.setRepeat(value)
            // VLC repeat is handled in VlcPlayerBridge.onEnd
        }

    override var progressInterval: Double = 500.0
        set(value) {
            field = value
            exo.progressIntervalMs = value.toLong().coerceAtLeast(100)
        }

    override var resizeMode: ResizeMode = ResizeMode.CONTAIN
        set(value) {
            field = value
            applyResizeMode()
        }

    override var zoomEnabled: Boolean = false

    // ── Player lifecycle ─────────────────────────────────────────────────────

    private fun reloadPlayer() {
        if (url.isEmpty()) return
        activeProtocol = streamProtocol
        useVlcFallback = false
        onStateChange?.invoke(PlaybackState.LOADING)

        when (activeProtocol) {
            StreamProtocol.HLS, StreamProtocol.MP4 -> loadExo()
            // For RTSP: try ExoPlayer first; VLC fallback fires from onError
            StreamProtocol.RTSP -> loadExo()
        }
    }

    private fun loadExo() {
        // Stop VLC and clear its view before switching
        vlc.stop()
        rootLayout.removeAllViews()
        rootLayout.addView(
            exo.view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        exo.load(url)
        // NOTE: play() is called inside bindExo.onReady (after async ready)
        // to avoid the "call play before player is ready" race condition
    }

    private fun loadVlc() {
        // Stop ExoPlayer and clear its view before switching
        exo.stop()
        rootLayout.removeAllViews()
        val vlcLayout = VLCVideoLayout(ctx)
        rootLayout.addView(
            vlcLayout,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        vlc.attachSurface(vlcLayout)
        vlc.load(url)
        // NOTE: play() is called inside bindVlc.onReady
    }

    private fun activePlay() {
        if (useVlcFallback) {
            if (vlcNeedsReconnect) {
                vlcNeedsReconnect = false
                vlc.load(url)
            }
            vlc.play()
        } else {
            exo.play()
        }
    }

    private fun activePause() {
        if (useVlcFallback) vlc.pause() else exo.pause()
    }

    private fun applyResizeMode() {
        // ExoPlayer resize is handled by the SurfaceView aspect ratio
        // For now, MATCH_PARENT covers all cases — can extend with AspectRatioFrameLayout later
    }

    // ── Methods ──────────────────────────────────────────────────────────────

    override fun play()  { paused = false }
    override fun pause() { paused = true }
    override fun stop()  {
        exo.stop()
        vlc.stop()
        onStateChange?.invoke(PlaybackState.IDLE)
    }

    override fun seekTo(positionSeconds: Double): Promise<Unit> = Promise.async {
        val ms = (positionSeconds * 1000).toLong()
        if (useVlcFallback) {
            vlc.seekTo(ms) { success ->
                if (!success) throw Exception("VLC seek failed: stream not seekable")
            }
        } else {
            exo.seekTo(ms) { /* ExoPlayer seek is always synchronous internally */ }
        }
    }

    override fun getCurrentTime(): Promise<Double> = Promise.async {
        val ms = if (useVlcFallback) vlc.currentPositionMs else exo.currentPositionMs
        ms / 1000.0
    }

    override fun getDuration(): Promise<Double> = Promise.async {
        val ms = if (useVlcFallback) vlc.durationMs else exo.durationMs
        if (ms < 0) -1.0 else ms / 1000.0
    }

    override fun takeScreenshot(): Promise<String> = Promise.async {
        if (useVlcFallback) {
            vlc.takeScreenshot { path ->
                if (path != null) it.resolve(path)
                else it.reject(Exception("VLC capture failed"))
            }
        } else {
            exo.takeScreenshot { path ->
                if (path != null) it.resolve(path)
                else it.reject(Exception("ExoPlayer capture failed"))
            }
        }
    }

    // AirPlay is iOS only
    override fun presentAirPlayPicker() {}

    // ── Bridge bindings ──────────────────────────────────────────────────────

    private fun bindExo() {
        exo.onReady = { dur ->
            onReady?.invoke(ReadyEvent(dur / 1000.0, NaturalSize(0.0, 0.0)))
            onStateChange?.invoke(PlaybackState.READY)
            // Async-safe auto-play: only play after ExoPlayer signals it is ready
            if (!paused) exo.play()
        }
        exo.onProgress = { cur, dur ->
            onProgress?.invoke(ProgressEvent(cur / 1000.0, if (dur < 0) -1.0 else dur / 1000.0, 0.0))
        }
        exo.onBuffering = { b ->
            onBuffering?.invoke(b)
            onStateChange?.invoke(if (b) PlaybackState.BUFFERING else PlaybackState.PLAYING)
        }
        exo.onEnd = {
            if (shouldRepeat) {
                exo.seekTo(0) {}
                exo.play()
            } else {
                onEnd?.invoke()
                onStateChange?.invoke(PlaybackState.ENDED)
            }
        }
        exo.onError = { code, msg ->
            // RTSP error on ExoPlayer → fall back to LibVLC (ExoPlayer doesn't support all RTSP codecs)
            if (activeProtocol == StreamProtocol.RTSP && !useVlcFallback) {
                useVlcFallback = true
                loadVlc()
            } else {
                onError?.invoke(ErrorEvent(code.toDouble(), msg, null))
                onStateChange?.invoke(PlaybackState.ERROR)
            }
        }
    }

    private fun bindVlc() {
        vlc.onReady = { dur ->
            onReady?.invoke(ReadyEvent(if (dur < 0) -1.0 else dur / 1000.0, NaturalSize(0.0, 0.0)))
            onStateChange?.invoke(PlaybackState.READY)
            // Async-safe auto-play
            if (!paused) vlc.play()
        }
        vlc.onProgress = { cur, dur ->
            onProgress?.invoke(ProgressEvent(cur / 1000.0, if (dur < 0) -1.0 else dur / 1000.0, 0.0))
        }
        vlc.onBuffering = { b ->
            onBuffering?.invoke(b)
            onStateChange?.invoke(if (b) PlaybackState.BUFFERING else PlaybackState.PLAYING)
        }
        vlc.onEnd = {
            if (activeProtocol == StreamProtocol.RTSP && paused) {
                vlcNeedsReconnect = true
            }
            if (shouldRepeat) {
                vlc.seekTo(0) {}
                vlc.play()
            } else {
                onEnd?.invoke()
                onStateChange?.invoke(PlaybackState.ENDED)
            }
        }
        vlc.onError = { _, msg ->
            onError?.invoke(ErrorEvent(-1.0, msg, null))
            onStateChange?.invoke(PlaybackState.ERROR)
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onDestroy() {
        super.onDestroy()
        // Release in correct order to prevent JNI crash:
        // 1. Stop playback first
        // 2. Release ExoPlayer (releases codec + surface)
        // 3. Release LibVLC player + context (releases native decode threads)
        exo.release()
        vlc.release()
        rootLayout.removeAllViews()
    }
}
