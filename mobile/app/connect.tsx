import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Keyboard, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii } from '../src/theme';
import { Icon, EmberButton, ScreenBg, GoogleG, AppleLogo } from '../src/components';
import { useAuth } from '../src/auth';

export default function Connect() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { connected, activeSite, sites, connect, signInWithGoogle, signInWithApple, appleSupported, disconnect, setActiveSite } = useAuth();

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<null | 'google' | 'apple'>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const r = await connect(key);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else setKey('');
  };

  const oauth = async (provider: 'google' | 'apple') => {
    setOauthBusy(provider);
    setError(null);
    const r = await (provider === 'google' ? signInWithGoogle() : signInWithApple());
    setOauthBusy(null);
    if (!r.ok) setError(r.error);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />

      {/* Üst bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/app'))} hitSlop={10} style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(33,23,18,0.8)' }}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="arrowRight" size={16} color={colors.text} strokeWidth={2.2} />
          </View>
        </Pressable>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 17, color: '#fff' }}>Hesabını bağla</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {connected ? (
          /* ── Bağlı durum ── */
          <View style={{ marginTop: 8 }}>
            <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={18} color="#0b0b0b" strokeWidth={3} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: '#fff' }}>Bağlandı</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute }}>ASO ve Studio artık canlı veriyle çalışıyor.</Text>
                </View>
              </View>
            </View>

            {/* Aktif site seçimi */}
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10.5, letterSpacing: 1.2, color: colors.textFaint, marginTop: 20, marginBottom: 10 }}>AKTİF SİTE</Text>
            <View style={{ gap: 8 }}>
              {sites.map((s) => {
                const on = activeSite?.id === s.id;
                return (
                  <Pressable key={s.id} onPress={() => setActiveSite(s.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 13, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: on ? 'rgba(243,109,50,0.5)' : colors.lineSoft }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? colors.ember : colors.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      {on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ember }} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' }} numberOfLines={1}>{s.name}</Text>
                      <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textFaint }} numberOfLines={1}>{s.url}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {sites.length === 0 && (
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: colors.textMute }}>Bu hesapta site yok. Web panelinden bir site ekleyince burada görünür.</Text>
              )}
            </View>

            <Pressable onPress={disconnect} style={{ marginTop: 22, alignSelf: 'center' }} hitSlop={8}>
              <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: colors.crit }}>Bağlantıyı kes</Text>
            </Pressable>
          </View>
        ) : (
          /* ── Bağlı değil ── */
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.textDim }}>
              ASO ve Studio panolarını canlı verinle çalıştırmak için web panelinden bir API anahtarı üretip buraya yapıştır.
            </Text>

            {/* Adımlar */}
            <View style={{ marginTop: 16, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15, gap: 11 }}>
              {[
                'ranksup.ai/api-keys sayfasını aç',
                '+ Yeni API Key → ad yaz, izinleri seç → Key Üret',
                'Token bir kez gösterilir — kopyala, aşağıya yapıştır',
              ].map((step, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(243,109,50,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color: colors.emberLite }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.text }}>{step}</Text>
                </View>
              ))}
              <Pressable onPress={() => Linking.openURL('https://ranksup.ai/api-keys')} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 11, color: colors.emberMid }}>API Keys sayfasını aç ↗</Text>
              </Pressable>
            </View>

            {/* Anahtar girişi */}
            <View style={{ marginTop: 16, height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Icon name="sparkle" size={15} color={colors.emberLite} strokeWidth={2} />
              <TextInput
                value={key}
                onChangeText={(v) => { setKey(v); if (error) setError(null); }}
                onSubmitEditing={submit}
                placeholder="luvi_..."
                placeholderTextColor="rgba(247,240,234,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="go"
                editable={!busy}
                style={{ flex: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 13.5 }}
              />
            </View>
            {error && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.crit, marginTop: 8 }}>{error}</Text>}

            <EmberButton label={busy ? 'Bağlanıyor…' : 'Bağla'} onPress={submit} style={{ marginTop: 12 }} iconRight={busy ? <ActivityIndicator color="#fff" size="small" /> : undefined} />

            {/* Google girişi — yakında */}
            <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: 0.5 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.lineSoft }} />
              <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textFaint }}>YA DA</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.lineSoft }} />
            </View>
            <View style={{ marginTop: 12, gap: 10 }}>
              {/* Google ile giriş */}
              <Pressable onPress={() => oauth('google')} disabled={!!oauthBusy} style={({ pressed }) => ({ height: 50, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, opacity: pressed || oauthBusy ? 0.8 : 1 })}>
                {oauthBusy === 'google' ? (
                  <ActivityIndicator color="#1a1a1a" size="small" />
                ) : (
                  <>
                    <GoogleG size={18} />
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: '#1a1a1a' }}>Google ile devam et</Text>
                  </>
                )}
              </Pressable>

              {/* Apple ile devam et — yalnızca iOS */}
              {appleSupported && (
                <Pressable onPress={() => oauth('apple')} disabled={!!oauthBusy} style={({ pressed }) => ({ height: 50, borderRadius: radii.lg, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed || oauthBusy ? 0.8 : 1 })}>
                  {oauthBusy === 'apple' ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <AppleLogo size={18} color="#fff" />
                      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' }}>Apple ile devam et</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
