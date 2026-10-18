import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Keyboard, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radii, type } from '../theme';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import {
  asoSearch,
  getAsaPerformance,
  getAsoApp,
  listAsaAccounts,
  listAsoApps,
  type AsaPerformanceSummary,
  type AsoApp,
  type AsoAppDetail,
  type AsoTrackedApp,
} from '../api';
import {
  API_STORE,
  detailMatches,
  hasStore,
  keywordsForStore,
  latestCheck,
  latestDataDay,
  pickAppId,
  rankDelta,
  rankLabel,
  storeRating,
  unrankedReason,
  type StoreTab,
} from '../aso-live';
import { formatDate, formatDecimal, formatInt, formatPercent } from '../format';
import { Icon, T } from '../components';

/** Liste kısa tutulur; tam tablo web panelinde */
const KW_LIMIT = 15;

/**
 * ASO sekmesi (F18). Eskiden bağlı kullanıcıya "Canlı arama" rozeti altında sabit
 * bir skor (78/71, "+5 bu hafta"), "Metadata 92 · Görsel 71 · Yorum 68", sabit
 * anahtar kelime sıraları, "247 KW", uydurma Apple Search Ads rakamları, "Auto-Pilot
 * dün 2 keyword durdurdu" notu ve sunucuya hiçbir şey göndermeyen bir AUTO-PILOT
 * anahtarı gösteriyordu. Artık:
 *  - bağlıysa: GET /sites/:id/aso/apps, /aso/apps/:appId ve (bağlı ASA hesabı
 *    varsa, yalnız App Store sekmesinde) /aso/asa/performance — veri yoksa boş durum;
 *  - bağlı değilse: ne göreceğini anlatan açıklama + hesap bağlama (örnek sayı yok).
 */
export function AsoScreen() {
  const { t } = useLang();
  const { connected, token, activeSite } = useAuth();
  const router = useRouter();

  return (
    <View>
      <Text accessibilityRole="header" style={[T.display(24), { marginTop: 6 }]}>ASO</Text>
      <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute, marginTop: 2, marginBottom: 12 }}>{t.aso_sub}</Text>

      {!connected || !token ? (
        <SignedOut onConnect={() => router.push('/connect')} />
      ) : !activeSite ? (
        <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute }}>{t.aso_no_site}</Text>
      ) : (
        <LiveAso token={token} siteId={activeSite.id} siteName={activeSite.name} />
      )}
    </View>
  );
}

/* ══════════════ Bağlı değil — açıklama, örnek veri yok ══════════════ */
function SignedOut({ onConnect }: { onConnect: () => void }) {
  const { t } = useLang();
  return (
    <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 16 }}>
      <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.aso_out_title}</Text>
      <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textDim, marginTop: 6 }}>{t.aso_out_body}</Text>
      <Pressable
        onPress={onConnect}
        accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: 14, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: radii.md, borderWidth: 1, borderColor: colors.lineStrong, opacity: pressed ? 0.8 : 1 })}
      >
        <Icon name="user" size={14} color={colors.emberLite} strokeWidth={2} />
        <Text style={{ ...type.filter, color: colors.text }}>{t.aso_out_cta}</Text>
      </Pressable>
    </View>
  );
}

