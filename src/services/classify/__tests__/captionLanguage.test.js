jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'android' } }));
import { NativeModules, Platform } from 'react-native';
import { captionLanguage } from '../captionLanguage';
test.each(['zh_CN', 'zh-Hant-TW', 'zh-Hans-CN'])('Android Chinese locale %s uses Chinese captions', localeIdentifier => {
  Platform.OS = 'android'; NativeModules.I18nManager = { getConstants: () => ({ localeIdentifier }) };
  expect(captionLanguage()).toBe('zh');
});
test('iOS prefers language over region', () => {
  Platform.OS = 'ios'; NativeModules.SettingsManager = { settings: { AppleLanguages: ['en-CN'], AppleLocale: 'zh_CN' } };
  expect(captionLanguage()).toBe('en');
});
test('Android legacy locale and unsupported language use English', () => {
  Platform.OS = 'android'; NativeModules.I18nManager = { localeIdentifier: 'fr_FR' };
  expect(captionLanguage()).toBe('en');
});
