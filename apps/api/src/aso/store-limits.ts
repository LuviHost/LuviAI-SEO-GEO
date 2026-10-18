/**
 * Magaza metin sinirlari — TEK KAYNAK. Prompt, denetim, dogrulayici ve ASC
 * akisi buradan okur. Eskiden her dosyada ayri sayi vardi ve Google Play ad
 * siniri bir yerde 30, bir yerde 50 yaziyordu (dogrusu 30): AI 50 karakterlik
 * baslik oneriyor, denetim de "kisa, 50'yi kullan" diyordu.
 *
 * Google Play (iki resmi kaynak):
 *  - Play Console Yardim, magaza girisi tablosu: "App name: 30 character
 *    limit", "Short description: 80", "Full description: 4000"
 *    https://support.google.com/googleplay/android-developer/answer/9859152
 *  - Meta veri politikasi: "Your app title must be 30 characters or less."
 *    https://support.google.com/googleplay/android-developer/answer/9898842
 *
 * App Store (iki resmi kaynak):
 *  - ASC referansi: ad en fazla 30, alt baslik 30
 *    https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
 *    promosyon 170, aciklama 4000, yenilikler 4000, anahtar kelime "100 bytes"
 *    https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
 *  - Urun sayfasi rehberi: ad 30, alt baslik 30, promosyon 170, anahtar
 *    kelime "100 characters"
 *    https://developer.apple.com/app-store/product-page/
 *  Anahtar kelime biriminin (karakter mi bayt mi) neden karakter sayildigi:
 *  keyword-field-audit.ts.
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
