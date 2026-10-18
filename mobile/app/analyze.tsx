import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii, paper, type } from '../src/theme';
import { Orb, Icon, EmberButton, ScreenBg, VendorLogo, DomainFavicon } from '../src/components';
import { subscribeCitation, PROVIDER_META, SUBSCRIBE_CONSENT_REQUIRED, type AnalyzeResult } from '../src/api';
import { useAnalysis } from '../src/store';
import { deriveVisibility, isShown, measuredProviders } from '../src/visibility';
import { openLegal } from '../src/legal';

/* Açık "rapor" paleti artık src/theme.ts'te (paper) — ekran-içi kopya kaldırıldı */
const R = paper;

export default function Analyze() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ domain?: string }>();
  const { result, loading, error, run: runAnalysis } = useAnalysis();
  const [domain, setDomain] = useState(params.domain ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const runFor = async (raw: string) => {
    const d = raw.trim();
    if (d.length < 3) { setLocalError('Bir alan adı gir (ör. siteniz.com)'); return; }
    setLocalError(null);
    Keyboard.dismiss();
    await runAnalysis(d);
  };
  const run = () => runFor(domain);

  // ?domain=... ile açıldıysa otomatik analiz et (deep link)
  const autoRan = useRef(false);
  useEffect(() => {
    if (params.domain && !autoRan.current) {
      autoRan.current = true;
      runFor(params.domain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.domain]);

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
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 17, color: '#fff' }}>Site analizi</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Arama alanı (koyu app çerçevesi) */}
        <View style={{ marginTop: 6 }}>
          <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
            <Icon name="globe" size={16} color={colors.emberLite} strokeWidth={2} />
            <TextInput
              value={domain}
              onChangeText={setDomain}
              onSubmitEditing={run}
              placeholder="siteniz.com"
              placeholderTextColor="rgba(247,240,234,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              style={{ flex: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 14 }}
            />
          </View>
          <EmberButton label={loading ? 'Analiz ediliyor…' : 'AI görünürlüğünü analiz et'} onPress={run} style={{ marginTop: 10 }} />
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.5, color: colors.textFaint, marginTop: 10, textAlign: 'center' }}>
            6 AI MOTORUNDA GERÇEK ÖLÇÜM · api.ranksup.ai
          </Text>
        </View>

        {/* Yükleniyor */}
        {loading && (
          <View style={{ alignItems: 'center', paddingVertical: 44 }}>
            <Orb size={58} />
            <ActivityIndicator color={colors.ember} style={{ marginTop: 20 }} />
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMute, marginTop: 14 }}>6 AI motorunda taranıyor…</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textFaint, marginTop: 4 }}>ilk analiz ~30-60 sn sürebilir</Text>
          </View>
        )}

        {/* Hata */}
        {(localError || error) && !loading && (
          <View style={{ marginTop: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: 'rgba(251,113,133,0.35)', backgroundColor: 'rgba(251,113,133,0.08)', padding: 14, flexDirection: 'row', gap: 10 }}>
            <Text style={{ color: colors.crit, fontSize: 16 }}>!</Text>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.text }}>{localError || error}</Text>
          </View>
        )}

        {/* Sonuç — açık rapor kartı */}
        {result && !loading && <ResultCard result={result} />}
      </ScrollView>
    </View>
  );
}

/* ══════════════ Sonuç kartı (web'deki ai-visibility-checker — açık zemin) ══════════════ */
/**
 * Kilitli sorular (ücretsiz testte ölçülmeyenler) kilitli kart olarak çizilir:
 * "0/N" sayısı ve asistan kutucuğu YOK — ölçülmemiş soru 0 puan almış gibi
 * görünmesin. Ölçülmeyen asistan (measured:false ya da hiç gönderilmemiş) kutucuk
 * ve paydaya girmez. Marka adı geçen soru nötr renkte, "markalı soru" etiketiyle
 * gösterilir; skora katılmaz (src/visibility.ts — web summarize() ile aynı).
 * Kilit açma çağrısı (plan satın alma) uygulamada yoktur: App Store 3.1.1(a)
 * uygulama dışı satın almaya yönlendiren düğme/bağlantıyı yasaklar.
 */
