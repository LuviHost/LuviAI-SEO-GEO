/**
 * Mağaza metin sınırları — web tarafının tek kaynağı. API'deki karşılığı
 * apps/api/src/aso/store-limits.ts (resmi belge bağlantıları orada); iki taraf
 * aynı sayıyı göstermeli. Google Play adı 30 karakterdir — metadata sayfası
 * eskiden 50 gösteriyordu.
 *
 * Google Play: https://support.google.com/googleplay/android-developer/answer/9859152
 *              https://support.google.com/googleplay/android-developer/answer/9898842
 * App Store:   https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
 *              https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
 */

export const APP_STORE_LIMITS = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
} as const;

export const GOOGLE_PLAY_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
} as const;
