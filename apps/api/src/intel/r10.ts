import { load } from 'cheerio';
import type { RawItem } from './collector.service.js';

/**
 * R10.net — Turkiye'nin en buyuk webmaster forumu. Turk KOBI'lerinin ve
 * SEO/GEO calisanlarinin kendi dilindeki iddialari ve sorulari burada.
 *
 * NASIL CEKILIR (19.11.2026, canli olculdu):
 * - RSS yok (external.php / rss.php 404). Alt forum listesi duz HTML:
 *   `li.thread` satirlarinda baslik, konu no, yazar, son mesaj tarihi,
 *   cevap ve goruntulenme sayisi var. Toplayici YALNIZ bu listeyi okur.
 * - Konu sayfasini (ilk mesaj + cevaplar) yalniz triage'i gecen kayitlar
 *   icin analist acar — gunde birkac istek. Dogru bilgi cogu zaman
 *   cevaplarda ("denedim, ise yaramadi"); yalniz baslik yetmez.
 * - robots.txt forum sayfalarina izin veriyor (Disallow yalniz /includes/,
 *   /login.php vb.).
 *
 * KIMLIK: Cloudflare "RanksUpBot" iceren UA'yi 403 ile geri ceviriyor; adi
 * "bot" icermeyen ama kim oldugumuzu soyleyen bu UA 200 aliyor. Sahip karari
 * (19.11.2026): bu kimlikle baslanir, ayni gun R10'a izin e-postasi gider.
 * R10 itiraz ederse kaynaklar katalogdan kapatilir — kimlik DEGISTIRILEREK
 * engel asilmaz.
 */
export const R10_USER_AGENT = 'RanksUpIntel/1.0 (+https://ranksup.ai)';

export function isR10Url(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'r10.net' || h.endsWith('.r10.net');
  } catch {
    return false;
  }
}

export function r10ForumUrl(slug: string): string {
  return `https://www.r10.net/${slug.replace(/^\/+|\/+$/g, '')}/`;
}

/**
 * Satis / hizmet ilani ve is ilani basliklari. Soru forumlarinda da
 * ("SEO Danismanligi") ilan cok; bunlar iddia tasimaz, triage'a hic gitmez.
 * Kasitli olarak para birimine BAKMAZ: "Sadece GEO ile 11 gunde 2354 dolar"
 * dogrulanacak bir iddiadir, ilan degil.
 */
const SALES_PATTERNS: RegExp[] = [
  /indirim/i,
  /kampanya/i,
  /\bpaket/i,
  /sipari[sş]/i,
  /fiyat/i,
  /sat[iı]l[iı]k/i,
  /%\s?\d+|\d+\s?%/,
  /hediye/i,
  /garantil/i,
  /hizmet\p{L}*\s+(veriyor|sunuyor|verilir|verilmektedir|sunulur|ba[sş]lad[iı])/iu,
  /hizmet\p{L}*\s+[üu]cretsiz|[üu]cretsiz\s+(seo|geo|analiz|rapor|hizmet|deneme)/iu,
  // "yapilir" TEK BASINA ilan degil: "GEO nasil yapilir?" bir sorudur
  /(?<!nas[iı]l\s)\byap[iı]l[iı]r\b|yapt[iı]r[iı]l[iı]r|yapt[iı]r[iı]lacak/iu,
  /ar[iı]yorum|aran[iı]yor|al[iı]nacak|eleman/i,
  /[cç][oö]z[uü]mleri\b|dan[iı][sş]manl[iı]k hizmeti/i,
  /kategori kurallar[iı]|forum kurallar[iı]/i,
];

export function isR10SalesThread(title: string, prefix = ''): boolean {
  const t = `${prefix} ${title}`;
  return SALES_PATTERNS.some((re) => re.test(t));
}

/**
 * R10 tarihi (Istanbul saati, UTC+3) → Date. Iki bicim var:
 * "19-11-2026 12:14:25" ve son iki gun icin "Bugün 18:42:07" / "Dün 23:49:28".
 * Bos tarih (bazi sabit konular) → null.
 */
