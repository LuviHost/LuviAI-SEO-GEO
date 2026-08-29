#!/usr/bin/env tsx
/**
 * 06-mailjet — kurumsal kampanyayi Mailjet Send API (v3.1) ile GUNLUK DALGA halinde gonderir.
 *
 * NEDEN dalga: 141+ adres tahmini (ad.soyad) → ilk gunler bounce yuksek olabilir; gunde
 * 100 → 200 → 400 ritmi ve bounce > %3'te DURMA kurali alan adi itibarini korur.
 * NEDEN --iys-onayli sart: Yonetmelik md. 5/2 (gonderici IYS kaydi) ve 6/6 (tacir
 * adresleri gonderimden ONCE IYS'ye yuklenir, ret listesi kontrol edilir). Bu bayrak
 * "yukledim ve kontrol ettim" beyanidir; olmadan gercek gonderim yapilmaz.
 *
 * Env (apps/api/.env — sohbete yazilmaz):
 *   MAILJET_API_KEY, MAILJET_SECRET, MAILJET_FROM_EMAIL (orn. emir@go.ranksup.ai),
 *   MAILJET_FROM_NAME (orn. "Emir Burgazlı · RanksUp"), MAILJET_REPLY_TO (istege bagli)
 *
 * Kullanim:
 *   npx tsx scripts/prospect/06-mailjet.ts --dns                       # gonderici alan adi icin SPF/DKIM kayitlari + durum
 *   npx tsx scripts/prospect/06-mailjet.ts --test sen@ranksup.ai       # ornek degerlerle test maili (IYS gerekmez)
 *   npx tsx scripts/prospect/06-mailjet.ts --segment finans-k1 --limit 100 --dry-run
 *   npx tsx scripts/prospect/06-mailjet.ts --segment finans-k1 --limit 100 --iys-onayli   # dalga 1
 *   npx tsx scripts/prospect/06-mailjet.ts --stats                     # kampanya istatistigi + bounce orani; >%3 → DUR
 *
 * Girdi : DATA_DIR/jetmail-import.csv (04) — email,ad,soyad,firma,unvan,sektor,segment,guven,konu_varyanti
 * Durum : DATA_DIR/mailjet-gonderim.csv — email,tarih,messageId,kampanya,durum (ayni adrese iki kez gonderilmez)
 * Sablon: reklam/pazarlama/kurumsal-mail-html/kurumsal-<sektor>.html (yoksa finans) + duz metin esi
 *         (kurumsal-mail-sablonlari.md §2-4'ten uretilir). {{ad}} → {{var:ad}}, {{unsubscribe}} → [[UNSUB_LINK_TR]].
 */
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, PROSPECT_DIR, REPO_ROOT, SEKTORLER, parseArgs, readCsv, sleep, jitter, writeCsv } from '../../src/prospect/prospect-utils.js';

const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === true;
const LIMIT = args.limit ? Number(args.limit) : 100;
const SEGMENT = typeof args.segment === 'string' ? String(args.segment) : null;
const IYS_ONAYLI = args['iys-onayli'] === true;
const TEST_TO = typeof args.test === 'string' ? String(args.test) : null;
const KAMPANYA = typeof args.kampanya === 'string' ? String(args.kampanya) : `kurumsal-${new Date().toISOString().slice(0, 10)}`;

const API = 'https://api.mailjet.com';
const KEY = process.env.MAILJET_API_KEY ?? '';
const SECRET = process.env.MAILJET_SECRET ?? '';
const FROM_EMAIL = process.env.MAILJET_FROM_EMAIL ?? '';
const FROM_NAME = process.env.MAILJET_FROM_NAME ?? 'RanksUp';
const REPLY_TO = process.env.MAILJET_REPLY_TO ?? FROM_EMAIL;

const DURUM_FILE = path.join(DATA_DIR, 'mailjet-gonderim.csv');
const HTML_DIR = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-html');
const MD_FILE = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-sablonlari.md');

