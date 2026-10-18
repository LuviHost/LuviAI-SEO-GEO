import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, fonts, radii, type } from '../theme';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { getMyDashboard, listNotifications, type AppNotification, type MyDashboard } from '../api';
import { formatDateTime, formatInt } from '../format';
import { articleMetric } from '../article-quota';
import { Orb, Icon, EmberButton, Metric, T } from '../components';

/**
 * Ana sayfa (K7). Eskiden bu ekran statik bir maketti: "+12 citation", "−23% CPI",
 * "3 yeni keyword" cipleri, Onayla/Reddet dugmeleri yalniz yerel durumu degistiren
 * uydurma bir "ASA bid artisi" karti ve i18n'den gelen sahte bir akis. Artik:
 *  - hesap bagli degilse: urunun ne yaptigini anlatan durust giris + ucretsiz analiz
 *    ve hesap baglama cagrisi (hicbir sayi yok);
 *  - hesap bagliysa: GET /me/dashboard (web panelindeki hesap ozetiyle ayni sayilar)
 *    ve GET /notifications (tarama, olcum gibi gercek olaylar).
 * Onay/ret aksiyonu yok: mobilde bunu karsilayan bir API ucu yok.
 */
export function HomeScreen({ onOpenTab }: { onOpenTab?: (tab: 'vis' | 'aso') => void }) {
  const { connected } = useAuth();
  return connected ? <SignedInHome onOpenTab={onOpenTab} /> : <SignedOutHome />;
}

