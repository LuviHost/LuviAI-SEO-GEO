/**
 * RanksUp Video panel kurallari: yalniz yayindaki makale, durum metinleri, renk dogrulamasi,
 * istek govdesi (degismeyen duzeltme gonderilmez), kota satiri, dosya adi.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_VIDEO_COPY, VIDEO_STATUS_LABEL, activeVideoFor, canRequestVideo, formatVideoSize, hasActiveVideos, normalizeHex,
  quotaLine, videoFileName, videoRequestBody,
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
    expect(ARTICLE_VIDEO_COPY.lockedBody).toContain('15 saniyelik');
    expect(ARTICLE_VIDEO_COPY.lockedNote).toMatch(/yer tutucu/);
  });

  it('panelde sabit renk yok: varsayilan renk sunucudan (fallbackPrimary) gelir', () => {
    const src = readFileSync(new URL('./article-video.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
