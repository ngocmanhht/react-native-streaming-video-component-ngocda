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

    private var player: ExoPlayer? = null
    private val textureView = TextureView(context)
    private var videoWidth: Int = 0
    private var videoHeight: Int = 0
    private var resizeMode: ResizeMode = ResizeMode.CONTAIN
    private var currentVolume: Float = 1f
    private var isMuted: Boolean = false
    var isLive: Boolean = false

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

    // Whether to loop playback
    var shouldRepeat: Boolean = false

    val view: TextureView get() = textureView

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let {
                onProgress?.invoke(it.currentPosition, it.duration)
                textureView.postDelayed(this, progressIntervalMs)
            }
        }
    }

    var progressIntervalMs: Long = 500L

    private fun ensurePlayerCreated(): ExoPlayer {
        var p = player
        if (p == null) {
            p = ExoPlayer.Builder(context).build().apply {
                setVideoTextureView(textureView)
                repeatMode = if (shouldRepeat) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(state: Int) {
                        val currentExo = player ?: return
                        when (state) {
                            Player.STATE_READY -> {
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

    fun load(url: String) {
        val p = ensurePlayerCreated()
        p.stop()
        p.clearMediaItems()

        val mediaItem = MediaItem.fromUri(url)

        p.setMediaItem(mediaItem)
        p.repeatMode = if (shouldRepeat) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
        p.volume = if (isMuted) 0f else currentVolume
        p.prepare()
        
        // Reset progress reporting callback on main thread
        textureView.removeCallbacks(progressRunnable)
        textureView.post(progressRunnable)
    }

    fun play()  { player?.play() }
    fun pause() { player?.pause() }
    fun stop()  {
        textureView.removeCallbacks(progressRunnable)
        player?.stop()
    }

    fun setVolume(volume: Float) {
        currentVolume = volume.coerceIn(0f, 1f)
        updatePlayerVolume()
    }

    fun setMuted(muted: Boolean) {
        isMuted = muted
        updatePlayerVolume()
    }

    private fun updatePlayerVolume() {
        player?.volume = if (isMuted) 0f else currentVolume
    }

    fun setRepeat(enabled: Boolean) {
        shouldRepeat = enabled
        player?.repeatMode = if (enabled) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
    }

    fun seekTo(positionMs: Long, onDone: (Boolean) -> Unit) {
        player?.seekTo(positionMs)
        onDone(true)
    }

    val currentPositionMs: Long get() = player?.currentPosition ?: 0L
    val durationMs: Long get() = player?.duration ?: -1L

    // ── Screenshot ───────────────────────────────────────────────────────────

    fun takeScreenshot(callback: (String?) -> Unit) {
        if (textureView.width <= 0 || textureView.height <= 0) {
            callback(null)
            return
        }
        val bitmap = textureView.bitmap
        if (bitmap != null) {
            val path = saveBitmap(bitmap)
            callback(path)
        } else {
            callback(null)
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
        // Remove callbacks BEFORE releasing player to prevent use-after-free
        textureView.removeCallbacks(progressRunnable)
        player?.release()
        player = null
    }
}
