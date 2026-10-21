#!/usr/bin/env node
/**
 * KobiPratik videolarinin okunurluk denetimi — her metin blogunun TAM gorunur kaldigi sureyi
 * sahne zamanlamasindan (src/marketing/timeline.json + src/kobipratik/kit.tsx giris/cikis ayarlari)
 * hesaplar ve kurali dogrular:
 *
 *   metin      ≥ max(2.0 sn, 0.3 sn × kelime + 1.0 sn)  (+ CARD_TIME, baslik bir kart/arayuzle birlikte okunuyorsa)
 *   kucuk not  ≥ max(3.0 sn, yukaridaki)                  (yasal not, "Örnek ekran" etiketi)
 *   liste      son oge geldikten sonra tum liste ≥ 2.5 sn ekranda
 *
 * "Tam gorunur" = giris yayi %95'e ulastigi kareden sahne cikisinin basladigi kareye kadar
 * (son sahnede videonun sonuna kadar). Giris/cikis sabitleri kit.tsx'ten okunur; metinlerin
 * hangi olay/sahne anina bagli oldugu asagidaki SPEC'te KobiPratikReels.tsx / KobiPratikIntro.tsx
 * ile ayni tutulur (bir metnin zamanlamasini kodda degistirirsen burayi da guncelle).
 *
 *   node scripts/check-kobipratik-readability.mjs            # tablo + ozet, kural ihlalinde cikis kodu 1
 *   node scripts/check-kobipratik-readability.mjs --brief    # yalniz ozet ve ihlaller
 *
 * Dekoratif ve okunmasi amaclanmayan ogeler (kancadaki tarayici sekmelerinin kesik etiketleri, iskelet
 * cizgiler, imlec) denetim disidir; ornek teklif kartlari "arayuz" olarak liste kuralina tabidir.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spring } from 'remotion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'src', 'marketing', 'timeline.json'), 'utf8'));
const KIT = readFileSync(join(ROOT, 'src', 'kobipratik', 'kit.tsx'), 'utf8');
const FPS = TIMELINE.fps;

const num = (re) => {
  const m = re.exec(KIT);
  if (!m) throw new Error(`kit.tsx icinde bulunamadi: ${re}`);
  return Number(m[1]);
};
const SNAP_LEAD = num(/export const SNAP_LEAD = (\d+)/);
const EXIT_FRAMES = num(/export const EXIT_FRAMES = (\d+)/);
const SNAP_CONFIG = {
  damping: num(/SNAP_CONFIG = \{[^}]*damping: ([\d.]+)/),
  stiffness: num(/SNAP_CONFIG = \{[^}]*stiffness: ([\d.]+)/),
  mass: num(/SNAP_CONFIG = \{[^}]*mass: ([\d.]+)/),
};

/** kural sabitleri */
const MIN_TEXT = 2.0;
const PER_WORD = 0.3;
const BASE = 1.0;
const MIN_NOTE = 3.0;
const LIST_HOLD = 2.5;
/** bir baslik ornek kart/arayuz grubuyla birlikte okunuyorsa eklenen sure */
const CARD_TIME = 1.0;

/** yayin %95'e ulastigi kare sayisi */
function settle(config) {
  for (let f = 0; f < 120; f++) if (spring({ frame: f, fps: FPS, config }) >= 0.95) return f;
  return 120;
}
const SNAP_SETTLE = settle(SNAP_CONFIG);
const SOFT_SETTLE = settle({ damping: 200 });

/** kelime sayisi; parantez ici aciklama ("(logo)") ve ·, —, & gibi isaretler sayilmaz */
const words = (t) => t.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function tl(id) {
  const def = TIMELINE.compositions[id];
  const fpb = (FPS * 60) / (def.bpm ?? TIMELINE.bpm);
  const f = (b) => Math.round(b * fpb);
  return {
    fpb,
    duration: f(def.beats),
    scene: (n) => def.scenes[n].map(f),
    at: (ev) => {
      const e = def.events.find((x) => x.id === ev);
      if (!e) throw new Error(`${id}: '${ev}' olayi yok`);
      return f(e.at);
    },
    event: (ev) => def.events.find((x) => x.id === ev),
    lastScene: Object.entries(def.scenes).sort((a, b) => b[1][1] - a[1][1])[0][0],
  };
}

