#include <jni.h>
#include <fbjni/fbjni.h>
#include "StreamingVideoComponentNgocdaOnLoad.hpp"

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    // register all StreamingVideoComponentNgocda HybridObjects
    margelo::nitro::streamingvideo::registerAllNatives();
  });
}
