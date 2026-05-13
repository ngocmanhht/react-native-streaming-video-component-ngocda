cmake_minimum_required(VERSION 3.10)

project(StreamingVideoComponentNgocda)

add_library(
        StreamingVideoComponentNgocda
        SHARED
        cpp-adapter.cpp
)

target_include_directories(
        StreamingVideoComponentNgocda
        PUBLIC
        .
)

# Nitrogen Autolinking
if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../nitrogen/generated/android/StreamingVideoComponentNgocda+autolinking.cmake")
    include("${CMAKE_CURRENT_SOURCE_DIR}/../../../nitrogen/generated/android/StreamingVideoComponentNgocda+autolinking.cmake")
endif()
