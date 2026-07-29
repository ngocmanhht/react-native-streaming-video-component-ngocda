package com.streamingvideongocda

import java.io.File

object SecurityUtils {
    /**
     * Sanitizes stream URLs by masking password credentials.
     * Example: rtsp://admin:123456@192.168.1.1:554 -> rtsp://admin:***@192.168.1.1:554
     */
    fun sanitizeUrl(url: String?): String {
        if (url.isNullOrEmpty()) return ""
        return try {
            url.replace(Regex("(://[^:]+:)[^@]+(@)"), "$1***$2")
        } catch (_: Exception) {
            "[REDACTED_URL]"
        }
    }

    /**
     * Prunes old snapshot files in cache directory to prevent disk storage leaks.
     * Removes files older than maxAgeMs (default 24h) or if total size exceeds maxSizeBytes (default 50MB).
     */
    fun pruneSnapshotCache(cacheDir: File, maxAgeMs: Long = 86_400_000L, maxSizeBytes: Long = 52_428_800L) {
        try {
            val snapshots = cacheDir.listFiles { _, name -> name.startsWith("snapshot_") } ?: return
            val now = System.currentTimeMillis()
            var totalSize = 0L

            // Sort newest first
            snapshots.sortByDescending { it.lastModified() }

            for (file in snapshots) {
                val age = now - file.lastModified()
                totalSize += file.length()
                if (age > maxAgeMs || totalSize > maxSizeBytes) {
                    file.delete()
                }
            }
        } catch (_: Exception) {}
    }
}
