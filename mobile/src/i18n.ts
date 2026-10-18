/**
 * i18n — TR / EN metinler.
 *
 * Tasarim projesinden gelen ornek veriler (uydurma ajan akisi, "Sen uyurken 6
 * islem yaptim", sabit motor/anahtar kelime/ASA rakamlari, Studio varyantlari,
 * sahte onboarding taramasi) kaldirildi: ekranlar artik yalniz API'den gelen
 * gercek veriyi gosterir ya da veri yoksa bunu acikca soyler. Burada sayi
 * iceren tek metinler, cagiranin gercek veriden verdigi sayilardir.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';

export type Lang = 'tr' | 'en';

export interface Strings {
  // ── Ilk acilis ──
  skip: string;
  ob1_kicker: string; ob1_title: string; ob1_sub: string; ob1_ph: string; ob1_cta: string; ob1_note: string; ob1_err: string;

  // ── Sekmeler ve ust bar ──
  tab_home: string; tab_vis: string; tab_account: string; tab_analyze: string;
  hdr_account: string; hdr_bell: string; hdr_bell_unread: (n: number) => string;
  retry: string; refresh: string; load_error: string;

  // ── Ana sayfa (hesap bagli degil) ──
  home_kicker: string; home_title: string; home_sub: string; home_cta: string;
  home_connect_title: string; home_connect_body: string; home_connect_cta: string;
  home_feat_title: string; home_feats: { title: string; body: string }[];

  // ── Ana sayfa (hesap bagli) ──
  home_in_kicker: string;
  home_hello: (name: string | null) => string;
  home_site: (site: string) => string;
  home_no_site: string;
  home_m_sites: string; home_m_published: string; home_m_drafts: string; home_m_month: string;
  /**
   * Deneme hesabi: hak aylik sifirlanmaz (sunucu QuotaService, plan TRIAL),
   * "Bu ay uretilen" yanlis olur. Kalan/limit sunucunun articleQuota alanindan;
   * alan yoksa yalniz kullanilan sayi (article-quota.ts).
   */
  home_m_trial: string; home_trial_left: (remaining: string, limit: string) => string; home_m_trial_used: string;
  home_notif_title: string; home_notif_empty: string;

  // ── AI gorunurluk ──
  vis_title: string; vis_sub: string; vis_score: string; vis_engines: string; vis_engines_note: string;
  vis_empty_title: string; vis_empty_body: string; vis_empty_cta: string;
  vis_loading: (domain: string) => string; vis_snapshot: string;
  vis_answered: (answered: number, total: number) => string;
  vis_excluded: (locked: number, branded: number) => string;
  vis_all_branded: string; vis_no_measured: string;
  vis_pairs: (shown: number, total: number) => string;
  vis_comp_title: string; vis_you: string;
  vis_road_title: string; vis_road_sub: string;
  road: { title: string; why: string; eff: string }[];

  // ── ASO ──
  aso_sub: string;
  aso_pill: (site: string) => string;
  aso_search_title: string; aso_search_ios: string; aso_search_play: string; aso_search_btn: string; aso_no_results: string;
  aso_apps_title: string; aso_apps_empty: string; aso_no_site: string;
  aso_store_missing_ios: string; aso_store_missing_play: string;
  aso_ratings: (n: string) => string; aso_reviews: (n: string) => string; aso_no_rating: string;
  aso_kw_title: string; aso_kw_count: (n: string) => string; aso_kw_empty: string;
  aso_kw_last: (date: string) => string; aso_kw_never: string; aso_kw_more: (n: number) => string; aso_kw_legend: string;
  asa_period: string; asa_imp: string; asa_tap: string; asa_inst: string; asa_cr: string;
  asa_empty: string; asa_last_day: (date: string) => string;
  aso_out_title: string; aso_out_body: string; aso_out_cta: string;
}