/**
 * Metin tanimi:
 *   scene  sahne adi (bitis = sahne cikisinin basladigi kare; son sahnede video sonu)
 *   text   ekrandaki metin (kelime sayimi icin)
 *   at     (T) => giris karesi (snap/appear/KLine icin "vurus" karesi; yay SNAP_LEAD kare once baslar)
 *   enter  'snap' (varsayilan) | 'soft' | 'instant' | { lead }
 *   wrap   sahne SceneWrap/inP ile giriyorsa: sahne girisi de tamamlanmali (lead 5)
 *   kind   'text' (varsayilan) | 'note' (kucuk/yasal metin) | 'ui' (yalniz liste kurali)
 *   card   true → gerekli sureye CARD_TIME eklenir
 *   list   liste grubu adi
 */
const ev = (id, d = 0) => (T) => T.at(id) + d;
const sc = (name, d = 0) => (T) => T.scene(name)[0] + d;
const DISCLAIMER = 'KobiPratik kredi veren bir kurum değildir. Başvurular ilgili banka ya da ödeme kuruluşunun değerlendirmesine tabidir.';

const PRODUCT = (scene, n, title, sub, cardsPrefix) => [
  { scene, wrap: true, text: n, at: sc(scene), enter: { lead: 5 } },
  { scene, wrap: true, text: 'Örnek ekran · temsili değerler', at: sc(scene), enter: { lead: 5 }, kind: 'note' },
  { scene, wrap: true, text: title, at: sc(scene), card: true },
  ...(sub ? [{ scene, wrap: true, text: sub, at: sc(scene, 4), enter: 'soft' }] : []),
  ...[1, 2, 3].map((i) => ({ scene, wrap: true, text: `Örnek teklif kartı ${i}`, at: ev(`${cardsPrefix}.c${i}`), kind: 'ui', list: `${scene}.kartlar` })),
];