/** Sektor → sablon anahtari ve ornek sektor sorusu (konu satiri/ana govde icin) */
const SEKTOR_META: Record<string, { html: string; mdBaslik: string; soru: string; ad: string }> = {
  finans: { html: 'kurumsal-finans.html', mdBaslik: 'Şablon A', soru: 'bana bir dijital banka öner', ad: 'finans' },
  'eticaret-perakende-teknoloji': { html: 'kurumsal-eticaret.html', mdBaslik: 'Şablon B', soru: 'telefon almak için hangi site güvenilir', ad: 'e-ticaret ve perakende' },
  'turizm-havayolu-telekom-otomotiv': { html: 'kurumsal-turizm.html', mdBaslik: 'Şablon C', soru: 'İstanbul-Londra için hangi havayolu', ad: 'seyahat, telekom ve otomotiv' },
};

/** Konu satirlari — A/B (kurumsal-mail-sablonlari.md §1) */
const KONU: Record<string, (firma: string, soru: string) => string> = {
  A: (firma) => `${firma} — AI görünürlük karnesi (sektör araştırması)`,
  B: (firma, soru) => `ChatGPT "${soru}" dendiğinde ${firma} geçiyor mu?`,
};

function auth(): string {
  if (!KEY || !SECRET) { console.error('MAILJET_API_KEY / MAILJET_SECRET yok (apps/api/.env)'); process.exit(2); }
  return 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');
}

async function mj<T = any>(method: 'GET' | 'POST', yol: string, body?: unknown): Promise<T> {
  const res = await fetch(API + yol, {
    method,
    headers: { authorization: auth(), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Mailjet ${method} ${yol} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : ({} as T);
}

/** HTML sablonu Mailjet sozdizimine cevir: {{ad}} → {{var:ad}}, {{unsubscribe}} → [[UNSUB_LINK_TR]] */
function htmlSablon(sektor: string): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  let f = path.join(HTML_DIR, meta.html);
  if (!fs.existsSync(f)) f = path.join(HTML_DIR, 'kurumsal-finans.html'); // sektor HTML'i henuz yoksa finans govdesi
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/\{\{unsubscribe\}\}/g, '[[UNSUB_LINK_TR]]');
  html = html.replace(/\{\{gonderen_eposta\}\}/g, REPLY_TO);
  html = html.replace(/\{\{(ad|soyad|firma|sektor_sorusu|unvan)\}\}/g, '{{var:$1}}');
  return html;
}

/** Duz metin sablon: markdown'daki ilgili ``` blogu (Sablon A/B/C) */
function metinSablon(sektor: string): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  const md = fs.existsSync(MD_FILE) ? fs.readFileSync(MD_FILE, 'utf8') : '';
  const bas = md.indexOf(`## ${meta.mdBaslik.split(' ')[0]} ${meta.mdBaslik.split(' ')[1]}`);
  const blok = bas >= 0 ? md.slice(bas).match(/```\n([\s\S]*?)\n```/)?.[1] : null;
  const govde = blok ?? `Sayın {{ad}} {{soyad}},\n\nRanksUp olarak ${meta.ad} sektörü için bağımsız bir AI görünürlük araştırması yürütüyoruz. {{firma}}'yı kapsama almak istiyoruz; "evet" derseniz 2 iş günü içinde karnenizi yalnız size iletiyorum.\n\nBu iletiyi almak istemiyorsanız: {{unsubscribe}}`;
  return govde
    .replace(/\{\{unsubscribe\}\}/g, '[[UNSUB_LINK_TR]]')
    .replace(/\{\{(ad|soyad|firma|sektor_sorusu|unvan)\}\}/g, '{{var:$1}}');
}

function mesaj(to: { email: string; ad: string; soyad: string; firma: string; unvan?: string; sektor: string; varyant: string }, testMi = false) {
  const meta = SEKTOR_META[to.sektor] ?? SEKTOR_META.finans;
  const konu = (KONU[to.varyant] ?? KONU.A)(to.firma, meta.soru);
  return {
    From: { Email: FROM_EMAIL, Name: FROM_NAME },
    ReplyTo: { Email: REPLY_TO, Name: FROM_NAME },
    To: [{ Email: to.email, Name: `${to.ad} ${to.soyad}`.trim() }],
    Subject: testMi ? `[TEST] ${konu}` : konu,
    TextPart: metinSablon(to.sektor),
    HTMLPart: htmlSablon(to.sektor),
    TemplateLanguage: true,
    Variables: { ad: to.ad, soyad: to.soyad, firma: to.firma, unvan: to.unvan ?? '', sektor_sorusu: meta.soru },
    CustomCampaign: KAMPANYA,
    CustomID: `${KAMPANYA}:${to.email}`,
    TrackOpens: 'enabled',
    TrackClicks: 'enabled',
    // NEDEN: tek tikla ret (RFC 8058) — Mailjet [[UNSUB_LINK_TR]] ile birlikte; IYS ret bildirimi ayrica yapilir
    Headers: { 'List-Unsubscribe': '<[[UNSUB_LINK_TR]]>' },
  };
}

