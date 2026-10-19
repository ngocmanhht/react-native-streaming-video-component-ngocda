# LibVLC JNI reflection keep rules
-keep class org.videolan.libvlc.** { *; }
-keep interface org.videolan.libvlc.** { *; }
-dontwarn org.videolan.libvlc.**

# Nitro Modules JNI bindings
-keep class com.margelo.nitro.** { *; }
-keep interface com.margelo.nitro.** { *; }
-keep class com.streamingvideongocda.** { *; }
-dontwarn com.margelo.nitro.**

# Media3 / ExoPlayer
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# FBJNI
-keep class com.facebook.jni.** { *; }
