import React, { useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii } from '../theme';
import { useLang } from '../i18n';
import { Icon, T, VendorLogo, DomainFavicon, EmberButton, Orb } from '../components';
import { useAnalysis, deriveVisibility } from '../store';

export function VisibilityScreen() {
  const { t } = useLang();
  const router = useRouter();
  const { result, domain, loading } = useAnalysis();

  const vis = useMemo(() => (result ? deriveVisibility(result) : null), [result]);

  return (
    <View>
      <Text style={[T.display(24, '#fff'), { marginTop: 6 }]}>{t.vis_title}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMute, marginTop: 2, marginBottom: 14 }}>{t.vis_sub}</Text>

      {/* Yükleniyor */}
      {loading && !result && (
        <View style={{ alignItems: 'center', paddingVertical: 40, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
          <Orb size={52} />
          <ActivityIndicator color={colors.ember} style={{ marginTop: 18 }} />
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: colors.textMute, marginTop: 12 }}>{domain} taranıyor…</Text>
        </View>
      )}

      {/* Boş durum — henüz analiz yok */}
      {!result && !loading && (
        <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 20, alignItems: 'center' }}>
          <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="tabVis" size={22} color="#fff" strokeWidth={2} />
          </LinearGradient>
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: '#fff', marginTop: 14, textAlign: 'center' }}>Görünürlüğünü ölç</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.textMute, marginTop: 6, textAlign: 'center' }}>
            Bir site analiz et; markanın 7 AI motorundaki gerçek görünürlüğünü burada gör.
          </Text>
          <EmberButton label="Site analiz et" onPress={() => router.push('/analyze')} style={{ marginTop: 16, alignSelf: 'stretch' }} height={46} />
        </View>
      )}

      {/* Gerçek görünürlük — analiz sonucundan türetildi */}
      {vis && result && (
        <>
          {/* Alan adı başlığı */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <DomainFavicon domain={result.domain} brand={result.brand} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }} numberOfLines={1}>{result.brand || result.domain}</Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textFaint }}>AI görünürlük · anlık görünüm</Text>
            </View>
            <Pressable onPress={() => router.push('/analyze')} hitSlop={8} style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color: colors.emberLite }}>Yenile</Text>
            </Pressable>
          </View>

          {/* Skor kartı */}
          <LinearGradient colors={[colors.ember, '#D8452A', colors.emberDeep]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, padding: 18, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', top: -46, right: -34, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.85)' }}>{t.vis_score}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                  <Text style={{ fontFamily: fonts.displayXBold, fontSize: 46, color: '#fff', lineHeight: 48, letterSpacing: -1.8 }}>{vis.score}</Text>
                  <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: 'rgba(255,255,255,0.7)', marginBottom: 7 }}>/100</Text>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: 'rgba(255,255,255,0.9)', marginTop: 6 }}>
                  {vis.answeredQueries}/{vis.totalQueries} soruda en az bir AI motoru markanı gösterdi.
                </Text>
              </View>
              {/* Alıntı oranı halkası */}
              <RateRing pct={vis.score} />
            </View>
          </LinearGradient>

          {/* Motor bazında */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>{t.vis_engines}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textFaint }}>{vis.citedPairs}/{vis.totalPairs} alıntı</Text>
          </View>

          <View style={{ gap: 8 }}>
            {vis.engines.map((e) => {
              const barW = `${Math.max(3, e.rate)}%` as const;
              return (
                <View key={e.provider} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 11, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' }}>
                    <VendorLogo provider={e.provider} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12.5, color: '#fff' }}>{e.name}</Text>
                      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 11, color: e.cited > 0 ? colors.good : colors.textGhost }}>
                        {e.cited}/{e.total}
                        {e.mentioned > 0 && <Text style={{ color: colors.warn }}> · {e.mentioned}~</Text>}
                      </Text>
                    </View>
                    <View style={{ height: 4, borderRadius: radii.pill, backgroundColor: 'rgba(247,240,234,0.07)', overflow: 'hidden' }}>
                      <View style={{ height: '100%', borderRadius: radii.pill, backgroundColor: e.cited > 0 ? e.color : 'rgba(247,240,234,0.18)', width: barW }} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Rakip sıralaması (gerçek) */}
          {result.competitorRanking.length > 0 && (
            <>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff', marginTop: 18, marginBottom: 10 }}>AI cevaplarında kim öne çıkıyor?</Text>
              <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 6 }}>
                {result.competitorRanking.slice(0, 6).map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: c.isBrand ? 'rgba(243,109,50,0.1)' : 'transparent' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.isBrand ? colors.ember : 'rgba(247,240,234,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: fonts.displayXBold, fontSize: 11, color: c.isBrand ? '#fff' : colors.textFaint }}>{i + 1}</Text>
                    </View>
                    <Text style={{ flex: 1, fontFamily: fonts.bodySemi, fontSize: 12.5, color: c.isBrand ? colors.emberLite : colors.text }} numberOfLines={1}>
                      {c.name}{c.isBrand ? '  (siz)' : ''}
                    </Text>
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: c.isBrand ? colors.emberLite : colors.textDim }}>%{c.pct}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* GEO Roadmap (genel yönlendirme) */}
          <View style={{ marginTop: 18, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: 'rgba(243,109,50,0.25)', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
              <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="geo" size={14} color="#fff" strokeWidth={2} />
              </LinearGradient>
              <View>
                <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13.5, color: '#fff' }}>GEO Roadmap</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 10.5, color: colors.textFaint }}>{t.vis_road_sub}</Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: 15, paddingVertical: 12, gap: 9 }}>
              {t.road.map((r, i) => {
                const easy = r.eff === 'KOLAY' || r.eff === 'EASY';
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(243,109,50,0.14)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10, color: colors.emberLite }}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12.5, color: '#fff' }}>{r.title}</Text>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: easy ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)' }}>
                          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8, letterSpacing: 0.8, color: easy ? colors.good : colors.warn }}>{r.eff}</Text>
                        </View>
                      </View>
                      <Text style={{ fontFamily: fonts.body, fontSize: 11, lineHeight: 16.5, color: colors.textMute, marginTop: 2 }}>{r.why}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

/* Alıntı oranı halkası (skor kartı sağı) */
function RateRing({ pct }: { pct: number }) {
  const size = 66;
  const r = 27;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.25)" strokeWidth={6} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#fff" strokeWidth={6} fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </Svg>
      <Text style={{ fontFamily: fonts.displayXBold, fontSize: 15, color: '#fff' }}>%{pct}</Text>
    </View>
  );
}