function ResultCard({ result }: { result: AnalyzeResult }) {
  const vis = deriveVisibility(result);
  const lockedCount = vis.lockedQueries;
  return (
    <View style={{ marginTop: 18, borderRadius: 22, backgroundColor: R.surface, padding: 16, borderWidth: 1, borderColor: R.lineSoft, shadowColor: R.ink, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 10 }}>
      {/* Marka özeti */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <DomainFavicon domain={result.domain} brand={result.brand} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 18, color: R.ink }} numberOfLines={1}>{result.brand || result.domain}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: R.inkFaint }}>{result.domain}</Text>
            {!!(result.customNiche || result.niche) && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: R.brandTint }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 9, color: R.emberDeep }}>{(result.customNiche || result.niche || '').toLocaleUpperCase('tr-TR')}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      {result.fromCache && (
        <Text style={{ ...type.micro, fontFamily: fonts.mono, letterSpacing: 0, color: R.inkFaint, marginTop: 10 }}>Sonuç önbellekten · 24 saat cache</Text>
      )}

      {/* Özet — Görünürlük sekmesiyle aynı skor */}
      {vis.totalPairs > 0 ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: R.card, borderWidth: 1, borderColor: R.line }}>
          <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, backgroundColor: vis.score > 0 ? R.goodBg : R.muted }}>
            <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: vis.score > 0 ? R.good : R.inkDim }}>%{vis.score}</Text>
          </View>
          <Text style={{ ...type.label, fontFamily: fonts.body, flex: 1, lineHeight: 17, color: R.inkDim }}>
            {vis.answeredQueries}/{vis.totalQueries} soruda en az bir AI asistanı markanı gösterdi
            {vis.basis === 'unbranded' && vis.brandedQueries > 0 ? ` · marka adı geçen ${vis.brandedQueries} soru skora katılmadı` : ''}.
          </Text>
        </View>
      ) : (
        <Text style={{ ...type.label, fontFamily: fonts.body, color: R.inkDim, marginTop: 12 }}>Bu sonuçta ölçülmüş soru yok, bu yüzden skor hesaplanmadı.</Text>
      )}

      <View style={{ height: 1, backgroundColor: R.line, marginVertical: 14 }} />

      {/* Sorular × asistanlar */}
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10.5, letterSpacing: 1.2, color: R.inkFaint, marginBottom: 10 }}>MARKANIZ BU AI CEVAPLARINDA GEÇTİ Mİ?</Text>
      <View style={{ gap: 10 }}>
        {result.queries.map((q, i) => {
          if (q.locked) {
            return (
              <View key={i} accessibilityLabel={`Kilitli soru: ${q.query}`} style={{ borderRadius: 16, backgroundColor: R.muted, borderWidth: 1, borderColor: R.line, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: R.line, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    <Icon name="lock" size={12} color={R.inkDim} strokeWidth={2.2} />
                  </View>
                  <Text style={{ ...type.filter, flex: 1, lineHeight: 18, color: R.inkDim }}>{q.query}</Text>
                </View>
                <Text style={{ ...type.label, fontFamily: fonts.body, color: R.inkFaint, marginTop: 8 }}>Bu soru ücretsiz testte ölçülmedi.</Text>
              </View>
            );
          }
          const providers = measuredProviders(q);
          const shown = providers.filter(isShown).length;
          const branded = !!q.brandInQuery;
          const excerpt = providers.find((p) => isShown(p) && p.excerpt)?.excerpt;
          return (
            <View key={i} style={{ borderRadius: 16, backgroundColor: R.card, borderWidth: 1, borderColor: R.line, padding: 14 }}>
              {/* Numaralı soru başlığı + sayaç (yalnız ölçülen asistanlar) */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: R.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                  <Text style={{ fontFamily: fonts.displayXBold, fontSize: 11, color: R.surface }}>{i + 1}</Text>
                </View>
                <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, flex: 1, color: R.ink }}>{q.query}</Text>
                <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: branded ? R.inkDim : shown > 0 ? R.good : R.inkFaint, marginTop: 1 }}>{shown}/{providers.length}</Text>
              </View>
              {branded && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: R.muted }}>
                    <Text style={{ ...type.micro, color: R.inkDim }}>MARKALI SORU</Text>
                  </View>
                  <Text style={{ ...type.label, fontFamily: fonts.body, color: R.inkFaint }}>Soruda marka adı geçiyor; skora katılmaz.</Text>
                </View>
              )}

              {/* Asistan rozetleri (gerçek logolar) — ölçülmeyen asistan gösterilmez */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 }}>
                {providers.map((p, j) => {
                  const meta = PROVIDER_META[p.provider];
                  const state: 'cited' | 'mentioned' | 'none' = p.cited ? 'cited' : p.brandMentioned ? 'mentioned' : 'none';
                  const tileBg = state === 'cited' ? R.goodBg : state === 'mentioned' ? R.warnBg : R.muted;
                  const ring = state === 'cited' ? R.goodRing : state === 'mentioned' ? R.warnRing : R.line;
                  const badgeBg = state === 'cited' ? R.good : state === 'mentioned' ? R.warn : 'rgba(34,23,17,0.32)';
                  const badgeSym = state === 'cited' ? '✓' : state === 'mentioned' ? '~' : '×';
                  return (
                    <View key={j} style={{ alignItems: 'center', gap: 5, width: 42 }}>
                      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: tileBg, borderWidth: state === 'none' ? 1 : 1.5, borderColor: ring, alignItems: 'center', justifyContent: 'center', opacity: state === 'none' ? 0.7 : 1 }}>
                        <VendorLogo provider={p.provider} size={24} />
                        <View style={{ position: 'absolute', bottom: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: badgeBg, borderWidth: 2, borderColor: R.card, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 8, color: R.card, lineHeight: 10 }}>{badgeSym}</Text>
                        </View>
                      </View>
                      <Text style={{ fontFamily: fonts.mono, fontSize: 7.5, letterSpacing: 0.2, color: state === 'none' ? R.inkFaint : R.inkDim }} numberOfLines={1}>
                        {(meta?.name ?? p.label ?? p.provider).toLocaleUpperCase('tr-TR')}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Alıntı örneği (varsa) */}
              {!!excerpt && (
                <View style={{ marginTop: 12, borderLeftWidth: 2, borderLeftColor: R.goodRing, paddingLeft: 10 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, lineHeight: 17, color: R.inkDim, fontStyle: 'italic' }} numberOfLines={3}>
                    “{excerpt}”
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Kilit özeti — satın alma çağrısı yok (3.1.1(a)) */}
      {lockedCount > 0 && (
        <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 17, color: R.inkFaint, marginTop: 10 }}>
          Ücretsiz testte {result.access?.unlockedQueries ?? result.queries.length - lockedCount} soru ölçüldü; {lockedCount} soru kilitli ve skora katılmadı.
        </Text>
      )}

      {/* Rakip sıralaması */}
      {result.competitorRanking.length > 0 && (
        <>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 10.5, letterSpacing: 1.2, color: R.inkFaint, marginTop: 20, marginBottom: 10 }}>AI CEVAPLARINDA KİM ÖNE ÇIKIYOR?</Text>
          <View style={{ borderRadius: 16, backgroundColor: R.card, borderWidth: 1, borderColor: R.line, padding: 6 }}>
            {result.competitorRanking.slice(0, 8).map((c, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: c.isBrand ? R.brandTint : 'transparent' }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: c.isBrand ? R.ember : 'rgba(34,23,17,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.displayXBold, fontSize: 11, color: c.isBrand ? R.card : R.inkFaint }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.isBrand ? R.emberDeep : R.ink }} numberOfLines={1}>
                    {c.name}{c.isBrand ? '  (siz)' : ''}
                  </Text>
                  <View style={{ height: 4, borderRadius: radii.pill, backgroundColor: 'rgba(34,23,17,0.07)', overflow: 'hidden', marginTop: 6 }}>
                    <View style={{ height: '100%', borderRadius: radii.pill, width: `${Math.max(3, c.pct)}%`, backgroundColor: c.isBrand ? R.ember : R.info }} />
                  </View>
                </View>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: c.isBrand ? R.emberDeep : R.inkDim }}>%{c.pct}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* 90 gün takip CTA'sı */}
      <TrackCta result={result} />

      <Text style={{ ...type.micro, fontFamily: fonts.mono, letterSpacing: 0, color: R.inkFaint, marginTop: 14, textAlign: 'center' }}>
        {result.totalLlmCalls} AI çağrısı
      </Text>
    </View>
  );
}

