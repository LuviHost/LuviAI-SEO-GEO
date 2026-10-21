/**
 * RanksUp Video panel kurallari: yalniz yayindaki makale, durum metinleri, renk dogrulamasi,
 * istek govdesi (degismeyen duzeltme gonderilmez; makale govdesi eskisiyle ayni), kota satiri,
 * dosya adi, tanitim videolari (tur etiketi, urun adresi alan adi ipucu, suren kaynak kilidi).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_VIDEO_COPY, DEFAULT_VIDEO_TEMPO, MULTI_PART_SUFFIXES, VIDEO_FORMAT_OPTIONS, VIDEO_STATUS_LABEL, VIDEO_TEMPOS, VIDEO_TEMPO_LABEL,
  VIDEO_TEMPO_SECONDS, VIDEO_TYPE_LABEL, activePromoVideo, activeVideoFor, canRequestVideo, formatVideoSize, hasActiveVideos, normalizeHex,
  productUrlProblem, quotaLine, tempoDurationLabel, videoFileName, videoRequestBody, videoTempoOf, videoTypeOf,
} from './article-video';

describe('canRequestVideo — yalniz yayindaki makale', () => {
  it('PUBLISHED disindaki her durum kapali', () => {
    expect(canRequestVideo({ status: 'PUBLISHED' })).toBe(true);
    for (const status of ['DRAFT', 'SCHEDULED', 'GENERATING', 'EDITING', 'READY_TO_PUBLISH', 'FAILED', 'ARCHIVED', undefined]) {
      expect(canRequestVideo({ status }), String(status)).toBe(false);
    }
    expect(canRequestVideo(null)).toBe(false);
  });
});

describe('durumlar ve yoklama', () => {
  it('her durumun Turkce etiketi var', () => {
    expect(VIDEO_STATUS_LABEL).toEqual({ queued: 'Sırada', rendering: 'Hazırlanıyor', ready: 'Hazır', failed: 'Üretilemedi' });
  });

  it('sirada / hazirlanan video varsa yoklanir; ayni makale icin ikinci istek dugmesi kilitli', () => {
    expect(hasActiveVideos([{ status: 'ready' }, { status: 'failed' }])).toBe(false);
    expect(hasActiveVideos([{ status: 'ready' }, { status: 'rendering' }])).toBe(true);
    expect(hasActiveVideos(null)).toBe(false);
    expect(activeVideoFor([{ status: 'queued', articleId: 'a1' }], 'a1')).toBe(true);
    expect(activeVideoFor([{ status: 'ready', articleId: 'a1' }, { status: 'queued', articleId: 'a2' }], 'a1')).toBe(false);
  });
});

describe('renk ve istek govdesi', () => {
  it('yalniz #rrggbb; kisa yazim acilir; gecersiz deger null', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' 1D4ED8 ')).toBe('#1d4ed8');
    for (const v of ['red', '#1234', 'rgb(0,0,0)', '', null, 12]) expect(normalizeHex(v)).toBeNull();
  });

  it('degismeyen renk ve ad gonderilmez; sablon rengi null; logo kapatma gider', () => {
    const brand = { name: 'Örnek Klinik', primary: '#2563eb' };
    expect(videoRequestBody({ articleId: 'a1', brand, color: '#2563EB', useTemplateColor: false, useLogo: true, name: 'Örnek Klinik' }))
      .toEqual({ articleId: 'a1', useLogo: true });
    expect(videoRequestBody({ articleId: 'a1', brand, color: '#dc2626', useTemplateColor: false, useLogo: false, name: '  Örnek   Diş ' }))
      .toEqual({ articleId: 'a1', useLogo: false, primaryColor: '#dc2626', brandName: 'Örnek Diş' });
    expect(videoRequestBody({ articleId: 'a1', brand, color: 'gecersiz', useTemplateColor: true, useLogo: true, name: '' }))
      .toEqual({ articleId: 'a1', useLogo: true, primaryColor: null });
    // Marka okunamadiysa (brand null) secilen renk gonderilir
    expect(videoRequestBody({ articleId: 'a1', brand: null, color: '#10b981', useTemplateColor: false, useLogo: true, name: 'X' }))
      .toEqual({ articleId: 'a1', useLogo: true, primaryColor: '#10b981', brandName: 'X' });
  });
});

describe('kota satiri ve dosya', () => {
  it('kota metni; kapali planda metin yok (kilitli onizleme konusur); yonetici ayri', () => {
    expect(quotaLine({ allowed: true, used: 3, limit: 20, remaining: 17, unlimited: false })).toBe('Bu ay 3 / 20 video kullanıldı · 17 kaldı');
    expect(quotaLine({ allowed: false, used: 0, limit: 0, remaining: 0, unlimited: false })).toBeNull();
    expect(quotaLine({ allowed: true, used: 0, limit: 0, remaining: 0, unlimited: true })).toMatch(/Yönetici/);
    expect(quotaLine(null)).toBeNull();
  });

  it('dosya adi ASCII slug; boyut Turkce bicim', () => {
    expect(videoFileName('Fatura finansmanı nedir? İşletmeler için rehber', 'cmabc123456')).toBe('fatura-finansmani-nedir-isletmeler-icin-rehber-123456.mp4');
    expect(videoFileName('???', 'cmabc123456')).toBe('ranksup-video-123456.mp4');
    expect(formatVideoSize(4.2 * 1024 * 1024)).toBe('4,2 MB');
    expect(formatVideoSize(0)).toBeNull();
  });

  it('kilitli onizleme metni dogru plani ve dogru iddiayi soyler', () => {
    expect(ARTICLE_VIDEO_COPY.lockedTitle).toContain('Profesyonel');
    expect(ARTICLE_VIDEO_COPY.lockedBody).toContain('15–60 saniye, tempo seçilebilir');
    expect(ARTICLE_VIDEO_COPY.lockedBody).not.toContain('15 saniyelik');
    expect(ARTICLE_VIDEO_COPY.lockedNote).toMatch(/yer tutucu/);
  });

  it('panelde sabit renk yok: varsayilan renk sunucudan (fallbackPrimary) gelir', () => {
    const src = readFileSync(new URL('./article-video.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('site ve urun tanitim videolari', () => {
  const SITE = 'https://www.ornekdukkan.com.tr';

  it('tur etiketleri; eski yanit (type yok) makale sayilir; bicim secenekleri sure ile', () => {
    expect(VIDEO_TYPE_LABEL).toEqual({ article: 'Makaleden', site: 'Site tanıtımı', product: 'Ürün tanıtımı' });
    expect(videoTypeOf({})).toBe('article');
    expect(videoTypeOf({ type: 'product' })).toBe('product');
    // Sure bicimde yazmaz: tempoya bagli (tempoDurationLabel)
    expect(VIDEO_FORMAT_OPTIONS.site.map((o) => o.label)).toEqual(['Dikey 9:16', 'Yatay 16:9']);
    expect(VIDEO_FORMAT_OPTIONS.product.map((o) => o.format)).toEqual(['vertical', 'horizontal']);
  });

  it('urun adresi ipucu: kendi alan adi (www, alt alan) gecer; baska alan adi, IP, kimlik, sema reddedilir', () => {
    expect(productUrlProblem('', SITE)).toBeNull();
    expect(productUrlProblem('https://www.ornekdukkan.com.tr/urun/kupa', SITE)).toBeNull();
    expect(productUrlProblem('ornekdukkan.com.tr/urun/kupa', SITE)).toBeNull();
    expect(productUrlProblem('https://magaza.ornekdukkan.com.tr/p/1', SITE)).toBeNull();
    expect(productUrlProblem('https://rakip.com/urun', SITE)).toMatch(/ornekdukkan\.com\.tr/);
    expect(productUrlProblem('https://kotu-ornekdukkan.com.tr/u', SITE)).toMatch(/kendi alan adında/);
    expect(productUrlProblem('https://ornekdukkan.com.tr.evil.com/u', SITE)).toMatch(/kendi alan adında/);
    expect(productUrlProblem('http://93.184.216.34/u', SITE)).toMatch(/IP/);
    expect(productUrlProblem('https://a:b@www.ornekdukkan.com.tr/u', SITE)).toMatch(/şifre/);
    expect(productUrlProblem('ftp://www.ornekdukkan.com.tr/u', SITE)).toMatch(/http/);
  });

  it('kayitli alan adi soneki listesi sunucuyla AYNI (api audit/host-match.ts)', () => {
    const src = readFileSync(new URL('../../../api/src/audit/host-match.ts', import.meta.url), 'utf8');
    const block = /MULTI_PART_SUFFIXES = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? '';
    const server = [...block.matchAll(/'([a-z0-9.]+)'/g)].map((m) => m[1]);
    expect(server.length).toBeGreaterThan(10);
    expect([...MULTI_PART_SUFFIXES].sort()).toEqual([...server].sort());
  });

  it('istek govdesi: makale eskisiyle birebir (type yok); site ve urun tur + bicim tasir', () => {
    const brand = { name: 'Örnek', primary: '#2563eb' };
    expect(videoRequestBody({ target: { type: 'article', articleId: 'a1' }, brand, color: '#2563eb', useTemplateColor: false, useLogo: true, name: 'Örnek' }))
      .toEqual({ articleId: 'a1', useLogo: true });
    expect(videoRequestBody({ target: { type: 'site', format: 'horizontal' }, brand, color: '#2563eb', useTemplateColor: false, useLogo: false, name: 'Örnek' }))
      .toEqual({ type: 'site', format: 'horizontal', useLogo: false });
    expect(videoRequestBody({ target: { type: 'product', pageUrl: '  https://www.ornekdukkan.com.tr/urun/kupa ', format: 'vertical' }, brand, color: '#dc2626', useTemplateColor: false, useLogo: true, name: 'Örnek' }))
      .toEqual({ type: 'product', pageUrl: 'https://www.ornekdukkan.com.tr/urun/kupa', format: 'vertical', useLogo: true, primaryColor: '#dc2626' });
  });

  it('suren tanitim videosu: ayni tur + bicim (+ urunde ayni adres, # ve www farki yok sayilir) kilitler', () => {
    const vids = [
      { status: 'rendering' as const, type: 'site' as const, format: 'vertical' as const, sourceUrl: SITE },
      { status: 'queued' as const, type: 'product' as const, format: 'vertical' as const, sourceUrl: `${SITE}/urun/kupa` },
      { status: 'ready' as const, type: 'product' as const, format: 'horizontal' as const, sourceUrl: `${SITE}/urun/kupa` },
    ];
    expect(activePromoVideo(vids, 'site', 'vertical')).toBe(true);
    expect(activePromoVideo(vids, 'site', 'horizontal')).toBe(false);
    expect(activePromoVideo(vids, 'product', 'vertical', 'https://ornekdukkan.com.tr/urun/kupa#yorum')).toBe(true);
    expect(activePromoVideo(vids, 'product', 'horizontal', `${SITE}/urun/kupa`)).toBe(false);
    expect(activePromoVideo(vids, 'product', 'vertical', `${SITE}/urun/tabak`)).toBe(false);
  });

  it('kilitli onizleme uc turu ve sitenin kendi metni kuralini soyler', () => {
    expect(ARTICLE_VIDEO_COPY.lockedBody).toMatch(/ürün\/hizmet sayfasından/);
    expect(ARTICLE_VIDEO_COPY.lockedBody).toMatch(/yatay 16:9/);
  });
});

describe('tempo (Hizli / Normal / Yavas)', () => {
  it('uc tempo, Turkce etiketler; yeni isteklerde varsayilan normal', () => {
    expect([...VIDEO_TEMPOS]).toEqual(['fast', 'normal', 'slow']);
    expect(VIDEO_TEMPO_LABEL).toEqual({ fast: 'Hızlı', normal: 'Normal', slow: 'Yavaş' });
    expect(DEFAULT_VIDEO_TEMPO).toBe('normal');
  });

  it('yaklasik sure tur + bicim + tempoya gore; makale her zaman dikey', () => {
    expect(tempoDurationLabel('article', 'vertical', 'fast')).toBe('15 sn');
    expect(tempoDurationLabel('site', 'horizontal', 'fast')).toBe('24 sn');
    expect(tempoDurationLabel('article', 'horizontal', 'normal')).toBe(tempoDurationLabel('article', 'vertical', 'normal'));
    expect(tempoDurationLabel('product', 'vertical', 'normal')).toMatch(/^\d+–\d+ sn$/);
    // Tablo: hizli sabit sure; yavas normalden uzun baslar; hicbiri 60 sn'yi gecmez
    for (const [key, row] of Object.entries(VIDEO_TEMPO_SECONDS)) {
      expect(row.fast[0], key).toBe(row.fast[1]);
      expect(row.slow[0], key).toBeGreaterThan(row.normal[0]);
      expect(row.slow[1], key).toBeGreaterThanOrEqual(row.normal[1]);
      for (const t of VIDEO_TEMPOS) expect(row[t][1], `${key}.${t}`).toBeLessThanOrEqual(60);
    }
    expect(Object.keys(VIDEO_TEMPO_SECONDS).sort()).toEqual(['article.vertical', 'product.horizontal', 'product.vertical', 'site.horizontal', 'site.vertical']);
  });

  it('eski yanit / kayit (tempo yok) hizli sayilir (eski 15 sn izgarayla uretildi)', () => {
    expect(videoTempoOf({})).toBe('fast');
    expect(videoTempoOf({ tempo: 'slow' })).toBe('slow');
    expect(videoTempoOf({ tempo: 'turbo' } as unknown as Parameters<typeof videoTempoOf>[0])).toBe('fast');
  });

  it('istek govdesi secilen tempoyu tasir; verilmezse alan yok (sunucu varsayilani normal)', () => {
    const brand = { name: 'Örnek', primary: '#2563eb' };
    expect(videoRequestBody({ target: { type: 'article', articleId: 'a1' }, brand, color: '#2563eb', useTemplateColor: false, useLogo: true, name: 'Örnek', tempo: 'slow' }))
      .toEqual({ articleId: 'a1', useLogo: true, tempo: 'slow' });
    expect(videoRequestBody({ target: { type: 'site', format: 'vertical' }, brand, color: '#2563eb', useTemplateColor: false, useLogo: true, name: 'Örnek', tempo: 'fast' }))
      .toEqual({ type: 'site', format: 'vertical', useLogo: true, tempo: 'fast' });
    expect(videoRequestBody({ target: { type: 'article', articleId: 'a1' }, brand, color: '#2563eb', useTemplateColor: false, useLogo: true, name: 'Örnek' }))
      .toEqual({ articleId: 'a1', useLogo: true });
  });

  it('tempo listesi sunucuyla AYNI (api article-video.config.ts VIDEO_TEMPOS, DEFAULT_VIDEO_TEMPO)', () => {
    const src = readFileSync(new URL('../../../api/src/videos/article-video.config.ts', import.meta.url), 'utf8');
    const list = /VIDEO_TEMPOS = \[([^\]]*)\]/.exec(src)?.[1] ?? '';
    expect([...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...VIDEO_TEMPOS]);
    expect(src).toContain(`DEFAULT_VIDEO_TEMPO: VideoTempo = '${DEFAULT_VIDEO_TEMPO}'`);
  });
});
