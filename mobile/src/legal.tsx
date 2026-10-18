/**
 * Yasal metin bağlantıları — gizlilik politikası, KVKK aydınlatma metni, kullanım koşulları.
 *
 * App Store Review Guidelines 5.1.1(i): "All apps must include a link to their
 * privacy policy in the App Store Connect metadata field and within the app in an
 * easily accessible manner." (https://developer.apple.com/app-store/review/guidelines/)
 * Uygulamada daha once hicbir ekranda bu baglanti yoktu; uygulama Google/Apple
 * girisi, hesap verisi ve takip formunda e-posta + alan adi topluyor.
 *
 * Sayfalar web'de herkese acik: apps/web/src/app/(marketing)/privacy, /kvkk, /terms
 * (middleware korumasi yok). Giris onay satiri web /signin ile ayni metin.
 */
import React from 'react';
import { Linking, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { colors, type } from './theme';

export const LEGAL_URLS = {
  privacy: 'https://ranksup.ai/privacy',
  kvkk: 'https://ranksup.ai/kvkk',
  terms: 'https://ranksup.ai/terms',
} as const;

export type LegalDoc = keyof typeof LEGAL_URLS;

const LABELS = {
  tr: { privacy: 'Gizlilik Politikası', kvkk: 'KVKK Aydınlatma Metni', terms: 'Kullanım Koşulları' },
  en: { privacy: 'Privacy Policy', kvkk: 'KVKK Notice', terms: 'Terms of Use' },
} as const;

export function legalLabel(doc: LegalDoc, lang: 'tr' | 'en'): string {
  return LABELS[lang][doc];
}

/** Uygulama ici tarayicida acar (SFSafariViewController / Custom Tabs); olmazsa sistem tarayicisi */
export function openLegal(doc: LegalDoc): void {
  const url = LEGAL_URLS[doc];
  WebBrowser.openBrowserAsync(url).catch(() => {
    Linking.openURL(url).catch(() => undefined);
  });
}

/** Uc yasal baglanti — koyu zeminde soluk, acik (gradyan) zeminde beyaz */
export function LegalLinks({
  lang,
  tone = 'dark',
  style,
}: {
  lang: 'tr' | 'en';
  tone?: 'dark' | 'light';
  style?: StyleProp<ViewStyle>;
}) {
  const color = tone === 'dark' ? colors.textMute : 'rgba(255,255,255,0.88)';
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 6 }, style]}>
      {(['privacy', 'kvkk', 'terms'] as const).map((doc) => (
        <Pressable key={doc} onPress={() => openLegal(doc)} accessibilityRole="link" hitSlop={6}>
          <Text style={{ ...type.label, color, textDecorationLine: 'underline' }}>{legalLabel(doc, lang)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Google / Apple dugmelerinin altindaki onay satiri (web /signin sayfasindaki metin) */
export function SignInConsent({ lang }: { lang: 'tr' | 'en' }) {
  const link = { color: colors.emberLite, textDecorationLine: 'underline' as const };
  const base = { ...type.label, lineHeight: 18, color: colors.textMute, textAlign: 'center' as const };
  if (lang === 'tr') {
    return (
      <Text style={base}>
        {'Devam ederek '}
        <Text style={link} onPress={() => openLegal('terms')} accessibilityRole="link">{legalLabel('terms', 'tr')}</Text>
        {' ve '}
        <Text style={link} onPress={() => openLegal('privacy')} accessibilityRole="link">{legalLabel('privacy', 'tr')}</Text>
        {"'nı kabul etmiş olursun."}
      </Text>
    );
  }
  return (
    <Text style={base}>
      {'By continuing you agree to the '}
      <Text style={link} onPress={() => openLegal('terms')} accessibilityRole="link">{legalLabel('terms', 'en')}</Text>
      {' and the '}
      <Text style={link} onPress={() => openLegal('privacy')} accessibilityRole="link">{legalLabel('privacy', 'en')}</Text>
      {'.'}
    </Text>
  );
}
