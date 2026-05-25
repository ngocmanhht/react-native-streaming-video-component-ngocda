package com.streamingvideongocda

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Bitmap
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.ViewGroup
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import android.view.TextureView
import android.graphics.Rect
import android.app.Activity
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import com.facebook.react.bridge.ReactContext

class VlcPlayerBridge(private val context: Context) {

    // LibVLC holds a native thread pool + decode context per instance.
    // MEMORY LEAK: if not released, each new instance leaks ~30-80 MB of native memory.
    // Strategy: create LibVLC once, reuse it across load() calls.
    private val libVLC: LibVLC = LibVLC(context, arrayListOf(
        "-vvv",                   // Enable native verbose debug logging (writes directly to logcat!)
        "--rtsp-tcp",             // Force TCP for RTSP (more reliable over NAT/firewall)
    ))

    // Single MediaPlayer instance, reused across load() calls
    private val player = MediaPlayer(libVLC)

    // Strong reference to current Media object to prevent JVM garbage collection finalization
    // from prematurely freeing the native JNI Media pointer during async loading.
    private var currentMedia: Media? = null
    private var currentVolume: Int = 100
    private var isMuted: Boolean = false

    var onReady: ((duration: Long) -> Unit)? = null
    var onProgress: ((currentMs: Long, durationMs: Long) -> Unit)? = null
    var onBuffering: ((isBuffering: Boolean) -> Unit)? = null
    var onError: ((code: Int, message: String) -> Unit)? = null
    var onEnd: (() -> Unit)? = null

    init {
        val handler = Handler(Looper.getMainLooper())
        player.setEventListener { event ->
            handler.post {
                when (event.type) {
                    MediaPlayer.Event.Opening   -> {
                        Log.d("StreamingVideo", "VLC Event: Opening")
                        onBuffering?.invoke(true)
                    }
                    MediaPlayer.Event.Playing   -> {
                        Log.d("StreamingVideo", "VLC Event: Playing, length=${player.length}")
                        onBuffering?.invoke(false)
                        onReady?.invoke(player.length)
                    }
                    MediaPlayer.Event.Buffering -> {
                        Log.d("StreamingVideo", "VLC Event: Buffering ${event.buffering}%")
                        onBuffering?.invoke(event.buffering < 100f)
                    }
                    MediaPlayer.Event.TimeChanged -> {
                        onProgress?.invoke(player.time, player.length)
                    }
                    MediaPlayer.Event.EncounteredError -> {
                        Log.e("StreamingVideo", "VLC Event: EncounteredError")
                        onError?.invoke(-1, "LibVLC stream error")
                    }
                    MediaPlayer.Event.EndReached -> {
                        Log.d("StreamingVideo", "VLC Event: EndReached")
                        onEnd?.invoke()
                    }
                    MediaPlayer.Event.Stopped -> {
                        Log.d("StreamingVideo", "VLC Event: Stopped")
                    }
                }
            }
        }
    }

    fun attachSurface(vlcVideoLayout: VLCVideoLayout) {
        Log.d("StreamingVideo", "VlcPlayerBridge: attachSurface called")
        try {
            player.detachViews()
        } catch (_: Exception) {}
        player.attachViews(vlcVideoLayout, null, true, true)
    }

    fun load(url: String) {
        Log.d("StreamingVideo", "VlcPlayerBridge: load called with url=$url")
        if (player.isPlaying) {
            Log.d("StreamingVideo", "VlcPlayerBridge: player was playing, stopping first")
            player.stop()
        }

        try {
            currentMedia?.release()
        } catch (_: Exception) {}

        val media = Media(libVLC, Uri.parse(url)).apply {
            addOption("rtsp-tcp")
            addOption(":rtsp-tcp")
        }
        currentMedia = media
        player.media = media
    }

    fun play() {
        Log.d("StreamingVideo", "VlcPlayerBridge: play() called")
        player.play()
    }
    fun pause() {
        Log.d("StreamingVideo", "VlcPlayerBridge: pause() called")
        player.pause()
    }
    fun stop() {
        Log.d("StreamingVideo", "VlcPlayerBridge: stop() called")
        if (player.isPlaying) {
            player.stop()
        }
        try {
            player.detachViews()
        } catch (_: Exception) {}
    }

    fun setVolume(volume: Int) {
        currentVolume = volume.coerceIn(0, 200)
        updatePlayerVolume()
    }

    fun setMuted(muted: Boolean) {
        isMuted = muted
        updatePlayerVolume()
    }

    private fun updatePlayerVolume() {
        player.volume = if (isMuted) 0 else currentVolume
    }

    fun seekTo(positionMs: Long, onDone: (Boolean) -> Unit) {
        if (!player.isSeekable) { onDone(false); return }
        player.time = positionMs
        onDone(true)
    }

    val currentPositionMs: Long get() = player.time
    val durationMs: Long get() = player.length

    // ── Screenshot ───────────────────────────────────────────────────────────

