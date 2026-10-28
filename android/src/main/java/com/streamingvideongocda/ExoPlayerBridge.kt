package com.streamingvideongocda

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.io.File
import java.io.FileOutputStream
import androidx.media3.common.VideoSize
import com.margelo.nitro.com.streamingvideongocda.ResizeMode

class ExoPlayerBridge(private val context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private var player: ExoPlayer? = null
    private val textureView = TextureView(context)
    private var videoWidth: Int = 0
    private var videoHeight: Int = 0
    private var resizeMode: ResizeMode = ResizeMode.CONTAIN
    private var currentVolume: Float = 1f
    private var isMuted: Boolean = false
    var isLive: Boolean = false

    @Volatile
    private var cachedPositionMs: Long = 0L
    @Volatile
    private var cachedDurationMs: Long = -1L

    init {
        textureView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            applyScale()
        }
    }

    var onReady: ((duration: Long) -> Unit)? = null
    var onProgress: ((currentMs: Long, durationMs: Long) -> Unit)? = null
    var onBuffering: ((isBuffering: Boolean) -> Unit)? = null
    var onError: ((code: Int, message: String) -> Unit)? = null
    var onEnd: (() -> Unit)? = null
    var onFirstFrameRendered: (() -> Unit)? = null
    var hasRenderedVideoFrame: Boolean = false

    // Whether to loop playback
    var shouldRepeat: Boolean = false

    val view: TextureView get() = textureView

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let {
                val pos = it.currentPosition
                val dur = it.duration
                cachedPositionMs = pos
                cachedDurationMs = dur
                onProgress?.invoke(pos, dur)
                textureView.postDelayed(this, progressIntervalMs)
            }
        }
    }

    var progressIntervalMs: Long = 500L

    private fun ensurePlayerCreated(): ExoPlayer {
        var p = player
        if (p == null) {
            val loadControl = androidx.media3.exoplayer.DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    /* minBufferMs = */ 1000,
                    /* maxBufferMs = */ 5000,
                    /* bufferForPlaybackMs = */ 500,
                    /* bufferForPlaybackAfterRebufferMs = */ 1000
                )
                .setPrioritizeTimeOverSizeThresholds(true)
                .build()

            p = ExoPlayer.Builder(context)
                .setLooper(Looper.getMainLooper())
                .setLoadControl(loadControl)
                .build()
                .apply {
                    setVideoTextureView(textureView)
                    repeatMode = if (shouldRepeat) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                    addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            val currentExo = player ?: return
                            when (state) {
                                Player.STATE_READY -> {
                                    cachedDurationMs = currentExo.duration
                                    cachedPositionMs = currentExo.currentPosition
                                    onBuffering?.invoke(false)
                                    onReady?.invoke(currentExo.duration)
                                    // Start progress reporting only after ready
                                    textureView.removeCallbacks(progressRunnable)
                                    textureView.post(progressRunnable)
                                }
                                Player.STATE_BUFFERING -> onBuffering?.invoke(true)
                                Player.STATE_ENDED     -> {
                                    textureView.removeCallbacks(progressRunnable)
                                    onEnd?.invoke()
                                }
                                else -> {}
                            }
                        }
                        override fun onRenderedFirstFrame() {
                            hasRenderedVideoFrame = true
                            onFirstFrameRendered?.invoke()
                        }
                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            videoWidth = videoSize.width
                            videoHeight = videoSize.height
                            applyScale()
                        }
                        override fun onPlayerError(error: PlaybackException) {
                            textureView.removeCallbacks(progressRunnable)
                            onError?.invoke(error.errorCode, error.localizedMessage ?: "ExoPlayer error")
                        }
                    })
                }
            player = p
        }
        return p
    }

    fun load(url: String, headers: Map<String, String>? = null) {
        hasRenderedVideoFrame = false
        runOnMain {
            val p = ensurePlayerCreated()
            p.stop()
            p.clearMediaItems()

            val mediaItem = if (isLive) {
                val liveConfig = MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(2500L)
                    .setMinPlaybackSpeed(0.97f)
                    .setMaxPlaybackSpeed(1.03f)
                    .build()
                MediaItem.Builder()
                    .setUri(url)
                    .setLiveConfiguration(liveConfig)
                    .build()
            } else {
                MediaItem.fromUri(url)
            }
            if (headers != null && headers.isNotEmpty()) {
                val dataSourceFactory = androidx.media3.datasource.DefaultHttpDataSource.Factory()
                    .setDefaultRequestProperties(headers)
                val mediaSource = androidx.media3.exoplayer.source.DefaultMediaSourceFactory(context)
                    .setDataSourceFactory(dataSourceFactory)
                    .createMediaSource(mediaItem)
                p.setMediaSource(mediaSource)
            } else {
                p.setMediaItem(mediaItem)
            }

            p.repeatMode = if (shouldRepeat) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
            p.volume = if (isMuted) 0f else currentVolume
            p.prepare()
            
            // Reset progress reporting callback on main thread
            textureView.removeCallbacks(progressRunnable)
            textureView.post(progressRunnable)
        }
    }

    fun play()  { runOnMain { player?.play() } }
    fun pause() { runOnMain { player?.pause() } }
    fun stop()  {
        runOnMain {
            textureView.removeCallbacks(progressRunnable)
            player?.stop()
        }
    }

    fun setVolume(volume: Float) {
        currentVolume = volume.coerceIn(0f, 1f)
        runOnMain { updatePlayerVolume() }
    }

    fun setMuted(muted: Boolean) {
        isMuted = muted
        runOnMain { updatePlayerVolume() }
    }

    private fun updatePlayerVolume() {
        player?.volume = if (isMuted) 0f else currentVolume
    }

    fun setRepeat(enabled: Boolean) {
        shouldRepeat = enabled
        runOnMain {
            player?.repeatMode = if (enabled) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
        }
    }

    fun seekTo(positionMs: Long, onDone: (Boolean) -> Unit) {
        cachedPositionMs = positionMs
        runOnMain {
            player?.seekTo(positionMs)
            onDone(true)
        }
    }

    val currentPositionMs: Long
        get() {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                return player?.currentPosition ?: cachedPositionMs
            }
            return cachedPositionMs
        }

    val durationMs: Long
        get() {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                return player?.duration ?: cachedDurationMs
            }
            return cachedDurationMs
        }

    fun takeScreenshot(callback: (String?) -> Unit) {
        runOnMain {
            if (textureView.width <= 0 || textureView.height <= 0) {
                callback(null)
                return@runOnMain
            }
            val bitmap = textureView.bitmap
            if (bitmap != null) {
                java.util.concurrent.Executors.newSingleThreadExecutor().execute {
                    val path = saveBitmap(bitmap)
                    Handler(Looper.getMainLooper()).post { callback(path) }
                }
            } else {
                callback(null)
            }
        }
    }

    private fun saveBitmap(bitmap: Bitmap): String? {
        SecurityUtils.pruneSnapshotCache(context.cacheDir)
        val file = File(context.cacheDir, "snapshot_${System.currentTimeMillis()}.jpg")
        return try {
            val out = FileOutputStream(file)
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            out.flush()
            out.close()
            bitmap.recycle()
            file.absolutePath
        } catch (e: Exception) {
            bitmap.recycle()
            null
        }
    }

    fun setResizeMode(mode: ResizeMode) {
        this.resizeMode = mode
        applyScale()
    }

    private fun applyScale() {
        val viewWidth = textureView.width
        val viewHeight = textureView.height
        if (viewWidth <= 0 || viewHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
            return
        }

        val matrix = android.graphics.Matrix()
        val viewRatio = viewWidth.toFloat() / viewHeight
        val videoRatio = videoWidth.toFloat() / videoHeight

        var scaleX = 1f
        var scaleY = 1f

        when (resizeMode) {
            ResizeMode.FILL -> {
                // Identity transform stretches to fill
            }
            ResizeMode.CONTAIN -> {
                if (videoRatio > viewRatio) {
                    scaleY = viewRatio / videoRatio
                } else {
                    scaleX = videoRatio / viewRatio
                }
            }
            ResizeMode.COVER -> {
                if (videoRatio > viewRatio) {
                    scaleX = videoRatio / viewRatio
                } else {
                    scaleY = viewRatio / videoRatio
                }
            }
        }

        val px = viewWidth / 2f
        val py = viewHeight / 2f
        matrix.postScale(scaleX, scaleY, px, py)

        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            textureView.setTransform(matrix)
            textureView.invalidate()
        } else {
            Handler(Looper.getMainLooper()).post {
                textureView.setTransform(matrix)
                textureView.invalidate()
            }
        }
    }

    fun release() {
        runOnMain {
            // Remove callbacks BEFORE releasing player to prevent use-after-free
            textureView.removeCallbacks(progressRunnable)
            player?.release()
            player = null
        }
    }
}