export const I18N: Record<Lang, Strings> = {
  tr: {
    skip: 'Atla',
    ob1_kicker: 'AI GÖRÜNÜRLÜK',
    ob1_title: 'Markan AI cevaplarında görünüyor mu?',
    ob1_sub: 'Sitenin adresini yaz; markanın 6 AI asistanının cevaplarında geçip geçmediğini ücretsiz ölçelim.',
    ob1_ph: 'siteniz.com',
    ob1_cta: 'Siteni analiz et',
    ob1_note: 'ÜCRETSİZ · HESAP GEREKMEZ',
    ob1_err: 'Bir alan adı gir (ör. siteniz.com)',

    tab_home: 'Ana sayfa', tab_vis: 'Görünürlük', tab_account: 'Hesap', tab_analyze: 'Site analiz et',
    hdr_account: 'Hesap', hdr_bell: 'Bildirimler',
    hdr_bell_unread: (n) => `${n} okunmamış bildirim`,
    retry: 'Tekrar dene', refresh: 'Yenile', load_error: 'Bilgiler alınamadı.',

    home_kicker: 'AI GÖRÜNÜRLÜK',
    home_title: 'Markan AI cevaplarında görünüyor mu?',
    home_sub: 'Sitenin adresini yaz; ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’in sektörüne dair sorulara verdiği cevaplarda markanın geçip geçmediğini ölçelim. Ücretsiz, hesap gerekmez.',
    home_cta: 'Siteni analiz et',
    home_connect_title: 'RanksUp hesabın var mı?',
    home_connect_body: 'Hesabını bağla; sitelerin, bildirimlerin ve ASO verilerin burada görünsün.',
    home_connect_cta: 'Hesabını bağla',
    home_feat_title: 'Uygulamada neler var?',
    home_feats: [
      { title: 'AI görünürlük testi', body: 'Hesap gerekmez. Ücretsiz testte soruların bir kısmı ölçülür; hangilerinin ölçüldüğü sonuçta yazar.' },
      { title: 'Hesap özeti ve bildirimler', body: 'Sitelerin, yazıların ve tarama sonuçların — hesabını bağlayınca.' },
      { title: 'ASO', body: 'Takip ettiğin uygulamaların App Store ve Google Play anahtar kelime sıraları — hesabını bağlayınca.' },
    ],

    home_in_kicker: 'HESAP ÖZETİ',
    home_hello: (name) => (name ? `Merhaba, ${name}` : 'Merhaba'),
    home_site: (site) => `Aktif site: ${site}`,
    home_no_site: 'Bu hesapta henüz site yok. Web panelinden site ekleyince burada görünür.',
    home_m_sites: 'Siteler', home_m_published: 'Yayınlanan yazı', home_m_drafts: 'Hazırlanan yazı', home_m_month: 'Bu ay üretilen',
    home_m_trial: 'Deneme hakkı', home_trial_left: (r, l) => `${r}/${l} kaldı`, home_m_trial_used: 'Kullanılan deneme hakkı',
    home_notif_title: 'Son bildirimler',
    home_notif_empty: 'Henüz bildirim yok. Tarama ve ölçüm sonuçların burada görünür.',

    vis_title: 'AI Görünürlük',
    vis_sub: '6 AI asistanında marka görünürlüğü ve rakip payı',
    vis_score: 'GÖRÜNÜRLÜK SKORU',
    vis_engines: 'Asistan bazında',
    vis_engines_note: 'Markanın adının ya da sitenin bağlantısının geçtiği cevaplar.',
    vis_empty_title: 'Görünürlüğünü ölç',
    vis_empty_body: 'Bir site analiz et; markanın 6 AI asistanındaki gerçek görünürlüğünü burada gör.',
    vis_empty_cta: 'Site analiz et',
    vis_loading: (domain) => `${domain} taranıyor…`,
    vis_snapshot: 'AI görünürlük · anlık görünüm',
    vis_answered: (a, b) => `${a}/${b} soruda en az bir AI asistanı markanı gösterdi.`,
    vis_excluded: (locked, branded) => {
      const parts: string[] = [];
      if (locked > 0) parts.push(`${locked} kilitli soru`);
      if (branded > 0) parts.push(`marka adını içeren ${branded} soru`);
      return parts.length ? `${parts.join(' ve ')} skora katılmadı.` : '';
    },
    vis_all_branded: 'Ölçülen soruların hepsi marka adını içeriyor; skor bu sorulardan hesaplandı.',
    vis_no_measured: 'Bu sonuçta ölçülmüş soru yok, bu yüzden skor hesaplanmadı.',
    vis_pairs: (a, b) => `${a}/${b} cevap`,
    vis_comp_title: 'AI cevaplarında kim öne çıkıyor?',
    vis_you: '(siz)',
    vis_road_title: 'Genel öneriler',
    vis_road_sub: 'Her site için geçerli adımlar — bu sonuca özel değildir',
    road: [
      { title: 'llms.txt dosyası ekle', why: 'Sitenin ne yaptığını ve önemli sayfalarını AI araçlarına tek bir dosyada özetler.', eff: 'KOLAY' },
      { title: 'Sık sorulan soruları cevapla', why: 'Müşterilerinin AI asistanlarına sorduğu soruların açık cevabını sitende yayınla.', eff: 'KOLAY' },
      { title: 'Karşılaştırma sayfası yaz', why: '“X mi Y mi” sorularında markanı alternatifleriyle dürüstçe karşılaştıran bir sayfa.', eff: 'ORTA' },
    ],

    aso_sub: 'App Store ve Google Play anahtar kelime sıraları',
    aso_pill: (site) => `Bağlı site · ${site}`,
    aso_search_title: 'Mağazada ara',
    aso_search_ios: 'App Store’da uygulama ara…',
    aso_search_play: 'Google Play’de uygulama ara…',
    aso_search_btn: 'Ara',
    aso_no_results: 'Sonuç bulunamadı.',
    aso_apps_title: 'Takip edilen uygulamalar',
    aso_apps_empty: 'Bu sitede takip edilen uygulama yok. Uygulamanı web panelindeki ASO bölümünden ekleyebilirsin.',
    aso_no_site: 'Bu hesapta site yok. Web panelinden bir site ekleyince ASO verilerin burada görünür.',
    aso_store_missing_ios: 'Bu uygulamanın App Store sürümü bağlı değil.',
    aso_store_missing_play: 'Bu uygulamanın Google Play sürümü bağlı değil.',
    aso_ratings: (n) => `${n} değerlendirme`,
    aso_reviews: (n) => `${n} yorum`,
    aso_no_rating: 'Puan yok',
    aso_kw_title: 'Anahtar kelime sıraları',
    aso_kw_count: (n) => `${n} kelime`,
    aso_kw_empty: 'Bu mağaza için takip edilen anahtar kelime yok.',
    aso_kw_last: (date) => `Son ölçüm: ${date}`,
    aso_kw_never: 'Sıralar henüz ölçülmedi.',
    aso_kw_more: (n) => `+${n} kelime daha web panelinde`,
    aso_kw_legend: '“—”: ilk sonuçlarda yok ya da henüz ölçülmedi',
    asa_period: 'Son 30 gün',
    asa_imp: 'GÖSTERİM', asa_tap: 'DOKUNMA', asa_inst: 'İNDİRME', asa_cr: 'DÖNÜŞÜM',
    asa_empty: 'Son 30 günde kayıtlı performans verisi yok.',
    asa_last_day: (date) => `Son veri günü: ${date}`,
    aso_out_title: 'Uygulamanın mağaza sıralarını gör',
    aso_out_body: 'Hesabını bağladığında web panelinde takip ettiğin uygulamalar, anahtar kelime sıraları ve (bağlıysa) Apple Search Ads performansı burada görünür.',
    aso_out_cta: 'Hesabını bağla',
  },
  en: {
    skip: 'Skip',
    ob1_kicker: 'AI VISIBILITY',
    ob1_title: 'Does your brand show up in AI answers?',
    ob1_sub: 'Enter your site and we will check, for free, whether 6 AI assistants mention your brand in their answers.',
    ob1_ph: 'yoursite.com',
    ob1_cta: 'Analyze your site',
    ob1_note: 'FREE · NO ACCOUNT NEEDED',
    ob1_err: 'Enter a domain (e.g. yoursite.com)',

    tab_home: 'Home', tab_vis: 'Visibility', tab_account: 'Account', tab_analyze: 'Analyze a site',
    hdr_account: 'Account', hdr_bell: 'Notifications',
    hdr_bell_unread: (n) => `${n} unread notifications`,
    retry: 'Try again', refresh: 'Refresh', load_error: 'Could not load the data.',

    home_kicker: 'AI VISIBILITY',
    home_title: 'Does your brand show up in AI answers?',
    home_sub: 'Enter your site and we will check whether ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek mention your brand when asked about your industry. Free, no account needed.',
    home_cta: 'Analyze your site',
    home_connect_title: 'Have a RanksUp account?',
    home_connect_body: 'Connect it to see your sites, notifications and ASO data here.',
    home_connect_cta: 'Connect account',
    home_feat_title: 'What is in the app?',
    home_feats: [
      { title: 'AI visibility test', body: 'No account needed. The free test measures some of the questions; the result shows which ones.' },
      { title: 'Account summary and notifications', body: 'Your sites, articles and scan results — once your account is connected.' },
      { title: 'ASO', body: 'App Store and Google Play keyword rankings for the apps you track — once your account is connected.' },
    ],

    home_in_kicker: 'ACCOUNT SUMMARY',
    home_hello: (name) => (name ? `Hello, ${name}` : 'Hello'),
    home_site: (site) => `Active site: ${site}`,
    home_no_site: 'This account has no sites yet. Add one on the web dashboard and it will show up here.',
    home_m_sites: 'Sites', home_m_published: 'Published articles', home_m_drafts: 'Articles in progress', home_m_month: 'Generated this month',
    home_m_trial: 'Free trial articles', home_trial_left: (r, l) => `${r}/${l} left`, home_m_trial_used: 'Trial articles used',
    home_notif_title: 'Recent notifications',
    home_notif_empty: 'No notifications yet. Your scan and measurement results will show up here.',

    vis_title: 'AI Visibility',
    vis_sub: 'Brand visibility and competitor share across 6 AI assistants',
    vis_score: 'VISIBILITY SCORE',
    vis_engines: 'By assistant',
    vis_engines_note: 'Answers that mention your brand or link to your site.',
    vis_empty_title: 'Measure your visibility',
    vis_empty_body: 'Analyze a site to see your brand’s real visibility across 6 AI assistants here.',
    vis_empty_cta: 'Analyze a site',
    vis_loading: (domain) => `Scanning ${domain}…`,
    vis_snapshot: 'AI visibility · snapshot',
    vis_answered: (a, b) => `At least one AI assistant showed your brand in ${a} of ${b} questions.`,
    vis_excluded: (locked, branded) => {
      const parts: string[] = [];
      if (locked > 0) parts.push(`${locked} locked ${locked === 1 ? 'question' : 'questions'}`);
      if (branded > 0) parts.push(`${branded} ${branded === 1 ? 'question' : 'questions'} containing your brand name`);
      return parts.length ? `${parts.join(' and ')} ${locked + branded === 1 ? 'was' : 'were'} not scored.` : '';
    },
    vis_all_branded: 'Every measured question contains your brand name, so the score uses all of them.',
    vis_no_measured: 'This result has no measured questions, so there is no score.',
    vis_pairs: (a, b) => `${a}/${b} answers`,
    vis_comp_title: 'Who stands out in AI answers?',
    vis_you: '(you)',
    vis_road_title: 'General tips',
    vis_road_sub: 'Steps that apply to any site — not specific to this result',
    road: [
      { title: 'Add an llms.txt file', why: 'Summarizes what your site does and its key pages for AI tools in a single file.', eff: 'EASY' },
      { title: 'Answer common questions', why: 'Publish clear answers to the questions your customers ask AI assistants.', eff: 'EASY' },
      { title: 'Write a comparison page', why: 'A page that honestly compares your brand with alternatives for “X or Y” questions.', eff: 'MEDIUM' },
    ],

    aso_sub: 'App Store and Google Play keyword rankings',
    aso_pill: (site) => `Connected site · ${site}`,
    aso_search_title: 'Search the store',
    aso_search_ios: 'Search the App Store…',
    aso_search_play: 'Search Google Play…',
    aso_search_btn: 'Search',
    aso_no_results: 'No results.',
    aso_apps_title: 'Tracked apps',
    aso_apps_empty: 'This site tracks no apps yet. Add your app in the ASO section of the web dashboard.',
    aso_no_site: 'This account has no sites. Add one on the web dashboard and your ASO data will show up here.',
    aso_store_missing_ios: 'The App Store version of this app is not linked.',
    aso_store_missing_play: 'The Google Play version of this app is not linked.',
    aso_ratings: (n) => `${n} ratings`,
    aso_reviews: (n) => `${n} reviews`,
    aso_no_rating: 'No rating',
    aso_kw_title: 'Keyword rankings',
    aso_kw_count: (n) => `${n} keywords`,
    aso_kw_empty: 'No keywords are tracked for this store.',
    aso_kw_last: (date) => `Last checked: ${date}`,
    aso_kw_never: 'Rankings have not been measured yet.',
    aso_kw_more: (n) => `+${n} more on the web dashboard`,
    aso_kw_legend: '“—”: not in the first results or not measured yet',
    asa_period: 'Last 30 days',
    asa_imp: 'IMPRESSIONS', asa_tap: 'TAPS', asa_inst: 'INSTALLS', asa_cr: 'CONVERSION',
    asa_empty: 'No performance data recorded in the last 30 days.',
    asa_last_day: (date) => `Latest data: ${date}`,
    aso_out_title: 'See your app’s store rankings',
    aso_out_body: 'Once your account is connected, the apps you track on the web dashboard, their keyword rankings and (if connected) Apple Search Ads performance show up here.',
    aso_out_cta: 'Connect account',
  },
};

// ── Dil context'i ──
interface LangCtx { lang: Lang; t: Strings; toggle: () => void; setLang: (l: Lang) => void }
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('tr');
  const value = useMemo<LangCtx>(
    () => ({ lang, t: I18N[lang], toggle: () => setLang((l) => (l === 'tr' ? 'en' : 'tr')), setLang }),
    [lang],
  );
  return React.createElement(Ctx.Provider, { value }, children);
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLang must be used inside <LangProvider>');
  return c;
}
