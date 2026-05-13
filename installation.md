# Installation

To install the `react-native-streaming-video-component-ngocda` library, follow these steps.

## 1. Install the package

```bash
npm install react-native-streaming-video-component-ngocda
# or
yarn add react-native-streaming-video-component-ngocda
```

## 2. Install Peer Dependencies

This library requires several peer dependencies for animations, icons, and gestures. You must install them in your project:

```bash
npm install react-native-nitro-modules react-native-reanimated react-native-gesture-handler react-native-svg lucide-react-native react-native-orientation-locker @react-native-community/slider
# or
yarn add react-native-nitro-modules react-native-reanimated react-native-gesture-handler react-native-svg lucide-react-native react-native-orientation-locker @react-native-community/slider
```

## 3. Native Setup

### iOS
Don't forget to install pods:
```bash
cd ios && pod install
```

### Android
Ensure you have the following in your `MainApplication.kt` (or `.java`):
- React Native Nitro Modules setup.
- React Native Gesture Handler setup.

## 4. Reanimated Setup
Add the Reanimated babel plugin to your `babel.config.js`:

```javascript
module.exports = {
  plugins: [
    'react-native-reanimated/plugin',
  ],
};
```
