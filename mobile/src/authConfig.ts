/**
 * Native Google girişi için OAuth client ID'leri.
 * Bunlar GİZLİ DEĞİL — public identifier'lar (uygulama içinde bulunmaları normaldir).
 *
 * Google Cloud Console → APIs & Services → Credentials'tan oluştur:
 *  1) "iOS" tipi client (Bundle ID = ai.ranksup.app) → GOOGLE_IOS_CLIENT_ID
 *     ve bunun "reversed" hâlini (com.googleusercontent.apps.…) app.json > plugins >
 *     @react-native-google-signin > iosUrlScheme alanına yapıştır.
 *  2) "Web application" tipi client → GOOGLE_WEB_CLIENT_ID
 *     idToken'ın audience'ı budur; native signIn'de ZORUNLU.
 *
 * Sunucu tarafında da (root .env) aynı ID'ler audience olarak doğrulanır:
 *   GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, APPLE_IOS_BUNDLE_ID=ai.ranksup.app
 */

export const GOOGLE_IOS_CLIENT_ID = '793565931127-g9t22o43safr517cd1auo0p98ne78m3o.apps.googleusercontent.com';
export const GOOGLE_WEB_CLIENT_ID = '793565931127-1po6s5dck8a4oa9d2s0gp5aa2fco0vid.apps.googleusercontent.com';

/** ID'ler henüz yapılandırılmamışsa (placeholder) → butonlar kullanıcıya nazik hata gösterir. */
export const GOOGLE_CONFIGURED = !GOOGLE_IOS_CLIENT_ID.startsWith('REPLACE_') && !GOOGLE_WEB_CLIENT_ID.startsWith('REPLACE_');
