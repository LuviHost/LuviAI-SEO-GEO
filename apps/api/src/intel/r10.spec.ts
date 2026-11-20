import { describe, it, expect } from 'vitest';
import {
  R10_MAX_POSTS, R10_USER_AGENT, extractR10Posts, extractR10Thread, formatR10Thread, isR10SalesThread, isR10Url,
  parseR10Date, parseR10ForumList, r10ForumUrl, r10ThreadPageUrls, type R10Post,
} from './r10.js';
import { INTEL_SOURCES } from './source-registry.js';

/** R10 alt forum satirinin (19.11.2026 canli sayfa) sadelestirilmis kopyasi */
const row = (id: string, title: string, opts: { prefix?: string; replies?: string; date?: string } = {}) => `
<li class="thread"><ol>
  <li><div class="title"><span class="prefix">${opts.prefix ?? ' '}</span>
    <a rel="ugc" href="https://www.r10.net/geo/${id}-konu.html" id="thread_title_${id}" style="font-weight:bold"><span>${title}</span></a>
  </div>
  <div class="user"><div class="desktop"><a href="https://www.r10.net/profil/1-yazar.html" class="usernames">yazar${id}</a></div></div></li>
  <li><div class="date">${opts.date ?? '11-11-2026 19:27:21'} </div></li>
  <li><span title="Cevap Sayısı">${opts.replies ?? '8'}</span> <span title="Görüntülenme Sayısı">4.026</span></li>
</ol></li>`;

const LIST = `<html><body><ol>
${row('4926115', 'Sadece GEO ile 11 gunde 2354 dolar')}
${row('4892528', 'ChatGPT backlink kullanıyor mu?', { replies: '32', date: '12-11-2026 12:14:25' })}
${row('4902868', 'DeepSeek GEO Hizmeti Ücretsiz')}
${row('1936197', 'Tüm paketlerde %50 indirim')}
${row('4767109', 'GEO nasıl yapılır?')}
${row('4767109', 'GEO nasıl yapılır?')}
<li class="thread"><a id="thread_title_" href="https://www.r10.net/geo/x.html">Sabit konu</a></li>
</ol></body></html>`;

describe('R10 alt forum listesi', () => {
  it('konulari baslik, yazar, son mesaj ve cevap sayisiyla cikarir; ilanlari ve tekrarlari eler', () => {
    const items = parseR10ForumList(LIST, 'geo');
    expect(items.map((i) => i.title)).toEqual([
      'Sadece GEO ile 11 gunde 2354 dolar',
      'ChatGPT backlink kullanıyor mu?',
      'GEO nasıl yapılır?',
    ]);
    const bl = items[1];
    expect(bl.url).toBe('https://www.r10.net/geo/4892528-konu.html');
    expect(bl.author).toBe('yazar4892528');
    expect(bl.engagement).toBe(32);
    expect(bl.publishedAt?.toISOString()).toBe('2026-11-12T09:14:25.000Z');
    expect(bl.summary).toContain('32 cevap');
    expect(bl.meta).toMatchObject({ forum: 'geo', threadId: '4892528', views: 4026 });
  });

  it('sayfada konu yoksa bos dizi (Cloudflare engel sayfasi gibi)', () => {
    expect(parseR10ForumList('<html><title>Attention Required! | Cloudflare</title></html>', 'geo')).toEqual([]);
  });
});

describe('isR10SalesThread — satis/hizmet/is ilani', () => {
  it.each([
    'Tüm paketlerde 1 alana 1 bedava ekstra %35 indirim',
    'DeepSeek GEO Hizmeti Ücretsiz',
    'Premium backlink paketi — 9000 sipariş',
    'SEO hizmeti veriyorum, uygun fiyat',
    'GEO uzmanı arıyorum',
    'Kurumsal ve bireysel SEO çözümleri',
    'GEO (Generative Engine Optimization) Kategori Kuralları',
    'WordPress site SEO çalışması yaptırılacak',
  ])('ilan: %s', (t) => expect(isR10SalesThread(t)).toBe(true));

  it.each([
    'Sadece GEO ile 11 gunde 2354 dolar',
    'İlk aydan 124 bin TL sadece GEO',
    'ChatGPT backlink kullanıyor mu?',
    'GEO nasıl yapılır?',
    'Dizine Eklenemedi Sorunu',
    'Google açıkladı: iyi SEO iyi GEO demek',
  ])('soru/iddia kalir: %s', (t) => expect(isR10SalesThread(t)).toBe(false));

  it('on ek (prefix) da kontrol edilir', () => {
    expect(isR10SalesThread('Kurumsal SEO', 'Satılık')).toBe(true);
  });
});

