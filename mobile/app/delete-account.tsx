import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, fonts, radii, tint, type } from '../src/theme';
import { Icon, ScreenBg } from '../src/components';
import { useAuth } from '../src/auth';
import { useLang } from '../src/i18n';
import {
  deleteAccount,
  detachAgencyClients,
  getAccountDeletionStatus,
  getMe,
  type AccountDeletionResult,
  type AccountDeletionStatus,
} from '../src/api';
import { maskEmail } from '../src/account';

/**
 * Hesabı sil — Apple App Review 5.1.1(v): hesap açılabilen uygulamada silme
 * uygulama içinden başlatılabilmeli. Politika sunucuyla aynı
 * (apps/api/src/me/account-deletion.policy.ts): erişim hemen kapanır,
 * veriler 30 gün sonra kalıcı silinir, faturalar kişisel bağlantısı
 * kaldırılarak saklanır. Uygulamada App Store aboneliği satılmaz (abonelik
 * web'den PayTR ile alınır); iptali sunucu yapar.
 *
 * Silinecek hesap (GET /me e-postası, maskeli) düğmenin üstünde ve onay
 * penceresinde gösterilir: sunucu girişte hesabı e-postayla eşler, farklı
 * e-postalı bir Google/Apple girişi (ör. Apple "E-postamı Gizle") yeni ve boş bir
 * hesap açar — kullanıcı o boş hesabı silip gerçek hesabının (ve aboneliğinin)
 * silindiğini sanmasın. Web'e (plan/ödeme sayfasına) bağlantı yok: uygulama içi
 * yol 5.1.1(v)'yi karşılar; plan ve fiyat gösteren sayfaya yönlendirmek 3.1.1(a)
 * riskidir (https://developer.apple.com/app-store/review/guidelines/).
 */

