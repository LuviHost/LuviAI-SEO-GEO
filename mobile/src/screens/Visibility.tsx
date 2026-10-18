import React, { useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii, type } from '../theme';
import { useLang } from '../i18n';
import { Icon, T, VendorLogo, DomainFavicon, EmberButton, Orb } from '../components';
import { useAnalysis, deriveVisibility } from '../store';

/**
 * AI görünürlük paneli — son analiz sonucundan türetilir (src/visibility.ts).
 * Skor web landing'deki summarize() ile aynı tanımdır: kilitli sorular, marka adı
 * geçen sorular ve ölçülmeyen asistanlar skora ve paydalara girmez. Eskiden mobil
 * kilitli soruları "0/7" sayıp ölçülmeyen Meta'yı "0%" gösteriyordu; web ile aynı
 * sonuç için farklı skor çıkıyordu.
 */
export function VisibilityScreen() {
  const { t } = useLang();
  const router = useRouter();
  const { result, domain, loading } = useAnalysis();

  const vis = useMemo(() => (result ? deriveVisibility(result) : null), [result]);
  // OS "hareketi azalt" acikken giris animasyonlari hic verilmez
  const reduced = useReducedMotion();

  const excluded = vis ? t.vis_excluded(vis.lockedQueries, vis.basis === 'unbranded' ? vis.brandedQueries : 0) : '';

  return (
    <View>
      <Text accessibilityRole="header" style={[T.display(24), { marginTop: 6 }]}>{t.vis_title}</Text>
      <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute, marginTop: 2, marginBottom: 14 }}>{t.vis_sub}</Text>

      {/* Yükleniyor */}
      {loading && !result && (
        <View style={{ alignItems: 'center', paddingVertical: 40, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
          <Orb size={52} />
          <ActivityIndicator color={colors.ember} style={{ marginTop: 18 }} />
          <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute, marginTop: 12 }}>{t.vis_loading(domain ?? '')}</Text>
        </View>
      )}

      {/* Boş durum — henüz analiz yok */}
      {!result && !loading && (
        <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 20, alignItems: 'center' }}>
          <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="tabVis" size={22} color={colors.text} strokeWidth={2} />
          </LinearGradient>
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: colors.text, marginTop: 14, textAlign: 'center' }}>{t.vis_empty_title}</Text>
          <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute, marginTop: 6, textAlign: 'center' }}>
            {t.vis_empty_body}
          </Text>
          <EmberButton label={t.vis_empty_cta} onPress={() => router.push('/analyze')} style={{ marginTop: 16, alignSelf: 'stretch' }} height={46} />
        </View>
      )}

      {/* Gerçek görünürlük — analiz sonucundan türetildi */}
      {vis && result && (
        <>
          {/* Alan adı başlığı */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <DomainFavicon domain={result.domain} brand={result.brand} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }} numberOfLines={1}>{result.brand || result.domain}</Text>
              <Text style={{ ...type.data, color: colors.textFaint }}>{t.vis_snapshot}</Text>
            </View>
            <Pressable onPress={() => router.push('/analyze')} hitSlop={8} accessibilityRole="button" style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.emberLite }}>{t.refresh}</Text>
            </Pressable>
          </View>

          {vis.totalPairs === 0 ? (
            /* Ölçülmüş soru yok (hepsi kilitli ya da asistanlar ölçülemedi) — 0 skoru göstermek yanlış olurdu */
            <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, gap: 6 }}>
              <Text style={{ ...type.filter, color: colors.text }}>{t.vis_no_measured}</Text>
              {!!excluded && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute }}>{excluded}</Text>}
            </View>
          ) : (
            <>
              {/* Skor kartı */}
              <LinearGradient colors={[colors.ember, colors.emberMid, colors.emberDeep]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, padding: 18, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', top: -46, right: -34, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.micro, letterSpacing: 2, color: 'rgba(255,255,255,0.85)' }}>{t.vis_score}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                      <Text style={{ fontFamily: fonts.displayXBold, fontSize: 46, color: colors.text, lineHeight: 48, letterSpacing: -1.8 }}>{vis.score}</Text>
                      <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: 'rgba(255,255,255,0.7)', marginBottom: 7 }}>/100</Text>
                    </View>
                    <Text style={{ ...type.label, fontFamily: fonts.body, color: 'rgba(255,255,255,0.92)', marginTop: 6 }}>
                      {t.vis_answered(vis.answeredQueries, vis.totalQueries)}
                    </Text>
                    {vis.basis === 'all' && vis.brandedQueries > 0 && (
                      <Text style={{ ...type.label, fontFamily: fonts.body, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{t.vis_all_branded}</Text>
                    )}
                    {!!excluded && (
                      <Text style={{ ...type.label, fontFamily: fonts.body, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{excluded}</Text>
                    )}
                  </View>
                  {/* Görünürlük oranı halkası */}
                  <RateRing pct={vis.score} />
                </View>
              </LinearGradient>

              {/* Asistan bazında — yalnız ölçülen asistanlar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
                <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.vis_engines}</Text>
                <Text style={{ ...type.data, color: colors.textFaint }}>{t.vis_pairs(vis.shownPairs, vis.totalPairs)}</Text>
              </View>
              <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textFaint, marginTop: 2, marginBottom: 10 }}>{t.vis_engines_note}</Text>

              <View style={{ gap: 8 }}>
                {vis.engines.map((e, motorIdx) => {
                  const barW = `${Math.max(3, e.rate)}%` as const;
                  return (
                    <Animated.View
                      key={e.provider}
                      entering={reduced ? undefined : FadeInDown.duration(400).delay(motorIdx * 60)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 11, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
                      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
                        <VendorLogo provider={e.provider} size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{e.name}</Text>
                          <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: e.shown > 0 ? colors.good : colors.textGhost }}>
                            {e.shown}/{e.total}
                          </Text>
                        </View>
                        <View style={{ height: 4, borderRadius: radii.pill, backgroundColor: 'rgba(247,240,234,0.07)', overflow: 'hidden' }}>
                          <View style={{ height: '100%', borderRadius: radii.pill, backgroundColor: e.shown > 0 ? e.color : 'rgba(247,240,234,0.18)', width: barW }} />
                        </View>
                      </View>
                    </Animated.View>
                  );
                })}
              </View>
            </>
          )}

          {/* Rakip sıralaması (gerçek) */}
          {result.competitorRanking.length > 0 && (
            <>
              <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 18, marginBottom: 10 }}>{t.vis_comp_title}</Text>
              <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 6 }}>
                {result.competitorRanking.slice(0, 6).map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: c.isBrand ? 'rgba(243,109,50,0.1)' : 'transparent' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.isBrand ? colors.ember : 'rgba(247,240,234,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ ...type.data, fontFamily: fonts.displayXBold, color: c.isBrand ? colors.text : colors.textFaint }}>{i + 1}</Text>
                    </View>
                    <Text style={{ ...type.filter, flex: 1, color: c.isBrand ? colors.emberLite : colors.text }} numberOfLines={1}>
                      {c.name}{c.isBrand ? `  ${t.vis_you}` : ''}
                    </Text>
                    <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: c.isBrand ? colors.emberLite : colors.textDim }}>%{c.pct}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Genel öneriler — statik, her site için geçerli; sonuca özelmiş gibi sunulmaz */}
          <View style={{ marginTop: 18, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: 'rgba(243,109,50,0.25)', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
              <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="geo" size={14} color={colors.text} strokeWidth={2} />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.vis_road_title}</Text>
                <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textFaint }}>{t.vis_road_sub}</Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: 15, paddingVertical: 12, gap: 9 }}>
              {t.road.map((r, i) => {
                const easy = r.eff === 'KOLAY' || r.eff === 'EASY';
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(243,109,50,0.14)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                      <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.emberLite }}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{r.title}</Text>
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: easy ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)' }}>
                          <Text style={{ ...type.micro, letterSpacing: 0.8, color: easy ? colors.good : colors.warn }}>{r.eff}</Text>
                        </View>
                      </View>
                      <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 17, color: colors.textMute, marginTop: 2 }}>{r.why}</Text>
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

/* Görünürlük oranı halkası (skor kartı sağı) */
function RateRing({ pct }: { pct: number }) {
  const size = 66;
  const r = 27;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.25)" strokeWidth={6} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.text} strokeWidth={6} fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </Svg>
      <Text style={{ ...type.filter, fontFamily: fonts.displayXBold, color: colors.text }}>%{pct}</Text>
    </View>
  );
}
