package com.streamingvideongocda

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import java.io.File

class VlcPlayerBridge(private val context: Context) {

    // LibVLC holds a native thread pool + decode context per instance.
    // MEMORY LEAK: if not released, each new instance leaks ~30-80 MB of native memory.
    // Strategy: create LibVLC once, reuse it across load() calls.
    private val libVLC: LibVLC = LibVLC(context, arrayListOf(
        "--rtsp-tcp",             // Force TCP for RTSP (more reliable over NAT/firewall)
        "--network-caching=300",  // 300ms network buffer (low latency for CCTV)
        "--no-drop-late-frames",  // Don't drop frames → smooth playback
        "--no-skip-frames",       // Don't skip frames
        "--clock-jitter=0",       // Disable jitter compensation for live streams
        "--clock-synchro=0",      // Disable A/V resync (live streams don't have timestamps)
    ))

    // Single MediaPlayer instance, reused across load() calls
    private val player = MediaPlayer(libVLC)

    var onReady: ((duration: Long) -> Unit)? = null
    var onProgress: ((currentMs: Long, durationMs: Long) -> Unit)? = null
    var onBuffering: ((isBuffering: Boolean) -> Unit)? = null
    var onError: ((code: Int, message: String) -> Unit)? = null
    var onEnd: (() -> Unit)? = null

    init {
        player.setEventListener { event ->
            when (event.type) {
                MediaPlayer.Event.Opening   -> onBuffering?.invoke(true)
                MediaPlayer.Event.Playing   -> {
                    onBuffering?.invoke(false)
                    onReady?.invoke(player.length)
                }
                MediaPlayer.Event.Buffering -> onBuffering?.invoke(event.buffering < 100f)
                MediaPlayer.Event.TimeChanged -> onProgress?.invoke(player.time, player.length)
                MediaPlayer.Event.EncounteredError -> onError?.invoke(-1, "LibVLC stream error")
                MediaPlayer.Event.EndReached -> onEnd?.invoke()
                MediaPlayer.Event.Stopped -> { /* noop – we trigger stop explicitly */ }
            }
        }
    }

    fun attachSurface(vlcVideoLayout: VLCVideoLayout) {
        player.attachViews(vlcVideoLayout, null, false, false)
    }

    fun load(url: String) {
        // Stop the current stream FIRST – this frees native codec buffers
        // Without this, each load() call leaks the previous Media object's memory
        if (player.isPlaying) player.stop()

        val media = Media(libVLC, Uri.parse(url)).apply {
            addOption(":rtsp-tcp")
            addOption(":clock-jitter=0")
            addOption(":clock-synchro=0")
            addOption(":network-caching=300")
        }
        player.media = media
        // IMPORTANT: Release our Java reference so the player holds the only strong ref.
        // Without this, the Media object is kept alive causing a ~20MB leak per stream.
        media.release()
    }

    fun play()  { player.play() }
    fun pause() { player.pause() }
    fun stop()  { player.stop() }

    fun setMuted(muted: Boolean) { player.volume = if (muted) 0 else 100 }
    fun setVolume(volume: Int) { player.volume = volume.coerceIn(0, 200) }

    fun seekTo(positionMs: Long, onDone: (Boolean) -> Unit) {
        if (!player.isSeekable) { onDone(false); return }
        player.time = positionMs
        onDone(true)
    }

    val currentPositionMs: Long get() = player.time
    val durationMs: Long get() = player.length

    // ── Screenshot ───────────────────────────────────────────────────────────

    fun takeScreenshot(callback: (String?) -> Unit) {
        val file = File(context.cacheDir, "snapshot_${System.currentTimeMillis()}.jpg")
        val path = file.absolutePath
        if (player.takeSnapShot(0, path, 0, 0)) {
            // VLC snapshot is asynchronous. Wait a short bit for the file to be written.
            Handler(Looper.getMainLooper()).postDelayed({
                if (file.exists()) callback(path) else callback(null)
            }, 150)
        } else {
            callback(null)
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
            libVLC.release()
        } catch (_: Exception) {}
    }
}
