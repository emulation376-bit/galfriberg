import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export const supportedLanguages = ['zh', 'en', 'ja'] as const;
export type AppLanguage = (typeof supportedLanguages)[number];

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh',
  initAsync: false,
  fallbackLng: 'zh',
  supportedLngs: [...supportedLanguages],
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = 'zh-CN';

export function currentLocale(): string {
  return 'zh-CN';
}

export default i18n;
