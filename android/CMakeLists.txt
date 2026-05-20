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