describe('R10 yardimcilari', () => {
  it('tarih Istanbul saatiyle okunur', () => {
    expect(parseR10Date('09-11-2026, 11:38:54')?.toISOString()).toBe('2026-11-09T08:38:54.000Z');
    expect(parseR10Date('Bugün')).toBeNull();
    expect(parseR10Date('')).toBeNull();
  });
  it('"Bugün" / "Dün" Istanbul takvimine gore', () => {
    // 19.11.2026 22:30 UTC = Istanbul'da 20.11 01:30 → "bugun" 20.11
    const now = new Date('2026-11-19T22:30:00Z');
    expect(parseR10Date('Bugün 00:56:18', now)?.toISOString()).toBe('2026-11-19T21:56:18.000Z');
    expect(parseR10Date('Dün 23:49:28', now)?.toISOString()).toBe('2026-11-19T20:49:28.000Z');
  });
  it('adres yardimcilari', () => {
    expect(r10ForumUrl('/geo/')).toBe('https://www.r10.net/geo/');
    expect(isR10Url('https://www.r10.net/geo/1-a.html')).toBe(true);
    expect(isR10Url('https://r10.net.evil.com/x')).toBe(false);
  });
  it('kimlik RanksUp diyor ve "bot" kelimesini tasimiyor (Cloudflare 403 olcumu)', () => {
    expect(R10_USER_AGENT).toContain('RanksUp');
    expect(R10_USER_AGENT.toLowerCase()).not.toContain('bot');
  });
});

/** R10 konu sayfasindaki mesaj (20.11.2026 canli sayfa yapisi) */
const post = (n: number, author: string, date: string, body: string, signature = 'Web tasarım ve SEO: Kaynak Ol') => `
<li class="post" id="edit${n}" data-order="${n}"><div id="post${n}">
  <div class="head"><div class="left">
    ${date}
  </div></div>
  <div class="postUser"><div class="name"><a class="uToggle">${author}</a></div></div>
  <div class="postContent ${n === 1 ? 'userMessage ' : ''}userMessageSize">${body}</div>
  <div class="postContent userSignature">${signature}</div>
</div></li>`;

/** R10'un gercek alinti kalibi */
const quote = (who: string, msg: string) => `<div class="quote linked">
  <div class="user">${who} adlı üyeden alıntı: <span class="link"><a href="#post1">mesajı görüntüle</a></span></div>
  <div class="message"><div class="readMore">${msg}</div></div></div>`;

const pagination = (base: string, pages: number) => `<div class="pagination"><ul>
  <li class="active"><a href="${base}.html#">1</a></li>
  ${Array.from({ length: pages - 1 }, (_, i) => `<li><a class="smallfont" href="${base}-${i + 2}.html" data-page="${i + 2}">${i + 2}</a></li>`).join('')}
  <li class="next"><a class="infiniteNext" href="${base}-2.html"></a></li></ul></div>`;

