#include <jni.h>
#include <fbjni/fbjni.h>

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    // Initialization logic if needed
  });
}