const S = {
  tr: {
    title: 'Hesabı sil',
    intro: 'Hesabını ve bağlı tüm verilerini silebilirsin.',
    kicker: 'NE OLUR?',
    access: 'Hesabına erişimin hemen kapanır; uygulama ve web panelindeki oturumların sonlandırılır.',
    subActive: 'Aboneliğin hemen iptal edilir ve kartından yeni ödeme alınmaz. Kalan dönem için ücret iadesi otomatik yapılmaz; iade talebin için destek ekibine yazabilirsin.',
    subNone: 'Kartından ödeme alınmaz; otomatik yenileme kapatılır.',
    automation: 'API anahtarların iptal edilir; otomatik yayın ve reklam işlemleri durur; yayın hedefi ve bağlı hesap bilgilerin silinir.',
    purge: (n: number) => `Sitelerin, içeriklerin, raporların ve diğer tüm hesap verilerin ${n} gün sonra kalıcı olarak silinir. Bu işlem geri alınamaz.`,
    invoices: 'Fatura ve ödeme kayıtların, vergi ve ticaret mevzuatı gereği saklanması zorunlu olduğundan kişisel bağlantısı kaldırılarak saklanır.',
    appleConfirm: 'Apple ile Giriş bağlantını kaldırmak için silme sırasında Apple kimliğini bir kez daha onaylaman istenir.',
    appleManual: 'Apple ile Giriş bağlantısını kaldırmak için: Ayarlar > [adın] > Apple ile Giriş Yap > RanksUp > Sil.',
    button: 'Hesabımı sil',
    deleting: 'Siliniyor…',
    alertTitle: 'Hesabın silinsin mi?',
    alertBody: (n: number) => `Erişimin hemen kapanır, verilerin ${n} gün sonra kalıcı olarak silinir. Bu işlem geri alınamaz.`,
    cancel: 'Vazgeç',
    confirm: 'Sil',
    canceled: 'İşlem iptal edildi.',
    doneTitle: 'Silme talebin alındı',
    doneBody: (date: string) => `Hesabına erişim kapatıldı. Verilerin ${date} tarihinden sonra kalıcı olarak silinecek.`,
    ok: 'Tamam',
    notConnected: 'Hesabını silmek için önce web panelinde kullandığın Google hesabıyla (ya da aynı e-postalı Apple hesabıyla) giriş yap.',
    signIn: 'Giriş yap',
    apiKeyTitle: 'Kimliğini doğrulaman gerekiyor',
    apiKeyBody: 'API anahtarıyla bağlısın. Hesap silme yalnız Google ya da Apple oturumuyla yapılabilir: “Bağlantıyı kes” ile çık, web panelinde kullandığın Google hesabıyla giriş yap ve tekrar “Hesabı sil”e dokun.',
    apiKeyOwner: (email: string) => `Bu anahtar ${email} hesabına ait. Silmek için bu e-postayla giriş yap.`,
    apiKeyWarn: 'Farklı e-posta adresli bir Google ya da Apple hesabıyla (ör. Apple’ın “E-postamı Gizle” seçeneği) giriş yaparsan ayrı ve boş bir hesap açılır; o hesabı silmek bu hesabı silmez.',
    accountKicker: 'SİLİNECEK HESAP',
    accountSites: (n: number) => `${n} site`,
    alertAccount: (email: string) => `Silinecek hesap: ${email}`,
    loadError: 'Bilgiler alınamadı.',
    retry: 'Tekrar dene',
    detach: 'Müşteri bağlantılarını kaldır',
    detaching: 'Ayrılıyor…',
  },
  en: {
    title: 'Delete account',
    intro: 'You can delete your account and all data linked to it.',
    kicker: 'WHAT HAPPENS',
    access: 'Your access ends immediately; your sessions in the app and the web dashboard are ended.',
    subActive: 'Your subscription is canceled immediately and no further charges are made to your card. Refunds for the remaining period are not automatic; contact our support team to request one.',
    subNone: 'No charges are made to your card; automatic renewal is turned off.',
    automation: 'Your API keys are revoked; automated publishing and ad actions stop; your publishing targets and connected account credentials are deleted.',
    purge: (n: number) => `Your sites, content, reports and all other account data are permanently deleted after ${n} days. This cannot be undone.`,
    invoices: 'Invoices and payment records are kept with your personal link removed, because tax and commercial law require us to retain them.',
    appleConfirm: 'To remove your Sign in with Apple link, you will be asked to confirm your Apple ID once more during deletion.',
    appleManual: 'To remove the Sign in with Apple link: Settings > [your name] > Sign in with Apple > RanksUp > Delete.',
    button: 'Delete my account',
    deleting: 'Deleting…',
    alertTitle: 'Delete your account?',
    alertBody: (n: number) => `Your access ends immediately and your data is permanently deleted after ${n} days. This cannot be undone.`,
    cancel: 'Cancel',
    confirm: 'Delete',
    canceled: 'Canceled.',
    doneTitle: 'Deletion request received',
    doneBody: (date: string) => `Your access has been closed. Your data will be permanently deleted after ${date}.`,
    ok: 'OK',
    notConnected: 'To delete your account, first sign in with the Google account you use on the web dashboard (or an Apple account with the same e-mail).',
    signIn: 'Sign in',
    apiKeyTitle: 'Verify your identity',
    apiKeyBody: 'You are connected with an API key. Accounts can only be deleted from a Google or Apple session: tap “Disconnect”, sign in with the Google account you use on the web dashboard, then tap “Delete account” again.',
    apiKeyOwner: (email: string) => `This key belongs to ${email}. Sign in with this e-mail to delete it.`,
    apiKeyWarn: 'Signing in with a Google or Apple account that has a different e-mail address (e.g. Apple’s “Hide My Email”) creates a separate, empty account; deleting that one does not delete this account.',
    accountKicker: 'ACCOUNT TO DELETE',
    accountSites: (n: number) => `${n} ${n === 1 ? 'site' : 'sites'}`,
    alertAccount: (email: string) => `Account to delete: ${email}`,
    loadError: 'Could not load details.',
    retry: 'Try again',
    detach: 'Detach client accounts',
    detaching: 'Detaching…',
  },
} as const;

const bodyText = { ...type.filter, fontFamily: fonts.body, lineHeight: 20, color: colors.textDim };

/** Sunucu Apple token'ını kendisi iptal edemiyorsa (saklı token yok) uygulama taze kod ister — yalnız iOS */
function needsFreshAppleCode(s: AccountDeletionStatus): boolean {
  return Platform.OS === 'ios' && s.apple.linked && s.apple.configured && !s.apple.tokenStored;
}

/** Apple bağlantısı için gösterilecek satır: sunucu iptal eder / kimlik onayı istenecek / elle kaldırma adımı */
function appleLine(s: AccountDeletionStatus, t: (typeof S)['tr'] | (typeof S)['en']): string[] {
  if (!s.apple.linked) return [];
  if (s.apple.configured && s.apple.tokenStored) return [];
  if (needsFreshAppleCode(s)) return [t.appleConfirm];
  return [t.appleManual];
}

