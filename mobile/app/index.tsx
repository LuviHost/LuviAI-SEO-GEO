import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { colors, fonts, radii, type } from '../src/theme';
import { useLang } from '../src/i18n';
import { useAuth } from '../src/auth';
import { Orb, Icon, EmberButton, ScreenBg, T } from '../src/components';
import { LegalLinks } from '../src/legal';

/**
 * İlk açılış (F21). Eskiden "Siteyi bağla" setInterval ile sahte bir "AI analiz"
 * oynatıyor, ardından girilen adres için uydurma sonuçlar gösteriyordu ("Sektör:
 * KOBİ finans", "50 keyword", "3 rakip", "Auto-Pilot açık") — hiçbir ağ çağrısı
 * yapılmadan. Artık düğme gerçek public testi (/analyze?domain=…) açar.
 *
 * Bir kez gösterilir: SecureStore bayrağı ya da bağlı hesap varsa doğrudan uygulamaya geçilir.
 */
const ONBOARDED_KEY = 'ranksup.onboarded';

export default function Onboarding() {
  const { t, lang } = useLang();
  const { connected, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    (async () => {
      let seen = false;
      try {
        seen = (await SecureStore.getItemAsync(ONBOARDED_KEY)) === '1';
      } catch {
        /* okunamazsa bir kez daha gosterilir — zarari yok */
      }
      if (!alive) return;
      if (connected || seen) {
        router.replace('/app');
        return;
      }
      setReady(true);
      // Gosterildigi an isaretlenir: kullanici bu ekrani bir daha gormez
      SecureStore.setItemAsync(ONBOARDED_KEY, '1').catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [loading, connected, router]);

  const analyze = () => {
    const d = url.trim();
    if (d.length < 3) {
      setError(t.ob1_err);
      return;
    }
    Keyboard.dismiss();
    // Uygulama kabuğu analizi kendi üstünde açar; analiz kapatılınca kullanıcı uygulamada kalır
    router.replace({ pathname: '/app', params: { analyze: d } });
  };

  if (!ready) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenBg />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'flex-end', paddingTop: 6 }}>
          <Pressable onPress={() => router.replace('/app')} hitSlop={10} accessibilityRole="button">
            <Text style={{ ...type.label, fontFamily: fonts.bodySemi, color: colors.textMute, padding: 6 }}>{t.skip}</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
          <Orb size={64} />
          <Text style={{ ...type.micro, letterSpacing: 3, color: colors.emberLite, marginTop: 22 }}>{t.ob1_kicker}</Text>
          <Text accessibilityRole="header" style={[T.display(27, colors.text), { textAlign: 'center', marginTop: 12, maxWidth: 300, lineHeight: 33 }]}>
            {t.ob1_title}
          </Text>
          <Text style={{ ...type.filter, fontFamily: fonts.body, lineHeight: 21, color: colors.textMute, textAlign: 'center', marginTop: 10, maxWidth: 300 }}>
            {t.ob1_sub}
          </Text>

          <View style={{ marginTop: 26, width: '100%', maxWidth: 330, height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: error ? colors.crit : colors.lineStrong }}>
            <Icon name="globe" size={15} color={colors.textFaint} strokeWidth={2} />
            <TextInput
              value={url}
              onChangeText={(v) => { setUrl(v); if (error) setError(null); }}
              onSubmitEditing={analyze}
              placeholder={t.ob1_ph}
              placeholderTextColor={colors.textGhost}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              accessibilityLabel={t.ob1_ph}
              style={{ ...type.filter, flex: 1, fontFamily: fonts.mono, color: colors.text }}
            />
          </View>
          {error && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit, marginTop: 8 }}>{error}</Text>}

          <EmberButton
            label={t.ob1_cta}
            onPress={analyze}
            iconRight={<Icon name="arrowRight" size={13} color={colors.text} strokeWidth={2.6} />}
            style={{ marginTop: 12, width: '100%', maxWidth: 330 }}
          />
          <Text style={{ ...type.micro, letterSpacing: 0.8, color: colors.textGhost, marginTop: 14 }}>{t.ob1_note}</Text>
        </View>

        <LegalLinks lang={lang} />
      </ScrollView>
    </View>
  );
}