describe('R10 konu sayfasi → analist metni', () => {
  it('ilk mesaj ve cevaplar yazar ve tarihle; alinti, imza ve menu atilir', () => {
    const html = `<html><body><nav>Menü Forumlar Giriş</nav><div class="postList"><ul>
      ${post(1, 'bydarius', '09-11-2026, 11:38:54', 'Google açıkladı: <b>iyi SEO iyi GEO</b> demek.')}
      ${post(2, 'tabela26', '09-11-2026, 12:00:00', `${quote('bydarius', 'Google açıkladı: iyi SEO')} Bunu denedim, AI Modu'nda tek başına yetmedi.`)}
    </ul></div></body></html>`;
    const text = extractR10Thread(html)!;
    expect(text).toContain('[#1 ilk mesaj · bydarius · 09-11-2026, 11:38:54]');
    expect(text).toContain('iyi SEO iyi GEO demek.');
    expect(text).toContain('[#2 cevap · tabela26');
    expect(text).toContain('Bunu denedim');
    expect(text).not.toContain('Menü');
    expect(text).not.toContain('Kaynak Ol');
    // alinti ikinci mesajda tekrar sayilmaz
    expect(text.split('Google açıkladı').length - 1).toBe(1);
  });

  it('blockquote ALINTI DEGIL: yazarin kendi metni okunur', () => {
    // 20.11.2026: "Core Update Devam Ediyor" konusunun tum metni blockquote icindeydi
    const html = `<div class="postList"><ul>${post(1, 'kaynakol', '18-11-2026, 10:00:00',
      '<blockquote><font color="#FFFFFF">Yaklaşık 1 aydır site üzerinde çalışıyoruz ve core update ile ciddi bir yükseliş yaşadık.</font></blockquote><img src="x.png">')}</ul></div>`;
    expect(extractR10Thread(html)).toContain('core update ile ciddi bir yükseliş');
  });

  it('sira no sayfadaki data-order; ikinci sayfa #11 ile baslar', () => {
    const p2 = `<div class="postList"><ul>${post(11, 'u11', '18-11-2026', 'İkinci sayfadaki cevap metni.')}</ul></div>`;
    expect(extractR10Posts(p2)[0]).toMatchObject({ order: 11, author: 'u11' });
  });

  it('ilk mesaj uzun rehberse 3000 karakterde kesilmez; cevap kesilir', () => {
    const long = 'a'.repeat(8000);
    const html = `<div class="postList"><ul>${post(1, 'u', 'd', long)}${post(2, 'v', 'd', long)}</ul></div>`;
    const [first, reply] = extractR10Posts(html);
    expect(first.text.length).toBe(8000);
    expect(reply.text.length).toBe(3000);
  });

  it('sonraki sayfa adresleri yalniz r10.net, siraya gore, 1. sayfa haric', () => {
    const base = 'https://www.r10.net/google-optimizasyon/4930946-ilk-2-hafta';
    const html = `${pagination(base, 3)}<div class="pagination"><a data-page="9" href="https://evil.com/x.html">9</a></div>`;
    expect(r10ThreadPageUrls(html)).toEqual([`${base}-2.html`, `${base}-3.html`]);
    expect(r10ThreadPageUrls('<div class="pagination"></div>')).toEqual([]);
  });

  it('birlestirme: tekrar eden sira no bir kez, en fazla R10_MAX_POSTS mesaj', () => {
    const p = (order: number): R10Post => ({ order, author: 'a', date: 'd', text: `mesaj ${order}` });
    const text = formatR10Thread([p(1), p(2), p(2), ...Array.from({ length: 30 }, (_, i) => p(i + 3))])!;
    expect(text.split('[#2 cevap').length - 1).toBe(1);
    expect(text.match(/^\[#/gm)).toHaveLength(R10_MAX_POSTS);
    expect(formatR10Thread([])).toBeNull();
  });

  it('mesaj yoksa null', () => {
    expect(extractR10Thread('<html><body>Attention Required</body></html>')).toBeNull();
  });
});

describe('katalog — R10 kaynaklari', () => {
  const r10 = INTEL_SOURCES.filter((s) => s.kind === 'r10');
  it('dort tartisma forumu; hizmet pazarlari yok; topluluk katmani, agirlik 20, gunde bir', () => {
    expect(r10.map((s) => s.target).sort()).toEqual([
      'geo', 'google-haberleri-yenilikleri', 'google-optimizasyon', 'local-seo',
    ]);
    for (const s of r10) {
      expect(s).toMatchObject({ tier: 'community', weight: 20, intervalHours: 24 });
      expect(s.target).not.toMatch(/hizmet|paket|satis|danismanligi|site-ici|wordpress/);
    }
  });
  it('anahtarlar benzersiz', () => {
    const keys = INTEL_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
