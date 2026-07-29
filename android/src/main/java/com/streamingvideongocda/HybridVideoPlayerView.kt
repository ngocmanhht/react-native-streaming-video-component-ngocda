package com.streamingvideongocda

import android.util.Log
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactContext
import com.margelo.nitro.core.Promise
import org.videolan.libvlc.util.VLCVideoLayout
import com.margelo.nitro.com.streamingvideongocda.HybridVideoPlayerViewSpec
import com.margelo.nitro.com.streamingvideongocda.StreamProtocol
import com.margelo.nitro.com.streamingvideongocda.ResizeMode
import com.margelo.nitro.com.streamingvideongocda.PlaybackState
import com.margelo.nitro.com.streamingvideongocda.ReadyEvent
import com.margelo.nitro.com.streamingvideongocda.NaturalSize
import com.margelo.nitro.com.streamingvideongocda.ProgressEvent
import com.margelo.nitro.com.streamingvideongocda.ErrorEvent

private class LayoutForcingFrameLayout(context: android.content.Context) : FrameLayout(context) {
    override fun requestLayout() {
        super.requestLayout()
        // Fabric doesn't automatically layout dynamically added native children.
        // We force a measure/layout loop on the next UI frame to guarantee non-zero dimensions.
        post(measureAndLayoutRunnable)
    }

    private val measureAndLayoutRunnable = Runnable {
        measure(
            android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val w = right - left
        val h = bottom - top
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            child.measure(
                android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.EXACTLY)
            )
            child.layout(0, 0, w, h)
        }
    }
}

