package com.streamingvideongocda

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class VideoNgocDaPackage : ReactPackage {
    init {
        com.margelo.nitro.com.streamingvideongocda.StreamingVideoComponentNgocdaOnLoad.initializeNative()
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return emptyList()
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return listOf(com.margelo.nitro.com.streamingvideongocda.views.HybridVideoPlayerViewManager())
    }
}
