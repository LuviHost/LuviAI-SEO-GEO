/**
 * i18n + tasarım verisi — Claude Design "RanksUp Mobile" projesinden birebir.
 * Metinler ve veri listeleri tasarımdaki I18N/ENGINES/KW ile aynı.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';

export type Lang = 'tr' | 'en';

export interface Strings {
  skip: string;
  ob1_title: string; ob1_sub: string; ob1_ph: string; ob1_cta: string; ob1_note: string;
  ob2_kicker: string; scan_titles: string[]; scan_steps: string[];
  ob3_title: string; ob3_sub: string; ob3_sector: string; ob3_comp: string; ob3_plan: string; ob3_ready: string; ob3_found: string; ob3_cta: string;
  home_kicker: string; home_title: string; home_sub: string; home_newkw: string; now: string;
  pend_badge: string; pend_title: string; pend_desc: string; approve: string; reject: string;
  approved_badge: string; rejected_badge: string; approved_msg: string; rejected_msg: string;
  auto: string; queued: string; ask_ph: string; tab_agent: string; tab_vis: string;
  feed: { title: string; desc: string; time: string; badge: 'auto' | 'queued' | null }[];
  vis_title: string; vis_sub: string; vis_score: string; vis_caption: string; vis_engines: string; vis_road_sub: string;
  road: { title: string; why: string; eff: string }[];
  aso_sub: string; aso_score: string; aso_thisweek: string; aso_meta: string; aso_kw: string;
  asa_imp: string; asa_tap: string; asa_inst: string; asa_note: string;
  st_sub: string; st_ph: string; st_gen: string; st_busy: string; st_variants: string; st_share: string; st_schedule: string;
  variants: { channel: string; text: string; len: string }[];
}

export const I18N: Record<Lang, Strings> = {
  tr: {
    skip: 'Atla',
    ob1_title: 'Senin yerine pazarlama yapan AI.',
    ob1_sub: 'Siteni bağla — RanksUp tarasın, eksikleri bulsun, içeriği üretsin, App Store reklamını optimize etsin.',
    ob1_ph: 'https://siteniz.com',
    ob1_cta: 'Siteyi bağla',
    ob1_note: 'KART GEREKMEZ · 2 MAKALE ÜCRETSİZ',
    ob2_kicker: 'AI ANALİZ',
    scan_titles: ['Siten taranıyor…', 'Sektör belirleniyor…', "Keyword'ler çıkarılıyor…", 'Rakipler analiz ediliyor…', 'İçerik planı hazırlanıyor…', 'Tamamlandı'],
    scan_steps: ['Site tarandı', 'Sektör belirlendi: KOBİ finans', '50 keyword çıkarıldı', '3 rakip bulundu', 'İlk içerik planı hazır'],
    ob3_title: 'Her şey hazır.',
    ob3_sub: 'AI sektörünü anladı, planını kurdu. Auto-Pilot açık — ilk işlemler onayını bekleyecek.',
    ob3_sector: 'SEKTÖR', ob3_comp: 'RAKİP', ob3_plan: 'İÇERİK PLANI', ob3_ready: 'Hazır', ob3_found: 'bulundu',
    ob3_cta: 'Panele git',
    home_kicker: 'AUTO-PILOT AKTİF',
    home_title: 'Sen uyurken 6 işlem yaptım.',
    home_sub: 'Son 24 saat · KobiPratik',
    home_newkw: 'yeni kw',
    now: 'şimdi',
    pend_badge: 'ONAY BEKLİYOR',
    pend_title: 'ASA bid artışı öneriyorum',
    pend_desc: "'ön muhasebe' CPI hedefin %31 altında. $0.38 → $0.45 ile #1 pozisyon mümkün — tahmini +9 indirme/gün.",
    approve: 'Onayla', reject: 'Reddet',
    approved_badge: 'ONAYLANDI', rejected_badge: 'REDDEDİLDİ',
    approved_msg: 'Bid $0.45 olarak güncellendi — etki 24 saat içinde raporlanır.',
    rejected_msg: 'Öneri kapatıldı. Auto-Pilot mevcut bid ile devam ediyor.',
    auto: 'OTOMATİK', queued: 'YAYIN KUYRUĞUNDA',
    ask_ph: 'Ajana söyle: "X\'e bir post at…"',
    tab_agent: 'Ajan', tab_vis: 'Görünürlük',
    feed: [
      { title: 'Sıralama yükseldi', desc: "'ön muhasebe' #8 → #3 — günlük rank check, 50 keyword tarandı.", time: '02:14', badge: 'auto' },
      { title: 'Makale üretildi', desc: '"KOBİ vergi takvimi 2026" — 1.840 kelime, FAQ schema dahil. WordPress\'e yayına hazır.', time: '03:02', badge: 'queued' },
      { title: "LinkedIn'de yayınlandı", desc: '"E-fatura geçişinde 5 kritik tarih" — 267 görüntüleme, 12 etkileşim.', time: '08:30', badge: 'auto' },
      { title: "ChatGPT'de yeni mention", desc: '"KOBİ\'ler için ön muhasebe programı" sorgusunda markan önerildi.', time: '11:47', badge: null },
    ],
    vis_title: 'AI Görünürlük',
    vis_sub: '7 AI motorunda marka takibi · sentiment · share of voice',
    vis_score: 'CITATION SKORU',
    vis_caption: '128 cevapta alıntı · %34 artış',
    vis_engines: 'Motor bazında',
    vis_road_sub: 'AI sonuçlarını okur, ne yapman gerektiğini önerir',
    road: [
      { title: 'llms.txt dosyası ekle', why: "AI crawler'ları site yapını daha iyi anlar — citation şansı artar.", eff: 'KOLAY' },
      { title: 'FAQ schema genişlet', why: "'kobi kredisi' sorgularında Perplexity kaynağı olarak öne çıkarsın.", eff: 'KOLAY' },
      { title: 'Karşılaştırma sayfası yaz', why: "'X vs Y' sorguları en çok cite tetikleyen format — sende hiç yok.", eff: 'ORTA' },
    ],
    aso_sub: 'App Store + Play Store keyword takibi ve reklam',
    aso_score: 'ASO SKOR', aso_thisweek: 'bu hafta', aso_meta: 'Metadata 92 · Görsel 71 · Yorum 68',
    aso_kw: 'Keyword sıralaması',
    asa_imp: 'GÖSTERİM', asa_tap: 'TIKLAMA', asa_inst: 'İNDİRME',
    asa_note: "Auto-Pilot dün 2 düşük performanslı keyword durdurdu, bid'i $0.50 → $0.38 düşürdü.",
    st_sub: 'Tek konudan her kanala içerik — metin, görsel, video',
    st_ph: 'Ne hakkında üretelim? ör. "e-fatura geçiş rehberi"',
    st_gen: 'Üret', st_busy: 'GPT-5 3 varyant yazıyor · DALL-E görsel hazırlıyor…',
    st_variants: '3 varyant hazır',
    st_share: 'Paylaş', st_schedule: 'Planla',
    variants: [
      { channel: '𝕏 / TWITTER', text: "E-faturaya geçiş 1 Ocak'ta zorunlu oluyor ve KOBİ'lerin %60'ı hâlâ hazır değil. 5 adımda geçiş rehberini yazdık — vergi cezası yemeden tamamla. 🔗", len: '214 karakter' },
      { channel: 'LINKEDIN', text: "2027'de e-fatura zorunluluğu kapsamı genişliyor. Muhasebe ekipleri için hazırladığımız kontrol listesi: ✓ Entegratör seçimi ✓ Test ortamı ✓ Arşiv düzeni. Detaylı rehber yorumlarda.", len: '312 karakter' },
      { channel: 'INSTAGRAM', text: 'E-fatura paniği yaşamayın 📋 Carousel: 5 slaytta geçiş takvimi + son tarihler. Kaydet, muhasebecinle paylaş.', len: 'Carousel · 5 görsel' },
    ],
  },
  en: {
    skip: 'Skip',
    ob1_title: 'AI that does your marketing for you.',
    ob1_sub: 'Connect your site — RanksUp scans it, finds the gaps, writes the content, optimizes your App Store ads.',
    ob1_ph: 'https://yoursite.com',
    ob1_cta: 'Connect site',
    ob1_note: 'NO CARD NEEDED · 2 FREE ARTICLES',
    ob2_kicker: 'AI ANALYSIS',
    scan_titles: ['Scanning your site…', 'Detecting industry…', 'Extracting keywords…', 'Analyzing competitors…', 'Building content plan…', 'Done'],
    scan_steps: ['Site crawled', 'Industry detected: SMB finance', '50 keywords extracted', '3 competitors found', 'First content plan ready'],
    ob3_title: "You're all set.",
    ob3_sub: 'AI understood your industry and built the plan. Auto-Pilot is on — first actions will wait for your approval.',
    ob3_sector: 'INDUSTRY', ob3_comp: 'COMPETITORS', ob3_plan: 'CONTENT PLAN', ob3_ready: 'Ready', ob3_found: 'found',
    ob3_cta: 'Open dashboard',
    home_kicker: 'AUTO-PILOT ACTIVE',
    home_title: 'I did 6 things while you slept.',
    home_sub: 'Last 24 hours · KobiPratik',
    home_newkw: 'new kw',
    now: 'now',
    pend_badge: 'NEEDS APPROVAL',
    pend_title: 'I suggest raising the ASA bid',
    pend_desc: "'ön muhasebe' CPI is 31% under target. $0.38 → $0.45 could win #1 — est. +9 installs/day.",
    approve: 'Approve', reject: 'Reject',
    approved_badge: 'APPROVED', rejected_badge: 'REJECTED',
    approved_msg: 'Bid updated to $0.45 — impact reported within 24 hours.',
    rejected_msg: 'Suggestion dismissed. Auto-Pilot continues with the current bid.',
    auto: 'AUTOMATIC', queued: 'IN PUBLISH QUEUE',
    ask_ph: 'Tell the agent: "post this to X…"',
    tab_agent: 'Agent', tab_vis: 'Visibility',
    feed: [
      { title: 'Ranking climbed', desc: "'ön muhasebe' #8 → #3 — daily rank check, 50 keywords scanned.", time: '02:14', badge: 'auto' },
      { title: 'Article generated', desc: '"SMB tax calendar 2026" — 1,840 words, FAQ schema included. Ready to publish to WordPress.', time: '03:02', badge: 'queued' },
      { title: 'Published on LinkedIn', desc: '"5 critical dates for e-invoice transition" — 267 views, 12 interactions.', time: '08:30', badge: 'auto' },
      { title: 'New ChatGPT mention', desc: 'Your brand was recommended for "accounting software for SMBs".', time: '11:47', badge: null },
    ],
    vis_title: 'AI Visibility',
    vis_sub: 'Brand tracking across 7 AI engines · sentiment · share of voice',
    vis_score: 'CITATION SCORE',
    vis_caption: 'Cited in 128 answers · +34%',
    vis_engines: 'By engine',
    vis_road_sub: 'Reads your AI results, tells you what to do next',
    road: [
      { title: 'Add an llms.txt file', why: 'AI crawlers understand your site structure better — citation odds go up.', eff: 'EASY' },
      { title: 'Expand FAQ schema', why: "You'd surface as a Perplexity source for 'kobi kredisi' queries.", eff: 'EASY' },
      { title: 'Write a comparison page', why: "'X vs Y' queries trigger the most citations — you have none.", eff: 'MEDIUM' },
    ],
    aso_sub: 'App Store + Play Store keyword tracking and ads',
    aso_score: 'ASO SCORE', aso_thisweek: 'this week', aso_meta: 'Metadata 92 · Visuals 71 · Reviews 68',
    aso_kw: 'Keyword rankings',
    asa_imp: 'IMPRESSIONS', asa_tap: 'TAPS', asa_inst: 'INSTALLS',
    asa_note: 'Auto-Pilot paused 2 underperforming keywords yesterday, lowered the bid $0.50 → $0.38.',
    st_sub: 'One topic, every channel — text, image, video',
    st_ph: 'What should we create? e.g. "e-invoice transition guide"',
    st_gen: 'Generate', st_busy: 'GPT-5 writing 3 variants · DALL-E preparing visuals…',
    st_variants: '3 variants ready',
    st_share: 'Share', st_schedule: 'Schedule',
    variants: [
      { channel: '𝕏 / TWITTER', text: "E-invoicing becomes mandatory Jan 1 and 60% of SMBs still aren't ready. We wrote the 5-step transition guide — finish it before the tax penalty. 🔗", len: '214 chars' },
      { channel: 'LINKEDIN', text: 'E-invoice requirements expand in 2027. Our checklist for accounting teams: ✓ Integrator choice ✓ Test environment ✓ Archive setup. Full guide in comments.', len: '312 chars' },
      { channel: 'INSTAGRAM', text: 'Skip the e-invoice panic 📋 Carousel: transition timeline + deadlines in 5 slides. Save it, share it with your accountant.', len: 'Carousel · 5 images' },
    ],
  },
};

// ── Motor verisi (7 AI motoru, dönem bazında mention + delta) ──
export type Period = '7g' | '30g' | '90g';
export interface Engine {
  name: string; mono: string; dot: string;
  mentions: Record<Period, number>; delta: Record<Period, string>;
}
export const ENGINES: Engine[] = [
  { name: 'ChatGPT', mono: 'G', dot: '#10A37F', mentions: { '7g': 6, '30g': 18, '90g': 41 }, delta: { '7g': '+2', '30g': '+5', '90g': '+11' } },
  { name: 'Claude', mono: 'C', dot: '#D97757', mentions: { '7g': 3, '30g': 9, '90g': 22 }, delta: { '7g': '+1', '30g': '+3', '90g': '+8' } },
  { name: 'Gemini', mono: 'G', dot: '#4E86F5', mentions: { '7g': 3, '30g': 8, '90g': 19 }, delta: { '7g': '+1', '30g': '+2', '90g': '+5' } },
  { name: 'Perplexity', mono: 'P', dot: '#20B8CD', mentions: { '7g': 2, '30g': 6, '90g': 13 }, delta: { '7g': '0', '30g': '+1', '90g': '+4' } },
  { name: 'Grok', mono: 'X', dot: '#E8E4DE', mentions: { '7g': 1, '30g': 3, '90g': 6 }, delta: { '7g': '0', '30g': '0', '90g': '+2' } },
  { name: 'DeepSeek', mono: 'D', dot: '#4D6BFE', mentions: { '7g': 1, '30g': 2, '90g': 4 }, delta: { '7g': '0', '30g': '+1', '90g': '+1' } },
  { name: 'Meta AI', mono: 'M', dot: '#0668E1', mentions: { '7g': 0, '30g': 1, '90g': 2 }, delta: { '7g': '0', '30g': '0', '90g': '+1' } },
];

export type Store = 'ios' | 'play';
export interface Kw { name: string; rank: number; delta: string; dir: number; vol: string }
export const KW: Record<Store, Kw[]> = {
  ios: [
    { name: 'ön muhasebe', rank: 3, delta: '↑5', dir: 1, vol: '9.9K' },
    { name: 'kobi kredisi', rank: 8, delta: '↑2', dir: 1, vol: '6.1K' },
    { name: 'esnaf finansman', rank: 12, delta: '↓1', dir: -1, vol: '3.4K' },
    { name: 'ticari pos', rank: 23, delta: '↑7', dir: 1, vol: '2.8K' },
    { name: 'e-fatura programı', rank: 17, delta: '↑3', dir: 1, vol: '5.2K' },
  ],
  play: [
    { name: 'ön muhasebe', rank: 5, delta: '↑2', dir: 1, vol: '12K' },
    { name: 'kobi muhasebe', rank: 7, delta: '→0', dir: 0, vol: '4.7K' },
    { name: 'esnaf kredisi', rank: 9, delta: '↑4', dir: 1, vol: '3.9K' },
    { name: 'fatura takip', rank: 14, delta: '↑1', dir: 1, vol: '6.3K' },
    { name: 'ticari pos', rank: 31, delta: '↓2', dir: -1, vol: '2.1K' },
  ],
};

/** feed satırlarının ikon rengi + SVG path'i (sırayla) */
export const FEED_ICONS: [string, string][] = [
  ['#34D399', 'M7 17L17 7M8 7h9v9'],
  ['#F47F46', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  ['#38BDF8', 'M22 2L11 13M22 2l-7 20-4-9-9-4Z'],
  ['#A78BFA', 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z'],
];

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
