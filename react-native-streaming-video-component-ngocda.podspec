require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-streaming-video-component-ngocda"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/ngocda/react-native-streaming-video-component-ngocda.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"
  s.dependency "NitroModules"
  s.dependency "MobileVLCKit", "~> 3.5"

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_ROOT)/boost\"",
      "\"$(PODS_ROOT)/Headers/Public/Yoga\"",
      "\"$(PODS_ROOT)/Headers/Public/react-native-nitro-modules\"",
      "\"$(PODS_ROOT)/Headers/Public/React-Core\"",
      "\"$(PODS_ROOT)/Headers/Private/yoga\"",
      "\"$(PODS_ROOT)/Headers/Public/React-Fabric\"",
      "\"$(PODS_ROOT)/Headers/Public/React-graphics\"",
      "\"$(PODS_ROOT)/Headers/Public/React-graphics/react/renderer/graphics/platform/ios\""
    ].join(' '),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
  }

  # Nitrogen autolinking
  if File.exist?(File.join(__dir__, "nitrogen/generated/ios/react_native_streaming_video_component_ngocda+autolinking.rb"))
    load File.join(__dir__, "nitrogen/generated/ios/react_native_streaming_video_component_ngocda+autolinking.rb")
    add_nitrogen_files(s)
  end
end