class HybridVideoPlayerView(private val ctx: ReactContext)
    : HybridVideoPlayerViewSpec() {

    // ── Native view ──────────────────────────────────────────────────────────
    private val rootLayout = LayoutForcingFrameLayout(ctx)
    override val view: android.view.View get() = rootLayout

    // ── Abstract Properties Overrides ────────────────────────────────────────
    override var onReady: ((event: ReadyEvent) -> Unit)? = null
    override var onProgress: ((event: ProgressEvent) -> Unit)? = null
    override var onBuffering: ((isBuffering: Boolean) -> Unit)? = null
    override var onStateChange: ((state: PlaybackState) -> Unit)? = null
    override var onError: ((event: ErrorEvent) -> Unit)? = null
    override var onEnd: (() -> Unit)? = null

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

    // Exponential backoff reconnect
    private var retryCount = 0
    private val maxRetries = 5
    private val reconnectHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val reconnectRunnable = Runnable {
        if (!paused && !url.isEmpty()) {
            onStateChange?.invoke(PlaybackState.RECONNECTING)
            reloadPlayer()
        }
    }

    override var url: String = ""
        set(value) {
            Log.d("StreamingVideo", "setUrl: ${SecurityUtils.sanitizeUrl(value)}")
            if (value == field || value.isEmpty()) return
            field = value
            retryCount = 0
            reconnectHandler.removeCallbacks(reconnectRunnable)
            reloadPlayer()
        }

    override var streamProtocol: StreamProtocol = StreamProtocol.HLS
        set(value) {
            Log.d("StreamingVideo", "setStreamProtocol: $value")
            if (value == field) return
            field = value
            retryCount = 0
            reconnectHandler.removeCallbacks(reconnectRunnable)
            reloadPlayer()
        }

    override var paused: Boolean = false
        set(value) {
            if (value == field) return
            field = value
            if (value) {
                reconnectHandler.removeCallbacks(reconnectRunnable)
                activePause()
            } else {
                activePlay()
            }
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

    override var isLive: Boolean = false
        set(value) {
            if (value == field) return
            field = value
            reloadPlayer()
        }

    // ── Player lifecycle ─────────────────────────────────────────────────────

    private fun reloadPlayer() {
        if (url.isEmpty()) return
        
        var detectedProtocol = streamProtocol
        val lowerUrl = url.lowercase()
        if (lowerUrl.startsWith("rtsp://")) {
            detectedProtocol = StreamProtocol.RTSP
        } else if (lowerUrl.startsWith("rtmp://") || lowerUrl.startsWith("rtmps://")) {
            detectedProtocol = StreamProtocol.RTMP
        } else if (lowerUrl.contains(".m3u8")) {
            detectedProtocol = StreamProtocol.HLS
        } else if (lowerUrl.contains(".mp4")) {
            detectedProtocol = StreamProtocol.MP4
        }
        
        Log.d("StreamingVideo", "reloadPlayer: url=${SecurityUtils.sanitizeUrl(url)}, requested=$streamProtocol, detected=$detectedProtocol")
        activeProtocol = detectedProtocol
        useVlcFallback = false
        onStateChange?.invoke(PlaybackState.LOADING)

        when (activeProtocol) {
            StreamProtocol.HLS, StreamProtocol.MP4 -> loadExo()
            StreamProtocol.RTSP, StreamProtocol.RTMP -> {
                Log.d("StreamingVideo", "reloadPlayer: Live stream ($activeProtocol) detected, loading VLC directly")
                useVlcFallback = true
                loadVlc()
            }
        }
    }

    private fun scheduleReconnect() {
        if (paused || retryCount >= maxRetries) {
            Log.e("StreamingVideo", "Max reconnect retries ($maxRetries) reached or player is paused.")
            onStateChange?.invoke(PlaybackState.ERROR)
            return
        }
        retryCount++
        val delayMs = (1000L * (1 shl (retryCount - 1))).coerceAtMost(10000L) // 1s, 2s, 4s, 8s, 10s
        Log.d("StreamingVideo", "Scheduling reconnect retry #$retryCount in ${delayMs}ms")
        onStateChange?.invoke(PlaybackState.RECONNECTING)
        reconnectHandler.removeCallbacks(reconnectRunnable)
        reconnectHandler.postDelayed(reconnectRunnable, delayMs)
    }

    private fun loadExo() {
        Log.d("StreamingVideo", "loadExo: url=$url")
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
        rootLayout.requestLayout()
        exo.isLive = isLive
        exo.load(url)
        exo.setResizeMode(resizeMode)
        if (!paused) {
            Log.d("StreamingVideo", "loadExo -> calling exo.play() immediately")
            exo.play()
        }
    }

    private fun loadVlc() {
        Log.d("StreamingVideo", "loadVlc: url=$url")
        // Stop ExoPlayer and clear its view before switching
        exo.stop()
        rootLayout.removeAllViews()
        val vlcLayout = VLCVideoLayout(ctx)
        vlcLayout.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            val w = vlcLayout.width
            val h = vlcLayout.height
            if (w > 0 && h > 0) {
                for (i in 0 until vlcLayout.childCount) {
                    val child = vlcLayout.getChildAt(i)
                    child.post {
                        child.measure(
                            android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
                            android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.EXACTLY)
                        )
                        child.layout(0, 0, w, h)
                    }
                }
            }
        }
        rootLayout.addView(
            vlcLayout,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        rootLayout.requestLayout()
        vlc.attachSurface(vlcLayout)
        vlc.load(url)
        if (!paused) {
            Log.d("StreamingVideo", "loadVlc -> scheduling vlc.play() with 100ms delay on Main Looper")
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                vlc.play()
            }, 100)
        }
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
        exo.setResizeMode(resizeMode)
    }

    // ── Methods ──────────────────────────────────────────────────────────────

    override fun play()  { paused = false }
    override fun pause() { paused = true }
    override fun stop()  {
        exo.stop()
        vlc.stop()
        onStateChange?.invoke(PlaybackState.IDLE)
    }

    override fun seekTo(positionSeconds: Double): Promise<Unit> {
        val promise = Promise<Unit>()
        val ms = (positionSeconds * 1000).toLong()
        if (useVlcFallback) {
            vlc.seekTo(ms) { success ->
                if (success) promise.resolve(Unit)
                else promise.reject(Exception("VLC seek failed: stream not seekable"))
            }
        } else {
            exo.seekTo(ms) { 
                promise.resolve(Unit)
            }
        }
        return promise
    }

    override fun getCurrentTime(): Promise<Double> {
        val ms = if (useVlcFallback) vlc.currentPositionMs else exo.currentPositionMs
        return Promise.resolved(ms / 1000.0)
    }

    override fun getDuration(): Promise<Double> {
        val ms = if (useVlcFallback) vlc.durationMs else exo.durationMs
        return Promise.resolved(if (ms < 0) -1.0 else ms / 1000.0)
    }

    override fun takeScreenshot(): Promise<String> {
        val promise = Promise<String>()
        if (useVlcFallback) {
            vlc.takeScreenshot(rootLayout) { path ->
                if (path != null) promise.resolve(path)
                else promise.reject(Exception("VLC capture failed"))
            }
        } else {
            exo.takeScreenshot { path ->
                if (path != null) promise.resolve(path)
                else promise.reject(Exception("ExoPlayer capture failed"))
            }
        }
        return promise
    }

    // AirPlay is iOS only
    override fun presentAirPlayPicker() {}

    // ── Bridge bindings ──────────────────────────────────────────────────────

    private fun bindExo() {
        exo.onReady = { dur ->
            Log.d("StreamingVideo", "ExoPlayer onReady: durationMs=$dur")
            onReady?.invoke(ReadyEvent(if (dur < 0) -1.0 else dur / 1000.0, NaturalSize(0.0, 0.0)))
            onStateChange?.invoke(PlaybackState.READY)
            // Async-safe auto-play: only play after ExoPlayer signals it is ready
            if (!paused) exo.play()
        }
        exo.onProgress = { cur, dur ->
            onProgress?.invoke(ProgressEvent(cur / 1000.0, if (dur < 0) -1.0 else dur / 1000.0, 0.0))
        }
        exo.onBuffering = { b ->
            Log.d("StreamingVideo", "ExoPlayer onBuffering: $b")
            onBuffering?.invoke(b)
            if (b) {
                onStateChange?.invoke(PlaybackState.BUFFERING)
            } else {
                onStateChange?.invoke(if (paused) PlaybackState.PAUSED else PlaybackState.PLAYING)
            }
        }
        exo.onEnd = {
            Log.d("StreamingVideo", "ExoPlayer onEnd")
            if (shouldRepeat) {
                exo.seekTo(0) {}
                exo.play()
            } else {
                onEnd?.invoke()
                onStateChange?.invoke(PlaybackState.ENDED)
            }
        }
        exo.onError = { code, msg ->
            Log.e("StreamingVideo", "ExoPlayer onError: code=$code, msg=$msg")
            // If HLS or MP4 fails on ExoPlayer, fall back to VLC
            if ((activeProtocol == StreamProtocol.HLS || activeProtocol == StreamProtocol.MP4) && !useVlcFallback) {
                Log.d("StreamingVideo", "ExoPlayer failed -> falling back to VLC")
                useVlcFallback = true
                loadVlc()
            } else {
                onError?.invoke(ErrorEvent(code.toDouble(), msg, activeProtocol, null, false))
                onStateChange?.invoke(PlaybackState.ERROR)
            }
        }
    }

    private fun bindVlc() {
        vlc.onReady = { dur ->
            Log.d("StreamingVideo", "VlcPlayer onReady: durationMs=$dur")
            onReady?.invoke(ReadyEvent(if (dur < 0) -1.0 else dur / 1000.0, NaturalSize(0.0, 0.0)))
            onStateChange?.invoke(PlaybackState.READY)
            // Async-safe auto-play
            if (!paused) vlc.play()
        }
        vlc.onProgress = { cur, dur ->
            onProgress?.invoke(ProgressEvent(cur / 1000.0, if (dur < 0) -1.0 else dur / 1000.0, 0.0))
        }
        vlc.onBuffering = { b ->
            Log.d("StreamingVideo", "VlcPlayer onBuffering: $b")
            onBuffering?.invoke(b)
            if (b) {
                onStateChange?.invoke(PlaybackState.BUFFERING)
            } else {
                onStateChange?.invoke(if (paused) PlaybackState.PAUSED else PlaybackState.PLAYING)
            }
        }
        vlc.onEnd = {
            Log.d("StreamingVideo", "VlcPlayer onEnd")
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
            Log.e("StreamingVideo", "VlcPlayer onError: msg=$msg")
            onError?.invoke(ErrorEvent(-1.0, msg, activeProtocol, null, true))
            if (activeProtocol == StreamProtocol.RTSP || activeProtocol == StreamProtocol.RTMP) {
                scheduleReconnect()
            } else {
                onStateChange?.invoke(PlaybackState.ERROR)
            }
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onDropView() {
        super.onDropView()
        reconnectHandler.removeCallbacks(reconnectRunnable)
        // Release in correct order to prevent JNI crash:
        // 1. Stop playback first
        // 2. Release ExoPlayer (releases codec + surface)
        // 3. Release LibVLC player + context (releases native decode threads)
        exo.release()
        vlc.release()
        rootLayout.removeAllViews()
    }
}
