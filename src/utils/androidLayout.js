import { Platform } from 'react-native';

// Android devices can reserve a software navigation bar at the bottom of the
// screen. React Native's SafeAreaView does not account for that area on Android,
// so fixed footers, bottom sheets, and reply/send bars need an explicit gutter.
export const ANDROID_NAV_BAR_SAFE_OFFSET = Platform.OS === 'android' ? 60 : 0;
export const ANDROID_NAV_BAR_COMFORT_OFFSET = Platform.OS === 'android' ? 80 : 0;

export function withAndroidNavPadding(base = 0, extra = 0) {
  return Platform.OS === 'android' ? base + ANDROID_NAV_BAR_SAFE_OFFSET + extra : base;
}

export function withAndroidNavComfortPadding(base = 0, extra = 0) {
  return Platform.OS === 'android' ? base + ANDROID_NAV_BAR_COMFORT_OFFSET + extra : base;
}

export function withAndroidNavBottom(base = 0, extra = 0) {
  return Platform.OS === 'android' ? base + ANDROID_NAV_BAR_SAFE_OFFSET + extra : base;
}