async function dns(): Promise<void> {
  if (!FROM_EMAIL.includes('@')) { console.error('MAILJET_FROM_EMAIL yok'); process.exit(2); }
  const domain = FROM_EMAIL.split('@')[1];
  const r = await mj<{ Data: any[] }>('GET', `/v3/REST/dns/${domain}`);
  const d = r.Data?.[0];
  if (!d) { console.log(`Mailjet'te ${domain} kayitli degil — once Mailjet panelinden gonderici alan adi olarak ekle (Senders & Domains).`); return; }
  console.log(`Alan adi: ${domain}\n  SPF  durum: ${d.SPFStatus}  → TXT @ (${domain})  "${d.SPFRecordValue}"\n  DKIM durum: ${d.DKIMStatus}  → TXT ${d.DKIMRecordName}  "${d.DKIMRecordValue}"\n  DMARC (Mailjet vermez, kendin ekle): TXT _dmarc.${domain}  "v=DMARC1; p=quarantine; rua=mailto:dmarc@ranksup.ai"`);
  const s = await mj<{ Data: any[] }>('GET', `/v3/REST/sender?Email=${encodeURIComponent(FROM_EMAIL)}`).catch(() => ({ Data: [] }));
  console.log(`  Gonderici ${FROM_EMAIL}: ${s.Data?.[0]?.Status ?? 'kayitli degil (Mailjet > Senders & Domains > Add sender)'}`);
}

async function test(to: string): Promise<void> {
  const ornek = { email: to, ad: 'Ayşe', soyad: 'Yılmaz', firma: 'Örnek Bank', unvan: 'Dijital Pazarlama Direktörü', sektor: 'finans', varyant: 'A' };
  const r = await mj<any>('POST', '/v3.1/send', { Messages: [mesaj(ornek, true), mesaj({ ...ornek, sektor: 'eticaret-perakende-teknoloji', firma: 'Örnek Market', varyant: 'B' }, true)] });
  for (const m of r.Messages ?? []) console.log(`test → ${m.Status}${m.Errors ? ' ' + JSON.stringify(m.Errors).slice(0, 200) : ''}`);
  console.log('Gelen kutusunda: HTML gorunumu, duz metin surumu, ret linki ve baslik (Outlook/Gmail/M365) — mail-tester.com adresine de gonderip puanina bak (>=9/10).');
}

