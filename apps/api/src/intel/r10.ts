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

/** Konudan alinacak azami mesaj (R10 sayfa basi 9 mesaj gosterir → 3 sayfa) */
export const R10_MAX_POSTS = 20;
/** Ilk sayfadan sonra en fazla kac sayfa daha acilir */
export const R10_MAX_EXTRA_PAGES = 2;
/**
 * Mesaj basina azami uzunluk. Ilk mesaj cogu zaman rehberin/iddianin
 * kendisi (20.11.2026: "AI Modu rehberi" 3000'de kesiliyordu); cevaplar
 * kisa tutulur ki imza/tekrar metni sisirmesin.
 */
const MAX_FIRST_POST_CHARS = 12_000;
const MAX_REPLY_CHARS = 3000;

export interface R10Post {
  order: number;
  author: string;
  date: string;
  text: string;
}

/**
 * Konu sayfasi → mesajlar (sira no, yazar, tarih, metin).
 *
 * ALINTI: R10'da gercek alinti `div.quote` ("X adli uyeden alinti").
 * `<blockquote>` ALINTI DEGIL — yazarlar kendi metinlerini bicim icin
 * blockquote'a koyuyor (20.11.2026: "Core Update ... 1 Aylik Tablo"
 * konusunun tum metni blockquote icindeydi ve okuyucu konuyu bos
 * sanmisti). O yuzden yalniz `.quote` atilir.
 */
export function extractR10Posts(html: string): R10Post[] {
  const $ = load(html);
  const posts: R10Post[] = [];

  $('.postList li.post').each((i, el) => {
    const $el = $(el);
    const order = parseInt($el.attr('data-order') ?? '', 10) || i + 1;
    // Imza ayri bir .postContent (userSignature); mesaj govdesi ilk olan
    const $body = $el.find('.postContent').not('.userSignature').first().clone();
    $body.find('.quote, .signature, script, style').remove();
    const limit = order === 1 ? MAX_FIRST_POST_CHARS : MAX_REPLY_CHARS;
    const text = $body.text().replace(/\s+/g, ' ').trim().slice(0, limit);
    if (!text) return;
    const author = $el.find('.postUser .name a').first().text().trim() || 'bilinmiyor';
    const date = $el.find('.head .left').first().text().replace(/\s+/g, ' ').trim();
    posts.push({ order, author, date, text });
  });

  return posts;
}

/**
 * Konunun sonraki sayfalari (2, 3, ...) — `.pagination a[data-page]`.
 * Yalniz r10.net adresleri, sira numarasina gore.
 */
export function r10ThreadPageUrls(html: string): string[] {
  const $ = load(html);
  const pages = new Map<number, string>();
  $('.pagination a[data-page]').each((_, el) => {
    const n = parseInt($(el).attr('data-page') ?? '', 10);
    const href = ($(el).attr('href') ?? '').replace(/#.*$/, '');
    if (n > 1 && href && isR10Url(href) && !pages.has(n)) pages.set(n, href);
  });
  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, u]) => u);
}

/** Mesajlar → analiste gidecek temiz metin. Tekrar eden sira no elenir. */
export function formatR10Thread(posts: R10Post[]): string | null {
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const p of posts) {
    if (seen.has(p.order) || parts.length >= R10_MAX_POSTS) continue;
    seen.add(p.order);
    parts.push(`[#${p.order}${p.order === 1 ? ' ilk mesaj' : ' cevap'} · ${p.author} · ${p.date}]\n${p.text}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Tek sayfa → analiste gidecek temiz metin: ilk mesaj + cevaplar, her
 * biri sira no, yazar ve tarihle. Menu ve kenar cubugu (sayfanin ~1 MB'i)
 * atilir. Mesaj bulunamazsa null (analist ozete duser). Sonraki sayfalari
 * analist r10ThreadPageUrls ile ayrica acar.
 */
export function extractR10Thread(html: string): string | null {
  return formatR10Thread(extractR10Posts(html));
}
