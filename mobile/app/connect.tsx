import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Keyboard, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, fonts, radii, tint, type } from '../src/theme';
import { Icon, EmberButton, ScreenBg, GoogleG, AppleLogo } from '../src/components';
import { useAuth } from '../src/auth';
import { useLang } from '../src/i18n';
import { maskEmail } from '../src/account';
import { LegalLinks, SignInConsent } from '../src/legal';

/**
 * Hesap ekranı — bağlanma (Google / Apple / API anahtarı), bağlı hesap, aktif site,
 * yasal metinler (5.1.1(i)) ve hesap silme (5.1.1(v)).
 *
 * Hangi hesabın bağlı olduğu maskeli e-postayla gösterilir: sunucu girişte hesabı
 * E-POSTAYLA eşler (auth.controller.ts resolveOAuthUser); farklı e-postalı bir
 * Google/Apple hesabı (ör. Apple "E-postamı Gizle") sessizce ayrı, boş bir hesap açar.
 */
export default function Connect() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang } = useLang();
  const tr = lang === 'tr';
  const { connected, connectedVia, me, activeSite, sites, connect, signInWithGoogle, signInWithApple, appleSupported, disconnect, setActiveSite } = useAuth();

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<null | 'google' | 'apple'>(null);
  const [error, setError] = useState<string | null>(null);
  // Hata, kullanıcının o an baktığı düğmenin altında gösterilir (giriş düğmeleri ya da anahtar alanı)
  const [errorFrom, setErrorFrom] = useState<'oauth' | 'key'>('oauth');

  const submit = async () => {
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const r = await connect(key);
    setBusy(false);
    if (!r.ok) {
      setErrorFrom('key');
      setError(r.error);
    } else setKey('');
  };

  const oauth = async (provider: 'google' | 'apple') => {
    setOauthBusy(provider);
    setError(null);
    const r = await (provider === 'google' ? signInWithGoogle() : signInWithApple());
    setOauthBusy(null);
    if (!r.ok) {
      setErrorFrom('oauth');
      setError(r.error);
    }
  };

  const masked = maskEmail(me?.email);
  const bodyText = { ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute };

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />

      {/* Üst bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/app'))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr ? 'Geri' : 'Back'} style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElev }}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="arrowRight" size={16} color={colors.text} strokeWidth={2.2} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={{ ...type.metric, fontFamily: fonts.displayBold, color: colors.text }}>
          {connected ? (tr ? 'Hesap' : 'Account') : tr ? 'Hesabını bağla' : 'Connect your account'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {connected ? (
          /* ── Bağlı durum ── */
          <View style={{ marginTop: 8 }}>
            <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: tint(colors.good, 0.3), padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={18} color={colors.bg} strokeWidth={3} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.filter, fontFamily: fonts.displayBold, color: colors.text }}>{tr ? 'Bağlandı' : 'Connected'}</Text>
                  <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute }}>
                    {tr ? 'Ana sayfa ve ASO sekmeleri bu hesabın verilerini gösterir.' : 'The Home and ASO tabs show this account’s data.'}
                  </Text>
                </View>
              </View>
              {/* Bağlı hesap — maskeli e-posta + bağlantı türü */}
              <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, gap: 2 }}>
                <Text style={{ ...type.data, color: colors.textFaint }}>{tr ? 'BAĞLI HESAP' : 'CONNECTED ACCOUNT'}</Text>
                <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: colors.text }}>{masked || (tr ? 'E-posta alınamadı' : 'E-mail unavailable')}</Text>
                <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute }}>
                  {connectedVia === 'apiKey'
                    ? tr ? 'API anahtarıyla bağlı' : 'Connected with an API key'
                    : tr ? 'Google ya da Apple oturumuyla bağlı' : 'Signed in with Google or Apple'}
                </Text>
              </View>
            </View>

            {/* Aktif site seçimi */}
            <Text style={{ ...type.data, letterSpacing: 1.2, color: colors.textFaint, marginTop: 20, marginBottom: 10 }}>{tr ? 'AKTİF SİTE' : 'ACTIVE SITE'}</Text>
            <View style={{ gap: 8 }}>
              {sites.map((s) => {
                const on = activeSite?.id === s.id;
                return (
                  <Pressable key={s.id} onPress={() => setActiveSite(s.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 13, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: on ? tint(colors.ember, 0.5) : colors.lineSoft }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? colors.ember : colors.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      {on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ember }} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }} numberOfLines={1}>{s.name}</Text>
                      <Text style={{ ...type.data, color: colors.textFaint }} numberOfLines={1}>{s.url}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {sites.length === 0 && (
                <Text style={bodyText}>{tr ? 'Bu hesapta site yok. Web panelinden bir site ekleyince burada görünür.' : 'This account has no sites. Add one on the web dashboard and it will show up here.'}</Text>
              )}
            </View>

            <Pressable onPress={disconnect} style={{ marginTop: 22, alignSelf: 'center' }} hitSlop={8} accessibilityRole="button">
              <Text style={{ ...type.filter, color: colors.crit }}>{tr ? 'Bağlantıyı kes' : 'Disconnect'}</Text>
            </Pressable>

            {/* Hesap silme — Apple 5.1.1(v): hesap ayarlarında kolay bulunmalı */}
            <View style={{ marginTop: 28, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 16 }}>
              <Pressable
                onPress={() => router.push('/delete-account')}
                accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: tint(colors.crit, 0.3), opacity: pressed ? 0.85 : 1 })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.crit }}>{tr ? 'Hesabı sil' : 'Delete account'}</Text>
                  <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute, marginTop: 2 }}>
                    {tr ? 'Erişim hemen kapanır, veriler 30 gün sonra kalıcı silinir.' : 'Access ends now; data is permanently deleted after 30 days.'}
                  </Text>
                </View>
                <Icon name="arrowRight" size={15} color={colors.textFaint} strokeWidth={2.2} />
              </Pressable>
            </View>

            <LegalLinks lang={lang} style={{ marginTop: 24 }} />
          </View>
        ) : (
          /* ── Bağlı değil ── */
          <View style={{ marginTop: 8 }}>
            <Text style={{ ...type.filter, fontFamily: fonts.body, lineHeight: 20, color: colors.textDim }}>
              {tr
                ? 'RanksUp hesabını bağla; ana sayfa ve ASO sekmeleri sitelerini, bildirimlerini ve uygulamalarını göstersin.'
                : 'Connect your RanksUp account so the Home and ASO tabs show your sites, notifications and apps.'}
            </Text>

            {/* Google / Apple ile giriş */}
            <View style={{ marginTop: 16, gap: 10 }}>
              {/* Marka kuralları: Google düğmesi beyaz zemin, Apple düğmesi siyah zemin + beyaz metin */}
              <Pressable onPress={() => oauth('google')} disabled={!!oauthBusy} accessibilityRole="button" style={({ pressed }) => ({ height: 50, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, opacity: pressed || oauthBusy ? 0.8 : 1 })}>
                {oauthBusy === 'google' ? (
                  <ActivityIndicator color="#1a1a1a" size="small" />
                ) : (
                  <>
                    <GoogleG size={18} />
                    <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: '#1a1a1a' }}>{tr ? 'Google ile devam et' : 'Continue with Google'}</Text>
                  </>
                )}
              </Pressable>

              {/* Apple ile devam et — yalnızca iOS */}
              {appleSupported && (
                <Pressable onPress={() => oauth('apple')} disabled={!!oauthBusy} accessibilityRole="button" style={({ pressed }) => ({ height: 50, borderRadius: radii.lg, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed || oauthBusy ? 0.8 : 1 })}>
                  {oauthBusy === 'apple' ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <AppleLogo size={18} color="#fff" />
                      <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: '#fff' }}>{tr ? 'Apple ile devam et' : 'Continue with Apple'}</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>

            {/* Aynı hesap uyarısı — sunucu hesabı e-postayla eşler */}
            <Text style={{ ...bodyText, marginTop: 12 }}>
              {tr
                ? 'Web panelinde kullandığın Google hesabını seç. Farklı e-posta adresli bir Google ya da Apple hesabıyla (ör. Apple’ın “E-postamı Gizle” seçeneği) giriş yaparsan ayrı ve boş bir hesap açılır.'
                : 'Choose the Google account you use on the web dashboard. Signing in with a Google or Apple account that has a different e-mail address (e.g. Apple’s “Hide My Email”) creates a separate, empty account.'}
            </Text>
            <View style={{ marginTop: 10 }}>
              <SignInConsent lang={lang} />
            </View>

            {error && errorFrom === 'oauth' && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit, marginTop: 10 }}>{error}</Text>}

            {/* API anahtarı ile bağlan */}
            <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.lineSoft }} />
              <Text style={{ ...type.micro, color: colors.textFaint }}>{tr ? 'YA DA API ANAHTARI' : 'OR AN API KEY'}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.lineSoft }} />
            </View>

            <View style={{ marginTop: 14, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15, gap: 11 }}>
              {(tr
                ? ['ranksup.ai/api-keys sayfasını aç', '+ Yeni API Key → ad yaz, izinleri seç → Key Üret', 'Token bir kez gösterilir — kopyala, aşağıya yapıştır']
                : ['Open ranksup.ai/api-keys', '+ New API Key → name it, pick scopes → Generate', 'The token is shown once — copy it and paste it below']
              ).map((step, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: tint(colors.ember, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.emberLite }}>{i + 1}</Text>
                  </View>
                  <Text style={{ ...type.label, fontFamily: fonts.body, flex: 1, lineHeight: 18, color: colors.text }}>{step}</Text>
                </View>
              ))}
              <Pressable onPress={() => Linking.openURL('https://ranksup.ai/api-keys')} hitSlop={6} accessibilityRole="link" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.emberMid }}>{tr ? 'API Keys sayfasını aç ↗' : 'Open the API Keys page ↗'}</Text>
              </Pressable>
            </View>

            {/* Anahtar girişi */}
            <View style={{ marginTop: 14, height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Icon name="sparkle" size={15} color={colors.emberLite} strokeWidth={2} />
              <TextInput
                value={key}
                onChangeText={(v) => { setKey(v); if (error) setError(null); }}
                onSubmitEditing={submit}
                placeholder="luvi_..."
                placeholderTextColor={colors.textGhost}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="go"
                editable={!busy}
                accessibilityLabel={tr ? 'API anahtarı' : 'API key'}
                style={{ ...type.filter, fontFamily: fonts.mono, flex: 1, color: colors.text }}
              />
            </View>

            {error && errorFrom === 'key' && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit, marginTop: 8 }}>{error}</Text>}

            <EmberButton label={busy ? (tr ? 'Bağlanıyor…' : 'Connecting…') : tr ? 'Bağla' : 'Connect'} onPress={submit} style={{ marginTop: 12 }} iconRight={busy ? <ActivityIndicator color={colors.text} size="small" /> : undefined} />

            <LegalLinks lang={lang} style={{ marginTop: 24 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