const SPEC = {
  KobiPratikReels: [
    { scene: 'hook', text: 'Ticari kredi?', at: ev('hook.w1', -4), list: 'hook.sorular' },
    { scene: 'hook', text: 'POS?', at: ev('hook.w2'), list: 'hook.sorular' },
    { scene: 'hook', text: 'Kredi kartı?', at: ev('hook.w3'), list: 'hook.sorular' },
    { scene: 'hook', text: 'Banka banka dolaşma.', at: ev('hook.line', 2) },
    { scene: 'brand', text: 'KobiPratik (logo)', at: sc('brand', 3) },
    { scene: 'brand', text: 'KOBİ’nin Finans Platformu', at: ev('brand.tag') },
    ...PRODUCT('card', '1/3', 'Ticari kredi kartı', 'Teklifleri yan yana gör', 'card'),
    ...PRODUCT('pos', '2/3', 'POS', '', 'pos'),
    ...['Sanal Pos', 'Fiziksel Pos', 'Cep Pos', 'Link Pos'].map((t, i) => ({ scene: 'pos', wrap: true, text: t, at: sc('pos', 4 + i * 3), list: 'pos.turler' })),
    ...PRODUCT('credit', '3/3', 'Ticari kredi', 'Tutar ve vadene göre karşılaştır', 'credit'),
    { scene: 'flow', text: 'Karşılaştır, kolayca başvur.', at: sc('flow', 3), card: true },
    { scene: 'flow', text: 'İhtiyacını seç — Kredi, kart ya da POS', at: ev('flow.s1'), list: 'flow.adimlar' },
    { scene: 'flow', text: 'Teklifleri karşılaştır — Tek ekranda, yan yana', at: ev('flow.s2'), list: 'flow.adimlar' },
    { scene: 'flow', text: 'Kolayca başvur — Başvurun seçtiğin kuruma iletilir', at: ev('flow.s3'), list: 'flow.adimlar' },
    { scene: 'flow', text: 'Değerlendirme ve onay ilgili bankaya ya da kuruma aittir.', at: ev('flow.note'), kind: 'note' },
    { scene: 'end', text: 'KobiPratik (logo)', at: sc('end', 4) },
    { scene: 'end', text: 'Karşılaştır, başvur.', at: sc('end', 8) },
    { scene: 'end', text: 'kobipratik.com', at: ev('end.url') },
    { scene: 'end', text: 'Kullanmak ücretsiz', at: ev('end.free') },
    { scene: 'end', text: DISCLAIMER, at: ev('end.free'), kind: 'note' },
  ],
  KobiPratikIntro: [
    { scene: 'hook', text: 'Kredi, POS, ticari kart…', at: () => 3 },
    { scene: 'hook', text: 'Her teklif ayrı bir sekmede mi?', at: ev('hook.line', 2) },
    { scene: 'hook', text: 'Hepsi tek platformda.', at: ev('hook.line2') },
    { scene: 'brand', text: 'KobiPratik (logo)', at: sc('brand', 3) },
    { scene: 'brand', text: 'KOBİ’nin Finans Platformu', at: ev('brand.name') },
    { scene: 'brand', text: 'KOBİ ve esnaf için finansal karşılaştırma platformu', at: ev('brand.tag') },
    { scene: 'who', wrap: true, text: 'Kimin için?', at: sc('who'), card: true },
    { scene: 'who', wrap: true, text: 'KOBİ ve esnafa özel odaklanma', at: sc('who', 5), enter: 'soft' },
    { scene: 'who', wrap: true, text: 'Esnaf — Tahsilat için POS, harcama için ticari kart', at: ev('who.p1'), list: 'who.kimler' },
    { scene: 'who', wrap: true, text: 'KOBİ’ler — Nakit ve finansman ihtiyacı', at: ev('who.p2'), list: 'who.kimler' },
    { scene: 'who', wrap: true, text: 'Yeni kurulan işletmeler — Onlar da başvuru yapabilir', at: ev('who.p3'), list: 'who.kimler' },
    { scene: 'products', wrap: true, text: 'Örnek ekran · temsili değerler', at: sc('products'), enter: { lead: 5 }, kind: 'note' },
    { scene: 'products', wrap: true, text: 'Teklifleri tek ekranda karşılaştır.', at: sc('products', 2), card: true },
    ...['Ticari Krediler', 'Ticari Kredi Kartları', 'POS Çözümleri'].map((t, i) => ({ scene: 'products', wrap: true, text: `${t} (+ örnek kart)`, at: ev(`products.p${i + 1}`), list: 'products.kartlar' })),
    { scene: 'products', wrap: true, text: 'Bankaların ve ödeme kuruluşlarının güncel kampanyaları, tek platformda.', at: ev('products.cmp') },
    { scene: 'tools', wrap: true, text: 'Hesapla, öğren.', at: sc('tools'), card: true },
    { scene: 'tools', wrap: true, text: 'Pratik Araçlar', at: ev('tools.left') },
    { scene: 'tools', wrap: true, text: '100+ ücretsiz hesaplama aracı', at: ev('tools.left') },
    {
      scene: 'tools',
      wrap: true,
      text: 'KDV hes (yazilan arama)',
      at: (T) => T.at('tools.type') + Math.floor(6 * T.event('tools.type').every * T.fpb) + 1,
      enter: 'instant',
    },
    ...['KDV Hesaplama', 'KDV Tevkifatı Hesaplama'].map((t, i) => ({ scene: 'tools', wrap: true, text: t, at: (T) => T.at('tools.type') + Math.round((0.75 + 0.25 * i) * T.fpb), list: 'tools.sonuclar' })),
    ...['Vergi ve Beyanname', 'Bordro ve Personel', 'Kredi ve Finansman'].map((t, i) => ({ scene: 'tools', wrap: true, text: t, at: ev(`tools.c${i + 1}`), list: 'tools.kategoriler' })),
    { scene: 'tools', wrap: true, text: 'Pratik KOBİ Rehberi', at: ev('tools.right') },
    { scene: 'tools', wrap: true, text: 'KOBİ ve esnafa uygulamalı rehberler', at: ev('tools.right') },
    ...[
      'POS Çözümleri — İşletmeniz İçin Doğru POS Nasıl Seçilir?',
      'Finansman & Nakit Akışı — Nakit Akışı Yönetimi: KOBİ Rehberi',
      'KOBİ Kredileri — Yeni Kurulan Şirketler Kredi Alabilir Mi?',
    ].map((t, i) => ({ scene: 'tools', wrap: true, text: t, at: ev(`tools.g${i + 1}`), list: 'tools.rehberler' })),
    { scene: 'how', wrap: true, text: '3 adımda karşılaştır, başvur.', at: sc('how', 2), card: true },
    { scene: 'how', wrap: true, text: 'İhtiyacını seç — Ticari kredi, kart ya da POS', at: ev('how.c1'), list: 'how.adimlar' },
    { scene: 'how', wrap: true, text: 'Teklifleri karşılaştır — Güncel kampanyalar tek ekranda', at: ev('how.c2'), list: 'how.adimlar' },
    { scene: 'how', wrap: true, text: 'Kolayca başvur — Başvurun ilgili kuruma iletilir', at: ev('how.c3'), list: 'how.adimlar' },
    { scene: 'how', wrap: true, text: 'İlgili kurumun dijital kanalına', at: ev('how.done') },
    { scene: 'trust', wrap: true, text: 'Neden KobiPratik?', at: sc('trust', 2), card: true },
    { scene: 'trust', wrap: true, text: 'Kullanmak ücretsiz — Üyelik ya da başvuru ücreti yok', at: ev('trust.t1'), list: 'trust.nedenler' },
    { scene: 'trust', wrap: true, text: 'Şeffaf karşılaştırma — Güncel ve anlaşılır bilgiler', at: ev('trust.t2'), list: 'trust.nedenler' },
    { scene: 'trust', wrap: true, text: 'Dijital ve pratik başvuru — Birçok üründe şubeye gitmeden', at: ev('trust.t3'), list: 'trust.nedenler' },
    { scene: 'trust', wrap: true, text: 'Yalnız seçtiğin kuruma — Başvurun onay verdiğin kurumla paylaşılır', at: ev('trust.t4'), list: 'trust.nedenler' },
    { scene: 'trust', wrap: true, text: 'KobiPratik kredi veren bir kurum değildir. Değerlendirme ve onay ilgili kuruma aittir.', at: ev('trust.note'), kind: 'note' },
    { scene: 'end', text: 'KobiPratik (logo)', at: sc('end', 4) },
    { scene: 'end', text: 'Karşılaştır, başvur.', at: sc('end', 8) },
    { scene: 'end', text: 'kobipratik.com', at: ev('end.url') },
    { scene: 'end', text: 'Kullanmak ücretsiz', at: ev('end.url') },
    { scene: 'end', text: DISCLAIMER, at: ev('end.note'), kind: 'note' },
  ],
};