export default function DeleteAccount() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang } = useLang();
  const t = S[lang];
  const { token, connectedVia, sites, freshAppleAuthorizationCode, forgetAfterAccountDeletion } = useAuth();

  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  /** Silinecek hesabin maskeli e-postasi — silmeden hemen once GET /me ile taze alinir */
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: AccountDeletionResult; appleManual: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (connectedVia === 'session') {
        // Kimlik + silme durumu birlikte: hesap e-postasi alinamazsa silme dugmesi hic cizilmez
        const [st, me] = await Promise.all([getAccountDeletionStatus(token), getMe(token)]);
        const masked = maskEmail(me.email);
        if (!masked) throw new Error(t.loadError);
        setAccountEmail(masked);
        setStatus(st);
      } else if (connectedVia === 'apiKey') {
        // Anahtar silme yetkisi tasimaz ama hangi hesaba ait oldugu gosterilir (/me oturumsuz da okunur)
        const me = await getMe(token).catch(() => null);
        setAccountEmail(maskEmail(me?.email) || null);
      }
    } catch (e: any) {
      setError(e?.message ?? t.loadError);
    } finally {
      setLoading(false);
    }
  }, [token, connectedVia, t.loadError]);

  useEffect(() => {
    load();
  }, [load]);

  /** Hata mesajina dokunmadan durumu tazeler (silme reddedildiginde engel yeni olusmus olabilir) */
  const refreshStatus = useCallback(async () => {
    if (!token || connectedVia !== 'session') return;
    try {
      setStatus(await getAccountDeletionStatus(token));
    } catch {
      /* gosterilen hata mesaji kalsin */
    }
  }, [token, connectedVia]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/app'));

  const runDeletion = async () => {
    if (!token || !status) return;
    setBusy(true);
    setError(null);
    try {
      let appleAuthorizationCode: string | undefined;
      if (needsFreshAppleCode(status)) {
        const r = await freshAppleAuthorizationCode();
        if (r.canceled) {
          setError(t.canceled);
          return;
        }
        appleAuthorizationCode = r.code ?? undefined;
      }
      const result = await deleteAccount(token, { appleAuthorizationCode });
      const appleManual = status.apple.linked && result.apple !== null && result.apple !== 'revoked' && result.apple !== 'not_linked';
      // Önce sonuç ekranı (token silinince "giriş yok" görünümü yanıp sönmesin)
      setDone({ result, appleManual });
      // Oturum sunucuda kapandı — cihazdaki token ve Google oturumu da temizlenir
      await forgetAfterAccountDeletion({ google: status.signInProviders.includes('google') });
    } catch (e: any) {
      setError(e?.message ?? '');
      // Engel sonradan oluşmuş olabilir (ör. yeni müşteri bağlandı) — güncel durumu getir
      refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const askConfirm = () => {
    if (!status || !accountEmail) return;
    Alert.alert(t.alertTitle, `${t.alertAccount(accountEmail)}\n\n${t.alertBody(status.purgeAfterDays)}`, [
      { text: t.cancel, style: 'cancel' },
      { text: t.confirm, style: 'destructive', onPress: runDeletion },
    ]);
  };

  const detach = async () => {
    if (!token) return;
    setDetaching(true);
    setError(null);
    try {
      await detachAgencyClients(token);
      await load();
    } catch (e: any) {
      setError(e?.message ?? '');
    } finally {
      setDetaching(false);
    }
  };

  const purgeDate = done
    ? new Date(done.result.purgeAfter).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Istanbul',
      })
    : '';

  return (
    <View style={{ flex: 1 }}>
      <ScreenBg />

      {/* Üst bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        {!done && (
          <Pressable onPress={close} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.cancel} style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(colors.bgElev, 0.8) }}>
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <Icon name="arrowRight" size={16} color={colors.text} strokeWidth={2.2} />
            </View>
          </Pressable>
        )}
        <Text accessibilityRole="header" style={{ ...type.metric, fontFamily: fonts.displayBold, color: colors.text }}>{done ? t.doneTitle : t.title}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {done ? (
          /* ── Talep alındı ── */
          <View style={{ marginTop: 8, gap: 14 }}>
            <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: tint(colors.good, 0.3), padding: 16, gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={18} color={colors.bg} strokeWidth={3} />
              </View>
              <Text style={bodyText}>{t.doneBody(purgeDate)}</Text>
              <Text style={bodyText}>{t.invoices}</Text>
              {done.appleManual && <Text style={bodyText}>{t.appleManual}</Text>}
            </View>
            <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={({ pressed }) => ({ height: 50, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bgElev, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.ok}</Text>
            </Pressable>
          </View>
        ) : !token ? (
          /* ── Giriş yok ── */
          <View style={{ marginTop: 8, gap: 14 }}>
            <Text style={bodyText}>{t.notConnected}</Text>
            <Pressable onPress={() => router.replace('/connect')} accessibilityRole="button" style={{ alignSelf: 'flex-start' }} hitSlop={8}>
              <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: colors.emberMid }}>{t.signIn}</Text>
            </Pressable>
          </View>
        ) : connectedVia === 'apiKey' ? (
          /* ── API anahtarıyla bağlı: kimlik doğrulaması gerekir ── */
          <View style={{ marginTop: 8, borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, gap: 10 }}>
            <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.text }}>{t.apiKeyTitle}</Text>
            <Text style={bodyText}>{t.apiKeyBody}</Text>
            {!!accountEmail && <Text style={{ ...bodyText, color: colors.text }}>{t.apiKeyOwner(accountEmail)}</Text>}
            <Text style={{ ...bodyText, color: colors.warn }}>{t.apiKeyWarn}</Text>
          </View>
        ) : loading && !status ? (
          <View style={{ marginTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.ember} />
          </View>
        ) : !status ? (
          /* ── Yükleme hatası ── */
          <View style={{ marginTop: 8, gap: 12 }}>
            <Text style={{ ...bodyText, color: colors.crit }}>{error || t.loadError}</Text>
            <Pressable onPress={load} accessibilityRole="button" style={{ alignSelf: 'flex-start' }} hitSlop={8}>
              <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: colors.emberMid }}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            <Text style={bodyText}>{t.intro}</Text>

            {status.blockers.length > 0 ? (
              /* ── Engel: ajans müşterileri / yönetici ── */
              <View style={{ marginTop: 16, gap: 10 }}>
                {status.blockers.map((b) => (
                  <View key={b.code} style={{ borderRadius: radii.xl, backgroundColor: tint(colors.warn, 0.08), borderWidth: 1, borderColor: tint(colors.warn, 0.35), padding: 15, gap: 10 }}>
                    <Text style={{ ...bodyText, color: colors.text }}>{b.message}</Text>
                    {b.code === 'agency_has_clients' && (
                      <Pressable onPress={detach} disabled={detaching} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'flex-start', paddingHorizontal: 14, height: 38, borderRadius: radii.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', opacity: pressed || detaching ? 0.75 : 1 })}>
                        <Text style={{ ...type.filter, fontFamily: fonts.bodySemi, color: colors.text }}>{detaching ? t.detaching : t.detach}</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <>
                {/* Ne olur? */}
                <Text style={{ ...type.data, letterSpacing: 1.2, color: colors.textFaint, marginTop: 20, marginBottom: 10 }}>{t.kicker}</Text>
                <View style={{ borderRadius: radii.xl, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, padding: 15, gap: 11 }}>
                  {[
                    t.access,
                    status.subscriptionActive ? t.subActive : t.subNone,
                    t.automation,
                    t.purge(status.purgeAfterDays),
                    t.invoices,
                    ...appleLine(status, t),
                  ].map((line, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emberLite, marginTop: 7 }} />
                      <Text style={{ ...bodyText, flex: 1, color: colors.text }}>{line}</Text>
                    </View>
                  ))}
                </View>

                {/* Silinecek hesap — maskeli e-posta + site sayısı */}
                <View accessible accessibilityLabel={`${t.accountKicker}: ${accountEmail ?? ''}, ${t.accountSites(sites.length)}`} style={{ marginTop: 18, borderRadius: radii.lg, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: tint(colors.crit, 0.3), paddingHorizontal: 14, paddingVertical: 12, gap: 2 }}>
                  <Text style={{ ...type.data, letterSpacing: 1.2, color: colors.textFaint }}>{t.accountKicker}</Text>
                  <Text style={{ ...type.filter, fontFamily: fonts.monoSemi, color: colors.text }}>
                    {accountEmail}
                    <Text style={{ fontFamily: fonts.body, color: colors.textMute }}>{` · ${t.accountSites(sites.length)}`}</Text>
                  </Text>
                </View>

                <Pressable
                  onPress={askConfirm}
                  disabled={busy || !accountEmail}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ marginTop: 10, height: 50, borderRadius: radii.lg, borderWidth: 1, borderColor: tint(colors.crit, 0.55), backgroundColor: tint(colors.crit, 0.12), alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed || busy ? 0.8 : 1 })}
                >
                  {busy && <ActivityIndicator color={colors.crit} size="small" />}
                  <Text style={{ ...type.filter, fontFamily: fonts.bodyBold, color: colors.crit }}>{busy ? t.deleting : t.button}</Text>
                </Pressable>
              </>
            )}

            {error && <Text style={{ ...type.label, fontFamily: fonts.body, color: colors.crit, marginTop: 10 }}>{error}</Text>}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