async function dalga(): Promise<void> {
  const liste = readCsv(path.join(DATA_DIR, 'jetmail-import.csv'));
  if (liste.length === 0) { console.error('jetmail-import.csv bos/yok — once 04-dogrula'); process.exit(1); }
  const gonderilen = new Map(readCsv(DURUM_FILE).map((r) => [r.email.toLowerCase(), r]));
  const hedef = liste
    .filter((r) => !SEGMENT || r.segment === SEGMENT || r.segment.startsWith(SEGMENT))
    .filter((r) => (SEKTORLER as readonly string[]).includes(r.sektor))
    .filter((r) => !gonderilen.has(r.email.toLowerCase()))
    .slice(0, LIMIT);
  console.log(`liste ${liste.length} · segment ${SEGMENT ?? 'tumu'} · daha once gonderilmis ${gonderilen.size} · bu dalga ${hedef.length}${DRY ? ' · DRY' : ''}`);
  if (hedef.length === 0) return;
  if (DRY) { console.log('DRY: gonderim yok; ilk 3 hedefin segment/varyanti:', hedef.slice(0, 3).map((h) => `${h.segment}/${h.konu_varyanti}`).join(', ')); return; }
  if (!IYS_ONAYLI) {
    console.error('\nDURDU: --iys-onayli yok. Gercek gonderim icin once (1) Luvi Host IYS kaydi, (2) bu adreslerin IYS\'ye yuklenmesi, (3) ret listesi kontrolu. Bunlari yaptiysan --iys-onayli ile tekrar kos. Prova icin --dry-run.');
    process.exit(3);
  }
  if (!FROM_EMAIL) { console.error('MAILJET_FROM_EMAIL yok'); process.exit(2); }

  const kayit: Array<Record<string, string>> = [...gonderilen.values()];
  let ok = 0, hata = 0;
  for (let i = 0; i < hedef.length; i += 50) {
    const parca = hedef.slice(i, i + 50);
    const body = { Messages: parca.map((r) => mesaj({ email: r.email, ad: r.ad, soyad: r.soyad, firma: r.firma, unvan: r.unvan, sektor: r.sektor, varyant: r.konu_varyanti || 'A' })) };
    let resp: any;
    try { resp = await mj('POST', '/v3.1/send', body); } catch (e: any) { console.error(`parca ${i / 50 + 1} hata: ${e.message.slice(0, 200)}`); hata += parca.length; continue; }
    (resp.Messages ?? []).forEach((m: any, j: number) => {
      const r = parca[j];
      const durum = m.Status === 'success' ? 'gonderildi' : `hata:${JSON.stringify(m.Errors ?? '').slice(0, 80)}`;
      if (m.Status === 'success') ok++; else hata++;
      kayit.push({ email: r.email, tarih: new Date().toISOString(), messageId: String(m.To?.[0]?.MessageID ?? ''), kampanya: KAMPANYA, durum });
    });
    await sleep(jitter(1500, 3000));
  }
  writeCsv(DURUM_FILE, kayit, ['email', 'tarih', 'messageId', 'kampanya', 'durum']);
  console.log(`gonderildi ${ok} · hata ${hata} · durum dosyasi: ${DURUM_FILE}\nYARIN: --stats ile bounce oranina bak; > %3 ise bir sonraki dalgayi ATMA, listeyi yeniden dogrula.`);
}

async function stats(): Promise<void> {
  const r = await mj<{ Data: any[] }>('GET', `/v3/REST/campaignoverview?CustomCampaign=${encodeURIComponent(KAMPANYA)}&Limit=50`).catch(() => ({ Data: [] }));
  const kampanyalar = (r.Data ?? []).filter((c: any) => !KAMPANYA || String(c.Title ?? c.CustomValue ?? '').includes('kurumsal'));
  if (kampanyalar.length === 0) {
    // Yedek: mesaj istatistikleri
    const s = await mj<{ Data: any[] }>('GET', `/v3/REST/messagesentstatistics?CustomCampaign=${encodeURIComponent(KAMPANYA)}`).catch(() => ({ Data: [] }));
    const d = s.Data?.[0];
    if (!d) { console.log(`Istatistik yok (kampanya: ${KAMPANYA}). --kampanya <ad> ile baska kampanya sec.`); return; }
    const toplam = Number(d.ProcessedCount ?? d.MessageSentCount ?? 0) || 1;
    const bounce = Number(d.BouncedCount ?? d.HardBouncedCount ?? 0) + Number(d.SoftBouncedCount ?? 0);
    const oran = bounce / toplam;
    console.log(`kampanya ${KAMPANYA}: islenen ${toplam} · teslim ${d.DeliveredCount ?? '?'} · bounce ${bounce} (%${(oran * 100).toFixed(1)}) · engellenen ${d.BlockedCount ?? '?'} · spam sikayeti ${d.SpamComplaintCount ?? '?'} · acilma ${d.OpenedCount ?? '?'} · tiklama ${d.ClickedCount ?? '?'}`);
    console.log(oran > 0.03 ? '⛔ bounce > %3 — DUR: sonraki dalgayi atma, bounce alan kisiler icin adaylar.csv sira 2 desenine gec.' : '✅ bounce esik altinda — sonraki dalga: 200/gun, sonra 400/gun.');
    return;
  }
  for (const c of kampanyalar) {
    const toplam = Number(c.ProcessedCount ?? 0) || 1;
    const bounce = Number(c.BouncedCount ?? 0);
    console.log(`${c.Title ?? c.CustomValue}: islenen ${toplam} · teslim ${c.DeliveredCount} · bounce ${bounce} (%${((bounce / toplam) * 100).toFixed(1)}) · acilma ${c.OpenedCount} · tiklama ${c.ClickedCount} · spam ${c.SpamComplaintCount ?? 0}`);
  }
}

async function main() {
  if (args.dns === true) return dns();
  if (TEST_TO) return test(TEST_TO);
  if (args.stats === true) return stats();
  return dalga();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