export function parseR10Date(input: string | undefined | null, now: Date = new Date()): Date | null {
  const raw = String(input ?? '').trim();
  const rel = raw.match(/^(Bugün|Dün)[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/i);
  if (rel) {
    // Istanbul'daki "bugun"un takvim gunu: UTC+3 kaydirilmis anin UTC tarihi
    const ist = new Date(now.getTime() + 3 * 3_600_000);
    if (/^dün/i.test(rel[1])) ist.setUTCDate(ist.getUTCDate() - 1);
    const ymd = ist.toISOString().slice(0, 10);
    const d = new Date(`${ymd}T${rel[2]}:${rel[3]}:${rel[4] ?? '00'}+03:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = raw.match(/(\d{2})-(\d{2})-(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? '00'}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(input: string): number | null {
  const n = parseInt(input.replace(/\D+/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Alt forum listesi → ham kayitlar. Satis ilanlari burada elenir.
 * publishedAt = listede gorunen SON MESAJ zamani (liste acilis tarihini
 * vermiyor); analist konu sayfasini actiginda ilk mesajin tarihi metnin
 * basina yazilir.
 */
export function parseR10ForumList(html: string, forum: string): RawItem[] {
  const $ = load(html);
  const out: RawItem[] = [];
  const seen = new Set<string>();

  $('li.thread').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a[id^="thread_title_"]').first();
    const threadId = ($a.attr('id') ?? '').replace('thread_title_', '');
    const href = $a.attr('href') ?? '';
    const title = $a.text().replace(/\s+/g, ' ').trim();
    if (!/^\d+$/.test(threadId) || !href || !title || seen.has(threadId)) return;
    seen.add(threadId);

    const prefix = $el.find('.title .prefix').first().text().replace(/\s+/g, ' ').trim();
    if (isR10SalesThread(title, prefix)) return;

    const author = $el.find('.user .desktop a.usernames').first().text().trim() || null;
    const lastPostAt = parseR10Date($el.find('div.date').first().text());
    const replies = num($el.find('[title="Cevap Sayısı"]').first().text());
    const views = num($el.find('[title="Görüntülenme Sayısı"]').first().text());

    out.push({
      url: href.replace(/#.*$/, ''),
      title,
      author,
      publishedAt: lastPostAt,
      summary: [
        `R10.net forum konusu (${forum})`,
        replies !== null ? `${replies} cevap` : null,
        views !== null ? `${views} goruntulenme` : null,
      ].filter(Boolean).join(' · '),
      engagement: replies,
      meta: { forum, threadId, replies, views, lastPostAt: lastPostAt?.toISOString() ?? null },
    });
  });

  return out;
}

/** Konu sayfasindan alinacak azami mesaj (ilk sayfa ~10-20 mesaj) */
const MAX_POSTS = 20;
/** Tek mesajin azami uzunlugu — imza/alinti sisirmesin */
const MAX_POST_CHARS = 3000;

/**
 * Konu sayfasi → analiste gidecek temiz metin: ilk mesaj + cevaplar,
 * her biri sira no, yazar ve tarihle. Menu ve kenar cubugu (sayfanin
 * ~1 MB'i) atilir. Mesaj bulunamazsa null (analist ozete duser).
 */
export function extractR10Thread(html: string): string | null {
  const $ = load(html);
  const parts: string[] = [];

  $('.postList li.post').slice(0, MAX_POSTS).each((i, el) => {
    const $el = $(el);
    const $body = $el.find('.postContent').first().clone();
    // Alintilanan onceki mesaj tekrar sayilmasin; imza iddia degil
    $body.find('blockquote, .quote, .signature, script, style').remove();
    const text = $body.text().replace(/\s+/g, ' ').trim().slice(0, MAX_POST_CHARS);
    if (!text) return;
    const author = $el.find('.postUser .name a').first().text().trim() || 'bilinmiyor';
    const date = $el.find('.head .left').first().text().replace(/\s+/g, ' ').trim();
    parts.push(`[#${i + 1}${i === 0 ? ' ilk mesaj' : ' cevap'} · ${author} · ${date}]\n${text}`);
  });

  return parts.length > 0 ? parts.join('\n\n') : null;
}
