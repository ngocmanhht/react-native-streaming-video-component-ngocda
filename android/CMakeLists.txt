cmake_minimum_required(VERSION 3.10)

project(StreamingVideoComponentNgocda)

set(CMAKE_CXX_STANDARD 20)

# Find FBJNI and ReactAndroid using CMake CONFIG mode to resolve Prefab packages correctly
find_package(fbjni REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

add_library(
        StreamingVideoComponentNgocda
        SHARED
        src/main/cpp/cpp-adapter.cpp
)

target_include_directories(
        StreamingVideoComponentNgocda
        PUBLIC
        src/main/cpp
)

# Nitrogen Autolinking
if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/StreamingVideoComponentNgocda+autolinking.cmake")
    include("${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/StreamingVideoComponentNgocda+autolinking.cmake")
endif()

# Fallback: if react-native-nitro-modules::NitroModules was generated as an INTERFACE library without .so
if(TARGET react-native-nitro-modules::NitroModules)
  get_target_property(NITRO_TYPE react-native-nitro-modules::NitroModules TYPE)
  if(NITRO_TYPE STREQUAL "INTERFACE_LIBRARY")
    message(STATUS "[StreamingVideoComponentNgocda] NitroModules is INTERFACE library, looking for libNitroModules.so fallback...")
    file(GLOB_RECURSE NITRO_SO
      "${CMAKE_SOURCE_DIR}/../../react-native-nitro-modules/android/build/**/${ANDROID_ABI}/libNitroModules.so"
    )
    if(NITRO_SO)
      list(GET NITRO_SO 0 NITRO_SO_FILE)
      message(STATUS "[StreamingVideoComponentNgocda] Found and linking libNitroModules.so: ${NITRO_SO_FILE}")
      target_link_libraries(StreamingVideoComponentNgocda ${NITRO_SO_FILE})
    endif()
  endif()
endif()

