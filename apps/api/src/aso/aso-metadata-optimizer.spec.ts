import { describe, it, expect } from 'vitest';
import { AsoMetadataOptimizerService } from './aso-metadata-optimizer.service.js';

const svc = new AsoMetadataOptimizerService();

describe('optimizeKeywordField — Türkçe güvenli', () => {
  it('İ korunur (toLowerCase U+0307 eklemez), tekrar ve başlık kelimesi atlanır, karakter = kod noktası', () => {
    const r = svc.optimizeKeywordField(['İzmir rehberi', 'izmir  rehberi', 'Takvim Uygulaması', 'çiçek'], ['Takvim']);
    expect(r.keyword_field).toBe('İzmir rehberi,Uygulaması,çiçek');
    expect(r.keyword_field).not.toMatch(/̇/);
    expect(r.length).toBe([...r.keyword_field].length);
    expect(r.skipped).toEqual(['izmir  rehberi']);
  });

  it('100 karakteri aşan terim atlanır; Türkçe harfler bayt değil karakter sayılır', () => {
    const r = svc.optimizeKeywordField(['ş'.repeat(60), 'ğ'.repeat(39), 'ü'.repeat(5)]);
    expect(r.length).toBe(100);                // 60 + virgül + 39
    expect(r.skipped).toEqual(['ü'.repeat(5)]);
  });
});

describe('calculateKeywordDensity — \\w yerine Unicode harf', () => {
  it('Türkçe kelimeler doğru sayılır', () => {
    expect(svc.calculateKeywordDensity('Çiçek açtı, çiçek kokuyor.', ['çiçek', 'açtı', 'gül'])).toEqual({ 'çiçek': 50, 'açtı': 25, 'gül': 0 });
  });

  it('kelime sınırı: "kart" "kartvizit" içinde sayılmaz; çok kelimeli terim', () => {
    expect(svc.calculateKeywordDensity('kartvizit kart bulut depolama', ['kart', 'bulut depolama'])).toEqual({ kart: 25, 'bulut depolama': 25 });
  });
});

describe('validateCharacterLimits — promo ve What\'s New', () => {
  it('promosyon metni 170, yenilikler 4000 karakter', () => {
    const r = svc.validateCharacterLimits({ platform: 'apple', promotional_text: 'x'.repeat(171), whats_new: 'y'.repeat(4000) });
    expect(r.find((x) => x.field === 'promotional_text')).toMatchObject({ ok: false, length: 171, limit: 170 });
    expect(r.find((x) => x.field === 'whats_new')).toMatchObject({ ok: true, limit: 4000 });
  });

  it('keyword alanı >100 bayt ama ≤100 karakter → OK + bayt notu', () => {
    const r = svc.validateCharacterLimits({ platform: 'apple', keyword_field: 'ş'.repeat(80) });
    expect(r[0]).toMatchObject({ field: 'keyword_field', ok: true, length: 80 });
    expect(r[0].message).toMatch(/^OK \(160 bayt/);
  });
});