function visibleFrom(T, item) {
  const a = item.at(T);
  const e = item.enter ?? 'snap';
  let f;
  if (e === 'instant') f = a;
  else if (e === 'soft') f = a + SOFT_SETTLE;
  else f = a - (typeof e === 'object' ? e.lead : SNAP_LEAD) + SNAP_SETTLE;
  if (item.wrap) f = Math.max(f, T.scene(item.scene)[0] - 5 + SNAP_SETTLE);
  return f;
}

function required(item) {
  if (item.kind === 'ui') return 0;
  let r = Math.max(MIN_TEXT, PER_WORD * words(item.text) + BASE) + (item.card ? CARD_TIME : 0);
  if (item.kind === 'note') r = Math.max(MIN_NOTE, r);
  return r;
}

const brief = process.argv.includes('--brief');
const sec = (f) => (f / FPS).toFixed(2);
let failures = 0;
const summary = [];

for (const [id, items] of Object.entries(SPEC)) {
  const T = tl(id);
  const rows = [];
  let minMargin = Infinity;
  let worst = '';
  for (const it of items) {
    const [, e] = T.scene(it.scene);
    const to = it.scene === T.lastScene ? T.duration : e - EXIT_FRAMES;
    const from = visibleFrom(T, it);
    const vis = (to - from) / FPS;
    const req = required(it);
    const ok = vis + 1e-9 >= req;
    if (!ok) failures++;
    if (it.kind !== 'ui' && vis - req < minMargin) {
      minMargin = vis - req;
      worst = it.text;
    }
    rows.push({
      sahne: it.scene,
      metin: it.text.length > 46 ? `${it.text.slice(0, 45)}…` : it.text,
      tur: (it.kind ?? 'text') + (it.card ? '+kart' : ''),
      kelime: it.kind === 'ui' ? '-' : words(it.text),
      'gorunur(sn)': `${sec(from)}–${sec(to)}`,
      'sure(sn)': vis.toFixed(2),
      'gerekli(sn)': it.kind === 'ui' ? '-' : req.toFixed(2),
      sonuc: ok ? 'OK' : 'KISA',
    });
  }
  // liste kurali
  const lists = {};
  for (const it of items) if (it.list) (lists[it.list] ??= []).push(it);
  const listRows = [];
  for (const [name, its] of Object.entries(lists)) {
    const last = Math.max(...its.map((it) => visibleFrom(T, it)));
    const until = Math.min(
      ...its.map((it) => {
        const [, e] = T.scene(it.scene);
        return it.scene === T.lastScene ? T.duration : e - EXIT_FRAMES;
      }),
    );
    const hold = (until - last) / FPS;
    const ok = hold + 1e-9 >= LIST_HOLD;
    if (!ok) failures++;
    listRows.push({ liste: name, oge: its.length, 'son oge tam(sn)': sec(last), 'tum liste(sn)': hold.toFixed(2), gerekli: LIST_HOLD.toFixed(2), sonuc: ok ? 'OK' : 'KISA' });
  }
  if (!brief) {
    console.log(`\n══ ${id} · ${(T.duration / FPS).toFixed(2)} sn · ${(FPS * 60) / T.fpb} BPM ══`);
    console.table(rows);
    console.table(listRows);
  }
  const bad = rows.filter((r) => r.sonuc !== 'OK').length + listRows.filter((r) => r.sonuc !== 'OK').length;
  summary.push({
    kompozisyon: id,
    'sure(sn)': (T.duration / FPS).toFixed(2),
    metin: rows.filter((r) => r.tur !== 'ui').length,
    liste: listRows.length,
    ihlal: bad,
    'en dar pay(sn)': minMargin.toFixed(2),
    'en dar metin': worst.length > 40 ? `${worst.slice(0, 39)}…` : worst,
  });
}

console.log(`\nGiris: yay %95 = ${SNAP_SETTLE} kare (vurustan ${SNAP_LEAD} kare once baslar), yumusak = ${SOFT_SETTLE} kare; cikis ${EXIT_FRAMES} kare; kart/arayuz payi ${CARD_TIME} sn`);
console.table(summary);
if (failures) {
  console.error(`\n${failures} okunurluk ihlali`);
  process.exit(1);
}
console.log('\nTum metinler okunurluk kuralini sagliyor (KobiPratikIntroVertical, KobiPratikIntro ile ayni zaman cizelgesini kullanir).');
