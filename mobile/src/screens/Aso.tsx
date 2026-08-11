import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Keyboard, Image } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii } from '../theme';
import { useLang, KW, type Store } from '../i18n';
import { useAuth } from '../auth';
import { asoSearch, type AsoApp } from '../api';
import { Icon, T, DemoBadge } from '../components';

const R = 31;
const CIRC = 2 * Math.PI * R;

export function AsoScreen() {
  const { t } = useLang();
  const { connected, token, activeSite } = useAuth();
  const router = useRouter();
  const [store, setStore] = useState<Store>('ios');
  const [apOn, setApOn] = useState(true);
  const score = store === 'ios' ? 78 : 71;
  const dash = (score / 100) * CIRC;

  const live = connected && !!token && !!activeSite;
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [apps, setApps] = useState<AsoApp[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const doSearch = async () => {
    const q = term.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true); setSearchErr(null); setApps(null);
    try {
      setApps(await asoSearch(token!, activeSite!.id, q, store === 'ios' ? 'IOS' : 'ANDROID', 'tr'));
    } catch (e: any) {
      setSearchErr(e?.message ?? 'Arama başarısız.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <View>
      <Text style={[T.display(24, '#fff'), { marginTop: 6 }]}>ASO</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute, marginTop: 2, marginBottom: 12 }}>{t.aso_sub}</Text>
      {live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', marginBottom: 14 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.good }} />
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9.5, color: colors.good }}>Canlı arama · {activeSite!.name}</Text>
        </View>
      ) : (
        <Pressable onPress={() => router.push('/connect')}>
          <DemoBadge note="Örnek veri · bağlanmak için dokun" />
        </Pressable>
      )}

      {/* Segmented */}
      <View style={{ flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, marginBottom: 16 }}>
        {(['ios', 'play'] as Store[]).map((s) => {
          const on = store === s;
          const label = s === 'ios' ? 'App Store' : 'Play Store';
          return (
            <Pressable key={s} onPress={() => setStore(s)} style={{ flex: 1 }}>
              {on ? (
                <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={seg}>
                  <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' }}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={seg}>
                  <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textMute }}>{label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Canlı uygulama araması (bağlıyken) */}
      {live && (
        <View style={{ marginBottom: 16 }}>
          <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
            <Icon name="search" size={15} color={colors.emberLite} strokeWidth={2} />
            <TextInput
              value={term}
              onChangeText={(v) => { setTerm(v); if (searchErr) setSearchErr(null); }}
              onSubmitEditing={doSearch}
              placeholder={store === 'ios' ? 'App Store’da uygulama ara…' : 'Play Store’da uygulama ara…'}
              placeholderTextColor="rgba(247,240,234,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              editable={!searching}
              style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }}
            />
            <Pressable onPress={doSearch} disabled={searching} hitSlop={6}>
              {searching ? <ActivityIndicator color={colors.ember} size="small" /> : <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.emberLite }}>Ara</Text>}
            </Pressable>
          </View>
          {searchErr && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.crit, marginTop: 8 }}>{searchErr}</Text>}
          {apps && apps.length > 0 && (
            <View style={{ gap: 8, marginTop: 10 }}>
              {apps.slice(0, 6).map((a, i) => (
                <View key={a.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(247,240,234,0.06)', overflow: 'hidden' }}>
                    {!!a.icon && <Image source={{ uri: a.icon }} style={{ width: 40, height: 40 }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textFaint }} numberOfLines={1}>{a.developer ?? ''}</Text>
                  </View>
                  {typeof a.rating === 'number' && (
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 11.5, color: colors.warn }}>★ {a.rating.toFixed(1)}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
          {apps && apps.length === 0 && !searchErr && (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute, marginTop: 10 }}>Sonuç bulunamadı.</Text>
          )}
        </View>
      )}

      {/* Skor halkası */}
      <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <View style={{ width: 74, height: 74 }}>
          <Svg width={74} height={74} viewBox="0 0 74 74">
            <Defs>
              <SvgGrad id="ring" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={colors.ember} />
                <Stop offset="1" stopColor={colors.emberDeep} />
              </SvgGrad>
            </Defs>
            <Circle cx={37} cy={37} r={R} fill="none" stroke="rgba(247,240,234,0.08)" strokeWidth={6} />
            <Circle cx={37} cy={37} r={R} fill="none" stroke="url(#ring)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${dash} ${CIRC}`} transform="rotate(-90 37 37)" />
          </Svg>
          <View style={{ position: 'absolute', width: 74, height: 74, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.displayXBold, fontSize: 21, color: '#fff' }}>{score}</Text>
          </View>
        </View>
        <View>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8.5, letterSpacing: 1.5, color: colors.textFaint }}>{t.aso_score}</Text>
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: colors.good, marginTop: 3 }}>{store === 'ios' ? '+5' : '+3'} {t.aso_thisweek}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: colors.textMute, marginTop: 2 }}>{t.aso_meta}</Text>
        </View>
      </View>

      {/* Keyword sıralaması */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>{t.aso_kw}</Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textFaint }}>247 KW</Text>
      </View>
      <View style={{ gap: 8, marginBottom: 16 }}>
        {KW[store].map((k, i) => {
          const top = k.rank <= 3;
          const dc = k.dir > 0 ? colors.good : k.dir < 0 ? '#F87171' : colors.textFaint;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
              <View style={{ minWidth: 40, paddingVertical: 5, borderRadius: 9, backgroundColor: top ? colors.text : 'rgba(247,240,234,0.07)', alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 11.5, color: top ? colors.bg : colors.text }}>#{k.rank}</Text>
              </View>
              <Text style={{ flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text }}>{k.name}</Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textGhost }}>{k.vol}</Text>
              <Text style={{ minWidth: 32, textAlign: 'right', fontFamily: fonts.bodyBold, fontSize: 11.5, color: dc }}>{k.delta}</Text>
            </View>
          );
        })}
      </View>

      {/* Apple Search Ads */}
      <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>Apple Search Ads</Text>
            <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, backgroundColor: 'rgba(243,109,50,0.12)', borderWidth: 1, borderColor: 'rgba(243,109,50,0.3)' }}>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8.5, letterSpacing: 1.2, color: colors.emberLite }}>AUTO-PILOT</Text>
            </View>
          </View>
          <Pressable onPress={() => setApOn((v) => !v)} style={{ width: 40, height: 24, borderRadius: radii.pill, backgroundColor: apOn ? colors.ember : 'rgba(247,240,234,0.18)', justifyContent: 'center' }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', top: 3, left: apOn ? 19 : 3 }} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Metric k={t.asa_imp} v="12.4K" />
          <Metric k={t.asa_tap} v="487" />
          <Metric k={t.asa_inst} v="62" />
          <Metric k="CPI" v="$0.42" accent />
        </View>
        <View style={{ marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.lineSoft }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 11, lineHeight: 16, color: colors.textMute }}>{t.asa_note}</Text>
        </View>
      </View>
    </View>
  );
}

const seg = { height: 34, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const };

function Metric({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 8, letterSpacing: 0.6, color: colors.textFaint }}>{k}</Text>
      <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: accent ? colors.emberLite : '#fff', marginTop: 3 }}>{v}</Text>
    </View>
  );
}
