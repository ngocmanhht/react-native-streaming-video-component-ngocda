package com.streamingvideongocda

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.io.File
import java.io.FileOutputStream

class ExoPlayerBridge(private val context: Context) {

    private var player: ExoPlayer? = null
    private val surfaceView = SurfaceView(context)

    var onReady: ((duration: Long) -> Unit)? = null
    var onProgress: ((currentMs: Long, durationMs: Long) -> Unit)? = null
    var onBuffering: ((isBuffering: Boolean) -> Unit)? = null
    var onError: ((code: Int, message: String) -> Unit)? = null
    var onEnd: (() -> Unit)? = null

    // Whether to loop playback
    var shouldRepeat: Boolean = false

    val view: SurfaceView get() = surfaceView

    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let {
                onProgress?.invoke(it.currentPosition, it.duration)
                surfaceView.postDelayed(this, progressIntervalMs)
            }
        }
    }

    var progressIntervalMs: Long = 500L

    fun load(url: String) {
        // Full release before reload to prevent native decoder leak
        release()
        player = ExoPlayer.Builder(context).build().also { exo ->
            exo.setVideoSurfaceView(surfaceView)
            exo.repeatMode = if (shouldRepeat) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
            exo.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_READY -> {
                            onBuffering?.invoke(false)
                            onReady?.invoke(exo.duration)
                            // Start progress reporting only after ready
                            surfaceView.removeCallbacks(progressRunnable)
                            surfaceView.post(progressRunnable)
                        }
                        Player.STATE_BUFFERING -> onBuffering?.invoke(true)
                        Player.STATE_ENDED     -> {
                            surfaceView.removeCallbacks(progressRunnable)
                            onEnd?.invoke()
                        }
                        else -> {}
                    }
                }
                override fun onPlayerError(error: PlaybackException) {
                    surfaceView.removeCallbacks(progressRunnable)
                    onError?.invoke(error.errorCode, error.localizedMessage ?: "ExoPlayer error")
                }
            })
            exo.setMediaItem(MediaItem.fromUri(url))
            exo.prepare()
            // NOTE: Do NOT call play() here – caller (HybridVideoPlayerView) handles it
            // after onReady fires to avoid async race condition
        }
    }

    fun play()  { player?.play() }
    fun pause() { player?.pause() }
    fun stop()  {
        surfaceView.removeCallbacks(progressRunnable)
        player?.stop()
    }

    fun setVolume(volume: Float) { player?.volume = volume.coerceIn(0f, 1f) }
    fun setMuted(muted: Boolean) { player?.volume = if (muted) 0f else 1f }

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
        if (surfaceView.width <= 0 || surfaceView.height <= 0) {
            callback(null)
            return
        }
        val bitmap = Bitmap.createBitmap(surfaceView.width, surfaceView.height, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(surfaceView, bitmap, { result ->
                if (result == PixelCopy.SUCCESS) {
                    val path = saveBitmap(bitmap)
                    callback(path)
                } else {
                    callback(null)
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: Exception) {
            callback(null)
        }
    }

    private fun saveBitmap(bitmap: Bitmap): String? {
        val file = File(context.cacheDir, "snapshot_${System.currentTimeMillis()}.jpg")
        return try {
            val out = FileOutputStream(file)
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            out.flush()
            out.close()
            file.absolutePath
        } catch (e: Exception) {
            null
        }
    }

    fun release() {
        // Remove callbacks BEFORE releasing player to prevent use-after-free
        surfaceView.removeCallbacks(progressRunnable)
        player?.release()
        player = null
    }
}