/* ══════════════ 90 gün takip aboneliği (web'deki e-posta yakalama) ══════════════ */
/**
 * Onay kutusu başlangıçta BOŞ ve "Takip et" işaretlenene kadar kapalı; sunucuya
 * kutunun gerçek değeri gider (eskiden sabit consent:true gidiyordu, yani hiç
 * gösterilmeyen bir onay "verilmiş" sayılıyordu). Metin web'deki onay satırıyla
 * aynı; KVKK aydınlatma metni bağlantısı yanında. Akış sunucudaki gerçek
 * davranışı anlatır: onaydan sonra 15/30/60/90. günde yeniden test + e-posta
 * raporu (public-citation-subscriber.service.ts RETEST_INTERVALS_DAYS).
 */
function TrackCta({ result }: { result: AnalyzeResult }) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailOk && consent && status !== 'busy';

  const submit = async () => {
    const e = email.trim();
    if (!emailOk) { setStatus('err'); setMsg('Geçerli bir e-posta gir.'); return; }
    if (!consent) { setStatus('err'); setMsg(SUBSCRIBE_CONSENT_REQUIRED); return; }
    Keyboard.dismiss();
    setStatus('busy'); setMsg('');
    try {
      const r = await subscribeCitation({
        email: e,
        domain: result.domain,
        brand: result.brand,
        niche: result.niche,
        customNiche: result.customNiche,
        locale: 'tr',
        consent,
      });
      setStatus('done');
      setMsg(r.alreadyActive ? 'Zaten takip listesindesiniz.' : 'Onay e-postası gönderildi — gelen kutunu kontrol et.');
    } catch (err: any) {
      setStatus('err');
      setMsg(err?.message ?? 'Abonelik başarısız.');
    }
  };

  return (
    <LinearGradient
      colors={[R.ember, R.emberDeep]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ marginTop: 20, borderRadius: 18, padding: 16 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="sparkle" size={15} color={R.card} strokeWidth={2} />
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: R.card }}>90 gün boyunca takip et</Text>
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.88)' }}>
        E-postanı onayladıktan sonra markanı 15, 30, 60 ve 90. günlerde 6 AI asistanında yeniden test edip her raporu e-postayla gönderelim.
      </Text>

      {status === 'done' ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 12 }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: R.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={12} color={R.emberDeep} strokeWidth={3} />
          </View>
          <Text style={{ ...type.label, fontFamily: fonts.bodySemi, flex: 1, color: R.card }}>{msg}</Text>
        </View>
      ) : (
        <>
          <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)' }}>
              <TextInput
                value={email}
                onChangeText={(v) => { setEmail(v); if (status === 'err') setStatus('idle'); }}
                onSubmitEditing={submit}
                placeholder="e-posta adresin"
                placeholderTextColor="rgba(34,23,17,0.4)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="go"
                editable={status !== 'busy'}
                accessibilityLabel="E-posta adresin"
                style={{ ...type.filter, fontFamily: fonts.body, flex: 1, color: R.ink }}
              />
            </View>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              style={({ pressed }) => ({ height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: R.ink, alignItems: 'center', justifyContent: 'center', opacity: !canSubmit ? 0.45 : pressed ? 0.8 : 1 })}
            >
              {status === 'busy'
                ? <ActivityIndicator color={R.card} size="small" />
                : <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: R.card }}>Takip et</Text>}
            </Pressable>
          </View>

          {/* Açık rıza — başlangıçta işaretsiz (KVKK) */}
          <Pressable
            onPress={() => { setConsent((v) => !v); if (status === 'err') setStatus('idle'); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            hitSlop={6}
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: R.card, backgroundColor: consent ? R.card : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {consent && <Icon name="check" size={12} color={R.emberDeep} strokeWidth={3} />}
            </View>
            <Text style={{ ...type.label, fontFamily: fonts.body, flex: 1, lineHeight: 17, color: R.card }}>
              Bu e-postaları almayı kabul ediyorum (KVKK uyumlu, istediğin zaman iptal).
            </Text>
          </Pressable>
          <Pressable onPress={() => openLegal('kvkk')} accessibilityRole="link" hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 6, marginLeft: 29 }}>
            <Text style={{ ...type.label, color: R.card, textDecorationLine: 'underline' }}>KVKK Aydınlatma Metni</Text>
          </Pressable>

          {status === 'err' && <Text style={{ ...type.label, fontFamily: fonts.bodySemi, color: R.card, marginTop: 8 }}>{msg}</Text>}
          <Text style={{ ...type.micro, fontFamily: fonts.mono, letterSpacing: 0, color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
            Onay e-postası göndeririz · istediğin an çıkabilirsin
          </Text>
        </>
      )}
    </LinearGradient>
  );
}
