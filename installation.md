# Installation Guide

Complete setup instructions for `react-native-streaming-video-component-ngocda`.

> [!IMPORTANT]
> This library requires **React Native New Architecture (Fabric)** to be enabled. It will NOT work with the legacy Paper renderer.

---

## Requirements

| Dependency | Minimum Version |
|:-----------|:----------------|
| React Native | `>= 0.76.0` |
| React | `>= 18.0.0` |
| New Architecture (Fabric) | **Required** |
| iOS | `>= 13.0` |
| Android | `>= API 26 (Oreo)` |

---

## Step 1 — Install the package

```bash
# yarn (recommended)
yarn add react-native-streaming-video-component-ngocda

# npm
npm install react-native-streaming-video-component-ngocda
```

---

## Step 2 — Install peer dependencies

This library requires the following peer dependencies. Install them all at once:

```bash
yarn add \
  react-native-nitro-modules \
  react-native-reanimated \
  react-native-gesture-handler \
  react-native-svg \
  react-native-orientation-locker \
  react-native-safe-area-context \
  lucide-react-native \
  @react-native-community/slider
```

| Package | Purpose |
|:--------|:--------|
| `react-native-nitro-modules` | JSI-based native binding (Nitro engine) |
| `react-native-reanimated` | Smooth zoom animations |
| `react-native-gesture-handler` | Pinch-to-zoom & pan gestures |
| `react-native-svg` | Icons in control overlay |
| `react-native-orientation-locker` | Auto-lock to landscape in fullscreen |
| `react-native-safe-area-context` | Safe area insets in fullscreen modal |
| `lucide-react-native` | Default control icons |
| `@react-native-community/slider` | Volume slider |

---

## Step 3 — iOS Setup

### 3a. Install CocoaPods

```bash
cd ios && pod install && cd ..
```

### 3b. Enable New Architecture

In your `ios/Podfile`, ensure New Architecture is enabled (default for RN 0.76+):

```ruby
# ios/Podfile
ENV['RCT_NEW_ARCH_ENABLED'] = '1'
```

### 3c. Permissions (optional, for saving captures to Photos)

If you plan to save screenshots to the camera roll, add to `ios/YourApp/Info.plist`:

```xml
<key>NSPhotoLibraryAddUsageDescription</key>
<string>Used to save video frame snapshots.</string>
```

---

## Step 4 — Android Setup

### 4a. Enable New Architecture

In `android/gradle.properties`, ensure:

```properties
newArchEnabled=true
```

### 4b. Minimum SDK

In `android/build.gradle`, ensure:

```groovy
minSdkVersion = 26  // Android Oreo — required for PixelCopy API (frame capture)
```

### 4c. GestureHandler in MainActivity

In `android/app/src/main/java/.../MainActivity.kt`:

```kotlin
import com.swmansion.gesturehandler.react.RNGestureHandlerEnabledRootView

class MainActivity : ReactActivity() {
    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this, mainComponentName,
                DefaultNewArchitectureEntryPoint.fabricEnabled
            ) {}
        )
    }
}
```

> [!NOTE]
> If you're using Expo (managed workflow), follow the [Expo Gesture Handler setup](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation/#expo) instead.

---

## Step 5 — Reanimated Babel Plugin

Add the plugin to `babel.config.js` (must be **last** in the plugins array):

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // ... other plugins ...
    'react-native-reanimated/plugin',  // ← must be last
  ],
};
```

After adding, clear Metro cache:

```bash
yarn start --reset-cache
```

---

## Step 6 — Wrap your app with GestureHandlerRootView

In your root `App.tsx` (or `_layout.tsx` for Expo Router):

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* your app */}
    </GestureHandlerRootView>
  );
}
```

---

## Verification

Run your app and add a simple `<VideoPlayer>` with an HLS URL. You should see the video playing. If you see a black screen, check:

1. New Architecture is enabled (`newArchEnabled=true`)
2. `pod install` was run after installing
3. Metro cache was cleared after adding the Reanimated plugin

---

## Local Development / Linking

If you are using this library as a **local file dependency** (e.g., during development):

```json
// package.json of your consumer app
{
  "dependencies": {
    "react-native-streaming-video-component-ngocda": "file:../react-native-streaming-video-component-ngocda"
  }
}
```

After any source change in the library, sync the Android files manually:

```bash
cp -f ../react-native-streaming-video-component-ngocda/android/src/main/java/com/streamingvideongocda/*.kt \
  node_modules/react-native-streaming-video-component-ngocda/android/src/main/java/com/streamingvideongocda/

cd android && ./gradlew clean && cd .. && yarn android
```