/* ══════════════ Bağlı — gerçek veri ══════════════ */
function LiveAso({ token, siteId, siteName }: { token: string; siteId: string; siteName: string }) {
  const { t, lang } = useLang();
  const [store, setStore] = useState<StoreTab>('ios');

  // Takip edilen uygulamalar
  const [apps, setApps] = useState<AsoTrackedApp[] | null>(null);
  const [appsErr, setAppsErr] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AsoAppDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Apple Search Ads — yalnız bağlı ve aktif hesap varsa
  const [asa, setAsa] = useState<{ perf: AsaPerformanceSummary | null; err: string | null } | null>(null);
  // Site değişince eski isteklerin cevabı yeni sitenin üstüne yazılmasın
  const siteRef = useRef(siteId);
  useEffect(() => {
    siteRef.current = siteId;
  }, [siteId]);
  // Hızlı uygulama değişiminde geç gelen detay/hata yeni seçimin üstüne yazılmasın
  const detailReq = useRef(0);

  const loadApps = useCallback(async () => {
    const forSite = siteId;
    setAppsErr(null);
    try {
      const list = await listAsoApps(token, forSite);
      if (siteRef.current !== forSite) return;
      setApps(list);
      setAppId((cur) => pickAppId(list, cur));
    } catch (e: any) {
      if (siteRef.current !== forSite) return;
      setAppsErr(String(e?.message ?? ''));
    }
  }, [token, siteId]);

  const loadAsa = useCallback(async () => {
    const forSite = siteId;
    try {
      const accounts = await listAsaAccounts(token, forSite);
      if (siteRef.current !== forSite) return;
      if (!accounts.some((a) => a.isActive)) {
        setAsa(null); // bağlı hesap yok → kart hiç çizilmez
        return;
      }
      const perf = await getAsaPerformance(token, forSite, 30);
      if (siteRef.current !== forSite) return;
      setAsa({ perf, err: null });
    } catch (e: any) {
      if (siteRef.current !== forSite) return;
      setAsa({ perf: null, err: String(e?.message ?? '') });
    }
  }, [token, siteId]);

  useEffect(() => {
    setApps(null);
    setAppId(null);
    setDetail(null);
    setAsa(null);
    loadApps();
    loadAsa();
  }, [loadApps, loadAsa]);

  const loadDetail = useCallback(async (id: string) => {
    const req = ++detailReq.current;
    setDetailErr(null);
    try {
      const d = await getAsoApp(token, siteId, id);
      if (req === detailReq.current) setDetail(d);
    } catch (e: any) {
      if (req === detailReq.current) setDetailErr(String(e?.message ?? ''));
    }
  }, [token, siteId]);

  useEffect(() => {
    if (appId) loadDetail(appId);
  }, [appId, loadDetail]);

  const app = apps?.find((a) => a.id === appId) ?? null;
  const current = detailMatches(detail, appId) ? detail : null;
  const keywords = current ? keywordsForStore(current.keywords ?? [], store) : [];
  const lastCheck = latestCheck(keywords);

  return (
    <View>
      {/* Hangi sitenin verisi — "canlı" iddiası yok, sıralar son ölçüm tarihini taşır */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', marginBottom: 14 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.good }} />
        <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.good }} numberOfLines={1}>{t.aso_pill(siteName)}</Text>
      </View>

      {/* Mağaza seçimi */}
      <View style={{ flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, marginBottom: 16 }}>
        {(['ios', 'play'] as StoreTab[]).map((s) => {
          const on = store === s;
          const label = s === 'ios' ? 'App Store' : 'Google Play';
          return (
            <Pressable key={s} onPress={() => setStore(s)} style={{ flex: 1 }} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              {on ? (
                <LinearGradient colors={[colors.ember, colors.emberDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={seg}>
                  <Text style={{ ...type.label, fontFamily: fonts.bodyBold, color: colors.text }}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={seg}>
                  <Text style={{ ...type.label, fontFamily: fonts.bodyBold, color: colors.textMute }}>{label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Takip edilen uygulamalar */}
      <SectionTitle title={t.aso_apps_title} />
      {appsErr !== null && !apps ? (
        <ErrorRow message={appsErr} onRetry={loadApps} />
      ) : !apps ? (
        <Loading />
      ) : apps.length === 0 ? (
        <Muted text={t.aso_apps_empty} />
      ) : (
        <>
          {apps.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
              {apps.map((a) => {
                const on = a.id === appId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setAppId(a.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: on ? colors.ember : colors.lineStrong, backgroundColor: on ? 'rgba(243,109,50,0.14)' : 'transparent' }}
                  >
                    <Text style={{ ...type.label, fontFamily: fonts.bodyBold, color: on ? colors.emberLite : colors.textMute }} numberOfLines={1}>{a.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {app && <AppCard app={app} store={store} keywordCount={current ? keywords.length : null} />}
        </>
      )}

      {/* Anahtar kelime sıraları — seçili uygulama + mağaza */}
      {app && hasStore(app, store) && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 10 }}>
            <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.aso_kw_title}</Text>
            {current && <Text style={{ ...type.data, color: colors.textFaint }}>{t.aso_kw_count(formatInt(keywords.length, lang))}</Text>}
          </View>
          {detailErr !== null && !current ? (
            <ErrorRow message={detailErr} onRetry={() => appId && loadDetail(appId)} />
          ) : !current ? (
            <Loading />
          ) : keywords.length === 0 ? (
            <Muted text={t.aso_kw_empty} />
          ) : (
            <>
              <View style={{ gap: 8 }}>
                {keywords.slice(0, KW_LIMIT).map((k) => {
                  const d = rankDelta(k);
                  const top = k.currentRank != null && k.currentRank <= 3;
                  const reason = unrankedReason(k, lang);
                  return (
                    <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
                      <View
                        accessibilityLabel={reason ?? rankLabel(k)}
                        style={{ minWidth: 40, paddingVertical: 5, borderRadius: 9, backgroundColor: top ? colors.text : 'rgba(247,240,234,0.07)', alignItems: 'center' }}
                      >
                        <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: top ? colors.bg : colors.text }}>{rankLabel(k)}</Text>
                      </View>
                      <Text style={{ ...type.filter, flex: 1, color: colors.text }} numberOfLines={1}>{k.keyword}</Text>
                      {d != null && (
                        <Text
                          accessibilityLabel={d === 0 ? (lang === 'tr' ? 'Değişmedi' : 'No change') : undefined}
                          style={{ ...type.data, fontFamily: fonts.monoSemi, minWidth: 32, textAlign: 'right', color: d > 0 ? colors.good : d < 0 ? colors.crit : colors.textFaint }}
                        >
                          {d > 0 ? `↑${d}` : d < 0 ? `↓${Math.abs(d)}` : '–'}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {keywords.length > KW_LIMIT && <Muted text={t.aso_kw_more(keywords.length - KW_LIMIT)} style={{ marginTop: 8 }} />}
              <Muted text={lastCheck ? t.aso_kw_last(formatDate(lastCheck, lang)) : t.aso_kw_never} style={{ marginTop: 8 }} />
              <Muted text={t.aso_kw_legend} style={{ marginTop: 2 }} />
            </>
          )}
        </>
      )}

      {/* Apple Search Ads — yalnız App Store'da ve yalnız bağlı aktif hesap varsa */}
      {store === 'ios' && asa && <AsaCard perf={asa.perf} error={asa.err} onRetry={loadAsa} />}

      {/* Mağazada uygulama arama (iTunes / Google Play — canlı arama) */}
      <StoreSearch token={token} siteId={siteId} store={store} />
    </View>
  );
}

/* Seçili uygulamanın kartı: ad, geliştirici, seçili mağazadaki puan ve yorum sayısı */
function AppCard({ app, store, keywordCount }: { app: AsoTrackedApp; store: StoreTab; keywordCount: number | null }) {
  const { t, lang } = useLang();
  const linked = hasStore(app, store);
  const { rating, count, countKind } = storeRating(app, store);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
      <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(247,240,234,0.06)', overflow: 'hidden' }}>
        {!!app.iconUrl && <Image source={{ uri: app.iconUrl }} style={{ width: 46, height: 46 }} accessibilityIgnoresInvertColors />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }} numberOfLines={1}>{app.name}</Text>
        {!!app.developer && <Text style={{ ...type.data, color: colors.textFaint }} numberOfLines={1}>{app.developer}</Text>}
        {!linked ? (
          <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textMute, marginTop: 3 }}>
            {store === 'ios' ? t.aso_store_missing_ios : t.aso_store_missing_play}
          </Text>
        ) : (
          <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.textDim, marginTop: 3 }}>
            {rating != null ? `★ ${formatDecimal(rating, lang)}` : t.aso_no_rating}
            {count != null ? ` · ${(countKind === 'ratings' ? t.aso_ratings : t.aso_reviews)(formatInt(count, lang))}` : ''}
            {keywordCount != null ? ` · ${t.aso_kw_count(formatInt(keywordCount, lang))}` : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

/* Apple Search Ads toplamları — günlük cron'un yazdığı son 30 gün; para birimi belirsiz olduğu için harcama yok */
function AsaCard({ perf, error, onRetry }: { perf: AsaPerformanceSummary | null; error: string | null; onRetry: () => void }) {
  const { t, lang } = useLang();
  const lastDay = perf ? latestDataDay(perf.dailyRows ?? []) : null;
  return (
    <View style={{ marginTop: 16, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>Apple Search Ads</Text>
        <Text style={{ ...type.data, color: colors.textFaint }}>{t.asa_period}</Text>
      </View>
      {error !== null ? (
        <ErrorRow message={error} onRetry={onRetry} />
      ) : !perf ? (
        <Loading />
      ) : (perf.dailyRows ?? []).length === 0 ? (
        <Muted text={t.asa_empty} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AsaMetric k={t.asa_imp} v={formatInt(perf.totals.impressions, lang)} />
            <AsaMetric k={t.asa_tap} v={formatInt(perf.totals.taps, lang)} />
            <AsaMetric k={t.asa_inst} v={formatInt(perf.totals.installs, lang)} />
            <AsaMetric k={t.asa_cr} v={perf.totals.taps > 0 ? formatPercent(perf.totals.conversionRate, lang) : '—'} />
          </View>
          {lastDay && <Muted text={t.asa_last_day(formatDate(lastDay, lang))} style={{ marginTop: 10 }} />}
        </>
      )}
    </View>
  );
}

function AsaMetric({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ ...type.micro, color: colors.textFaint }} numberOfLines={1}>{k}</Text>
      <Text style={{ ...type.metric, fontFamily: fonts.displayBold, color: colors.text, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
    </View>
  );
}

/* Mağazada canlı uygulama araması — mevcut uç (GET /sites/:id/aso/search) */
function StoreSearch({ token, siteId, store }: { token: string; siteId: string; store: StoreTab }) {
  const { t, lang } = useLang();
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AsoApp[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Mağaza değişince eski mağazanın sonuçları kalmasın
  useEffect(() => {
    setResults(null);
    setErr(null);
  }, [store]);

  const doSearch = async () => {
    const q = term.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true); setErr(null); setResults(null);
    try {
      setResults(await asoSearch(token, siteId, q, API_STORE[store], 'tr'));
    } catch (e: any) {
      setErr(e?.message || t.load_error);
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={{ marginTop: 20 }}>
      <SectionTitle title={t.aso_search_title} />
      <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineStrong }}>
        <Icon name="search" size={15} color={colors.emberLite} strokeWidth={2} />
        <TextInput
          value={term}
          onChangeText={(v) => { setTerm(v); if (err) setErr(null); }}
          onSubmitEditing={doSearch}
          placeholder={store === 'ios' ? t.aso_search_ios : t.aso_search_play}
          placeholderTextColor={colors.textGhost}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          editable={!searching}
          accessibilityLabel={store === 'ios' ? t.aso_search_ios : t.aso_search_play}
          style={{ ...type.filter, fontFamily: fonts.body, flex: 1, color: colors.text }}
        />
        <Pressable onPress={doSearch} disabled={searching} hitSlop={6} accessibilityRole="button">
          {searching ? <ActivityIndicator color={colors.ember} size="small" /> : <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.emberLite }}>{t.aso_search_btn}</Text>}
        </Pressable>
      </View>
      {err && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit, marginTop: 8 }}>{err}</Text>}
      {results && results.length > 0 && (
        <View style={{ gap: 8, marginTop: 10 }}>
          {results.slice(0, 6).map((a, i) => (
            <View key={a.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(247,240,234,0.06)', overflow: 'hidden' }}>
                {!!a.icon && <Image source={{ uri: a.icon }} style={{ width: 40, height: 40 }} accessibilityIgnoresInvertColors />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }} numberOfLines={1}>{a.name}</Text>
                <Text style={{ ...type.data, color: colors.textFaint }} numberOfLines={1}>{a.developer ?? ''}</Text>
              </View>
              {typeof a.rating === 'number' && (
                <Text style={{ ...type.data, fontFamily: fonts.monoSemi, color: colors.warn }}>★ {formatDecimal(a.rating, lang)}</Text>
              )}
            </View>
          ))}
        </View>
      )}
      {results && results.length === 0 && !err && <Muted text={t.aso_no_results} style={{ marginTop: 10 }} />}
    </View>
  );
}

/* ── küçük yardımcılar ── */
const seg = { height: 34, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const };

function SectionTitle({ title }: { title: string }) {
  return <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text, marginBottom: 10 }}>{title}</Text>;
}

function Muted({ text, style }: { text: string; style?: { marginTop?: number } }) {
  return <Text style={[{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute }, style]}>{text}</Text>;
}

function Loading() {
  return (
    <View style={{ paddingVertical: 18, alignItems: 'center' }}>
      <ActivityIndicator color={colors.ember} />
    </View>
  );
}

/** message boşsa (sunucu metni yok) genel "alınamadı" metni — dil değişince yeniden istek atılmasın diye burada */
function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang();
  return (
    <View style={{ borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bgElev, padding: 12, gap: 6 }}>
      <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit }}>{message || t.load_error}</Text>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
        <Text style={{ ...type.data, color: colors.emberLite }}>{t.retry}</Text>
      </Pressable>
    </View>
  );
}