/* ══════════════ Hesap bağlı değil — dürüst giriş ══════════════ */
function SignedOutHome() {
  const { t } = useLang();
  const router = useRouter();

  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 18 }}>
        <Orb size={64} />
        <Kicker text={t.home_kicker} />
        <Text accessibilityRole="header" style={[T.display(23, colors.text, 'bold'), { textAlign: 'center', marginTop: 10, maxWidth: 300, lineHeight: 29 }]}>
          {t.home_title}
        </Text>
        <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 19, color: colors.textMute, textAlign: 'center', marginTop: 8, maxWidth: 330 }}>
          {t.home_sub}
        </Text>
        <EmberButton
          label={t.home_cta}
          onPress={() => router.push('/analyze')}
          iconRight={<Icon name="arrowRight" size={13} color={colors.text} strokeWidth={2.6} />}
          style={{ marginTop: 16, alignSelf: 'stretch' }}
        />
      </View>

      {/* Hesap bağlama */}
      <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15 }}>
        <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.home_connect_title}</Text>
        <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textDim, marginTop: 4 }}>{t.home_connect_body}</Text>
        <Pressable
          onPress={() => router.push('/connect')}
          accessibilityRole="button"
          style={({ pressed }) => ({ marginTop: 12, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: radii.md, borderWidth: 1, borderColor: colors.lineStrong, opacity: pressed ? 0.8 : 1 })}
        >
          <Icon name="user" size={14} color={colors.emberLite} strokeWidth={2} />
          <Text style={{ ...type.filter, color: colors.text }}>{t.home_connect_cta}</Text>
        </Pressable>
      </View>

      {/* Uygulamada neler var — yalnız gerçekten olan özellikler, sayı yok */}
      <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 20, marginBottom: 10 }}>{t.home_feat_title}</Text>
      <View style={{ gap: 8 }}>
        {t.home_feats.map((f) => (
          <View key={f.title} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emberLite, marginTop: 6 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.filter, color: colors.text }}>{f.title}</Text>
              <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute, marginTop: 2 }}>{f.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ══════════════ Hesap bağlı — gerçek özet + bildirimler ══════════════ */
function SignedInHome({ onOpenTab }: { onOpenTab?: (tab: 'vis' | 'aso') => void }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { token, me, activeSite } = useAuth();

  const [dash, setDash] = useState<MyDashboard | null>(null);
  // Hata: null = yok, '' = sunucu metni yok (ekranda genel mesaj), aksi halde sunucu metni
  const [dashErr, setDashErr] = useState<string | null>(null);
  const [notifs, setNotifs] = useState<AppNotification[] | null>(null);
  const [notifErr, setNotifErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Gec gelen cevap (hesap degisti / tekrar yuklendi) eski verinin ustune yazilmasin
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++reqId.current;
    setLoading(true);
    const [d, n] = await Promise.allSettled([getMyDashboard(token), listNotifications(token, 5)]);
    if (id !== reqId.current) return;
    if (d.status === 'fulfilled') { setDash(d.value); setDashErr(null); }
    else setDashErr(String(d.reason?.message ?? ''));
    if (n.status === 'fulfilled') { setNotifs(n.value); setNotifErr(null); }
    else setNotifErr(String(n.reason?.message ?? ''));
    setLoading(false);
  }, [token]);

  // Hesap değişince önceki hesabın sayıları bir an bile görünmesin
  useEffect(() => {
    setDash(null);
    setNotifs(null);
    setDashErr(null);
    setNotifErr(null);
    load();
  }, [load]);

  const firstName = (me?.name ?? '').trim().split(/\s+/)[0] || null;
  // Makale kutusu: deneme hakki aylik sifirlanmaz, "Bu ay uretilen" yalniz
  // ucretli planda dogru; denemede kalan/limit (gerekce article-quota.ts)
  const metrics: { label: string; value: string }[] = dash
    ? [
        { label: t.home_m_sites, value: formatInt(dash.sitesCount ?? 0, lang) },
        { label: t.home_m_published, value: formatInt(dash.articlesPublished ?? 0, lang) },
        { label: t.home_m_drafts, value: formatInt(dash.drafts ?? 0, lang) },
        articleMetric(dash, t, lang),
      ]
    : [];

  return (
    <View>
      {/* Karşılama */}
      <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 18 }}>
        <Orb size={52} />
        <Kicker text={t.home_in_kicker} />
        <Text accessibilityRole="header" style={[T.display(23, colors.text, 'bold'), { textAlign: 'center', marginTop: 10 }]}>{t.home_hello(firstName)}</Text>
        <Text style={{ ...type.data, color: colors.textMute, marginTop: 6, textAlign: 'center', maxWidth: 320 }} numberOfLines={2}>
          {activeSite ? t.home_site(activeSite.name) : t.home_no_site}
        </Text>
      </View>

      {/* Hesap özeti — GET /me/dashboard */}
      {dashErr !== null && !dash ? (
        <ErrorRow message={dashErr || t.load_error} retryLabel={t.retry} onRetry={load} />
      ) : !dash ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} style={{ flexBasis: '45%', flexGrow: 1 }} />
          ))}
        </View>
      )}

      {/* Kısa yollar */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <EmberButton label={t.tab_analyze} onPress={() => router.push('/analyze')} style={{ flex: 1 }} height={44} />
        {onOpenTab && (
          <Pressable
            onPress={() => onOpenTab('aso')}
            accessibilityRole="button"
            style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ ...type.filter, color: colors.text }}>ASO</Text>
          </Pressable>
        )}
      </View>

      {/* Bildirimler — GET /notifications */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
        <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.home_notif_title}</Text>
        <Pressable onPress={load} disabled={loading} hitSlop={8} accessibilityRole="button">
          {loading ? <ActivityIndicator color={colors.ember} size="small" /> : <Text style={{ ...type.data, color: colors.emberLite }}>{t.refresh}</Text>}
        </Pressable>
      </View>
      {notifErr !== null && !notifs ? (
        <ErrorRow message={notifErr || t.load_error} retryLabel={t.retry} onRetry={load} />
      ) : !notifs ? null : notifs.length === 0 ? (
        <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textMute }}>{t.home_notif_empty}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {notifs.map((n) => (
            <View key={n.id} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft }}>
              {/* Okunmamış işareti — yalnız sunucu readAt boşsa */}
              <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: n.readAt ? 'transparent' : colors.ember }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ ...type.filter, flex: 1, color: colors.text }} numberOfLines={2}>{n.title}</Text>
                  <Text style={{ ...type.data, color: colors.textGhost }}>{formatDateTime(n.createdAt, lang)}</Text>
                </View>
                {!!n.body && (
                  <Text style={{ ...type.label, fontFamily: fonts.body, lineHeight: 18, color: colors.textDim, marginTop: 4 }} numberOfLines={3}>{n.body}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ember }} />
      <Text style={{ ...type.micro, letterSpacing: 3, color: colors.emberLite }}>{text}</Text>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ember }} />
    </View>
  );
}

function ErrorRow({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <View style={{ borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bgElev, padding: 14, gap: 8 }}>
      <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit }}>{message}</Text>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
        <Text style={{ ...type.data, color: colors.emberLite }}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}