    fun takeScreenshot(parentView: android.view.View, callback: (String?) -> Unit) {
        logViewHierarchy(parentView)

        // 1. Try to find a TextureView first (extremely common and synchronous to capture)
        val textureView = findTextureView(parentView)
        if (textureView != null) {
            Log.d("StreamingVideo", "VlcPlayerBridge: found TextureView, capturing bitmap synchronously")
            val bitmap = textureView.bitmap
            if (bitmap != null) {
                val path = saveBitmap(bitmap)
                callback(path)
                return
            }
        }

        // 2. Try to find a SurfaceView (like GLSurfaceView or standard SurfaceView)
        val surfaceView = findSurfaceView(parentView)
        if (surfaceView != null) {
            Log.d("StreamingVideo", "VlcPlayerBridge: found SurfaceView, capturing using PixelCopy")
            if (surfaceView.width <= 0 || surfaceView.height <= 0) {
                Log.e("StreamingVideo", "VlcPlayerBridge: takeScreenshot failed, SurfaceView dimensions are 0x0")
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
                        Log.e("StreamingVideo", "VlcPlayerBridge: PixelCopy request failed with code $result")
                        fallbackWindowCapture(parentView, callback)
                    }
                }, Handler(Looper.getMainLooper()))
            } catch (e: Exception) {
                Log.e("StreamingVideo", "VlcPlayerBridge: PixelCopy exception, trying fallback", e)
                fallbackWindowCapture(parentView, callback)
            }
            return
        }

        // 3. Fallback: capture from Window
        fallbackWindowCapture(parentView, callback)
    }

    private fun getActivity(view: android.view.View): Activity? {
        // ReactContext is NOT an Activity — need to use currentActivity
        val reactActivity = (context as? ReactContext)?.currentActivity
        if (reactActivity != null) return reactActivity
        // Fallback: try the view's context directly
        return (view.context as? Activity)
    }

    private fun fallbackWindowCapture(parentView: android.view.View, callback: (String?) -> Unit) {
        Log.d("StreamingVideo", "VlcPlayerBridge: falling back to Window capture")
        if (parentView.width <= 0 || parentView.height <= 0) {
            Log.e("StreamingVideo", "VlcPlayerBridge: fallback failed, parentView dimensions are 0x0")
            // Last resort: try drawing cache even though VLC renders on GPU surface
            captureViaDrawingCache(parentView, callback)
            return
        }

        val bitmap = Bitmap.createBitmap(parentView.width, parentView.height, Bitmap.Config.ARGB_8888)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val activity = getActivity(parentView)
                val window = activity?.window
                if (window != null) {
                    Log.d("StreamingVideo", "VlcPlayerBridge: got Activity window, requesting PixelCopy")
                    val location = IntArray(2)
                    parentView.getLocationInWindow(location)
                    val rect = Rect(
                        location[0], location[1],
                        location[0] + parentView.width, location[1] + parentView.height
                    )
                    Log.d("StreamingVideo", "VlcPlayerBridge: PixelCopy rect=$rect, size=${parentView.width}x${parentView.height}")
                    PixelCopy.request(window, rect, bitmap, { result ->
                        if (result == PixelCopy.SUCCESS) {
                            Log.d("StreamingVideo", "VlcPlayerBridge: Window PixelCopy SUCCESS")
                            val path = saveBitmap(bitmap)
                            callback(path)
                        } else {
                            Log.e("StreamingVideo", "VlcPlayerBridge: Window PixelCopy failed with code $result")
                            callback(null)
                        }
                    }, Handler(Looper.getMainLooper()))
                    return
                } else {
                    Log.e("StreamingVideo", "VlcPlayerBridge: cannot get Activity window (activity=$activity)")
                }
            }
        } catch (e: Exception) {
            Log.e("StreamingVideo", "VlcPlayerBridge: fallback Window capture exception", e)
        }
        callback(null)
    }

    private fun captureViaDrawingCache(view: android.view.View, callback: (String?) -> Unit) {
        Log.d("StreamingVideo", "VlcPlayerBridge: attempting drawing cache capture")
        try {
            view.isDrawingCacheEnabled = true
            view.buildDrawingCache(true)
            val cache = view.getDrawingCache(true)
            if (cache != null) {
                val copy = Bitmap.createBitmap(cache)
                view.isDrawingCacheEnabled = false
                val path = saveBitmap(copy)
                callback(path)
            } else {
                Log.e("StreamingVideo", "VlcPlayerBridge: drawing cache is null")
                view.isDrawingCacheEnabled = false
                callback(null)
            }
        } catch (e: Exception) {
            Log.e("StreamingVideo", "VlcPlayerBridge: drawing cache capture failed", e)
            callback(null)
        }
    }

    private fun findSurfaceView(view: android.view.View): SurfaceView? {
        if (view is SurfaceView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                val res = findSurfaceView(child)
                if (res != null) return res
            }
        }
        return null
    }

    private fun findTextureView(view: android.view.View): TextureView? {
        if (view is TextureView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                val res = findTextureView(child)
                if (res != null) return res
            }
        }
        return null
    }

    private fun logViewHierarchy(view: android.view.View, indent: String = "") {
        Log.d("StreamingVideo", "${indent}View: ${view.javaClass.name} [id=${view.id}, visible=${view.visibility == android.view.View.VISIBLE}]")
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                logViewHierarchy(view.getChildAt(i), "$indent  ")
            }
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
        // Order matters: stop player before releasing media player before releasing libVLC
        // Incorrect order causes JNI crash or native memory corruption
        try {
            if (player.isPlaying) player.stop()
            player.setEventListener(null) // Prevent callbacks during release
            player.release()
        } catch (_: Exception) {}
        try {
            currentMedia?.release()
            currentMedia = null
        } catch (_: Exception) {}
        try {
            libVLC.release()
        } catch (_: Exception) {}
    }
}
