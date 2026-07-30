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

    // SecurityUtils.kt
fun encodeRtspUrl(rawUrl: String?): String {
    if (rawUrl.isNullOrEmpty() || !rawUrl.startsWith("rtsp://", ignoreCase = true)) {
        return rawUrl ?: ""
    }
    try {
        val scheme = "rtsp://"
        val rest = rawUrl.substring(scheme.length)
        val pathIndex = rest.indexOf('/').let { if (it == -1) rest.length else it }
        val authority = rest.substring(0, pathIndex)
        val pathAndQuery = rest.substring(pathIndex)

        // Tìm vị trí '@' CUỐI CÙNG trong authority để tách userInfo và host:port
        val lastAtIndex = authority.lastIndexOf('@')
        if (lastAtIndex == -1) return rawUrl // Không có thông tin auth

        val userInfo = authority.substring(0, lastAtIndex)
        val hostPort = authority.substring(lastAtIndex + 1)

        val colonIndex = userInfo.indexOf(':')
        val (username, password) = if (colonIndex != -1) {
            userInfo.substring(0, colonIndex) to userInfo.substring(colonIndex + 1)
        } else {
            userInfo to ""
        }

        // Encode riêng biệt username và password
        val encodedUser = java.net.URLEncoder.encode(username, "UTF-8").replace("+", "%20")
        val encodedPass = java.net.URLEncoder.encode(password, "UTF-8").replace("+", "%20")

        val newAuth = if (encodedPass.isNotEmpty()) "$encodedUser:$encodedPass@$hostPort" else "$encodedUser@$hostPort"
        return "$scheme$newAuth$pathAndQuery"
    } catch (_: Exception) {
        return rawUrl
    }
}
}
