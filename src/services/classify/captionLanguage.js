import { NativeModules, Platform } from 'react-native';

// Resolve per pass, independently of the app's manually selected UI language.
export function captionLanguage() {
  let locale;
  if (Platform.OS === 'ios') {
    const settings = NativeModules.SettingsManager?.settings || {};
    locale = settings.AppleLanguages?.[0] || settings.AppleLocale;
  } else {
    const manager = NativeModules.I18nManager;
    locale = manager?.getConstants?.()?.localeIdentifier || manager?.localeIdentifier;
  }
  if (!locale && typeof navigator !== 'undefined') locale = navigator.language;
  // The caption model supports Chinese and English; other system languages use English.
  return !locale || /^zh(?:[-_]|$)/i.test(String(locale)) ? 'zh' : 'en';
}
