import { describe, it, expect } from 'vitest';
import { auditKeywordField, countBytes, countCharacters } from './keyword-field-audit.js';

const codes = (r: ReturnType<typeof auditKeywordField>) => r.findings.map((f) => f.code);
const find = (r: ReturnType<typeof auditKeywordField>, code: string) => r.findings.find((f) => f.code === code);

describe('auditKeywordField — sınır (karakter, bayt değil)', () => {
  it('Türkçe: ≤100 karakter ama >100 bayt → hata DEĞİL, bilgi notu', () => {
    const kw = 'ğüşıöç'.repeat(10); // 60 karakter, 120 bayt
    const r = auditKeywordField({ keywords: kw });
    expect(r).toMatchObject({ characters: 60, bytes: 120, remaining: 40 });
    expect(codes(r)).toEqual(['BYTES_OVER_100']);
    expect(find(r, 'BYTES_OVER_100')?.severity).toBe('info');
  });

  it('asc CLI #1399 Arapça örneği (91 karakter / 168 bayt) kabul edilir', () => {
    const kw = 'تغريدات,ردود,اعجابات,فلترة,بحث,ارشفة,ازالة,سجل,ريتويت,لايكات,منشن,خصوصية,منشورات,قديمة,حساب';
    expect(countCharacters(kw)).toBe(91);
    expect(countBytes(kw)).toBe(168);
    expect(auditKeywordField({ keywords: kw }).summary.error).toBe(0);
  });

  it('101 karakter → hata, en üstte', () => {
    const r = auditKeywordField({ keywords: `${'a'.repeat(50)},${'b'.repeat(50)}`, competitorNames: [] });
    expect(r.characters).toBe(101);
    expect(r.findings[0]).toMatchObject({ code: 'OVER_LIMIT', severity: 'error' });
    expect(r.remaining).toBe(0);
  });
});

describe('auditKeywordField — biçim ve tekrar', () => {
  it('boş segment, virgül çevresi boşluk, standart dışı ayraç; temiz alan önerilir', () => {
    const r = auditKeywordField({ keywords: 'takvim, ajanda,,hatırlatıcı ;planlayıcı\n' });
    expect(codes(r)).toEqual(expect.arrayContaining(['EMPTY_SEGMENT', 'SPACES_AROUND_COMMA', 'NONCANONICAL_SEPARATOR']));
    expect(find(r, 'SPACES_AROUND_COMMA')?.message).toMatch(/^2 gereksiz boşluk/);
    expect(r.cleanedField).toBe('takvim,ajanda,hatırlatıcı,planlayıcı');
    expect(r.cleanedCharacters).toBeLessThan(r.characters);
  });

  it('büyük/küçük ve İ/i farkı tekrarı gizlemez', () => {
    const r = auditKeywordField({ keywords: 'İzmir rehberi,izmir rehberi,Takvim,takvim' });
    expect(find(r, 'DUPLICATE_TERM')?.terms).toEqual(['izmir rehberi', 'takvim']);
    expect(r.cleanedField).toBe('İzmir rehberi,Takvim');
  });

  it('İngilizce çoğul (Apple örneği) bilgi; "app"/"game" genel terim', () => {
    const r = auditKeywordField({ keywords: 'photo,photos,story,stories,game' });
    expect(find(r, 'PLURAL_DUPLICATE')?.terms).toEqual(['photo/photos', 'story/stories']);
    expect(find(r, 'GENERIC_TERM')?.terms).toEqual(['game']);
  });

  it('2 karakter ve altı terim bilgi notu (Apple referansı)', () => {
    expect(find(auditKeywordField({ keywords: 'ai,seo aracı' }), 'SHORT_TERM')?.terms).toEqual(['ai']);
  });
});

describe('auditKeywordField — ad, alt başlık, şirket, rakip, kategori', () => {
  it('ad ve alt başlık kelime örtüşmesi; dolgu kelimeler sayılmaz', () => {
    const r = auditKeywordField({
      keywords: 'seo,görünürlük,rakip analizi,ai araçları,ve',
      appName: 'RanksUp: AI SEO',
      subtitle: 'Görünürlük ve sıralama takibi',
    });
    expect(find(r, 'OVERLAP_NAME')?.terms).toEqual(['seo', 'ai']);
    expect(find(r, 'OVERLAP_SUBTITLE')?.terms).toEqual(['görünürlük']);
  });

  it('şirket adı (A.Ş. eki atılır) tam ifade olarak aranır; tek ortak kelime yetmez', () => {
    const r = auditKeywordField({ keywords: 'luvihost teknoloji,teknoloji haberleri', companyName: 'LuviHost Teknoloji A.Ş.' });
    expect(find(r, 'OVERLAP_COMPANY')?.terms).toEqual(['luvihost teknoloji']);
  });

  it('rakip marka kısmı eşleşir ("Marka: açıklama"); açıklama kelimeleri ve kendi marka eşleşmez', () => {
    const r = auditKeywordField({
      keywords: 'todoist alternatifi,to do list,notion şablon',
      appName: 'Notion',
      competitorNames: ['Todoist: To-Do List & Planner', 'TickTick - To Do List', 'Notion', 'Go'],
    });
    expect(find(r, 'COMPETITOR_NAME')?.terms).toEqual(['todoist alternatifi (Todoist: To-Do List & Planner)']);
  });

  it('kategori kelimesi bilgi notu', () => {
    expect(find(auditKeywordField({ keywords: 'productivity tools,focus', categoryNames: ['Productivity'] }), 'CATEGORY_TERM')?.terms)
      .toEqual(['productivity']);
  });

  it('temiz alan → bulgu yok', () => {
    const r = auditKeywordField({ keywords: 'planlayıcı,ajanda,hatırlatıcı', appName: 'Takvimim', subtitle: 'Günlük plan' });
    expect(r.findings).toEqual([]);
    expect(r.summary).toEqual({ error: 0, warning: 0, info: 0 });
    expect(r.remaining).toBe(100 - r.characters);
  });

  it('boş alan → bulgu yok, tüm alan boş', () => {
    const r = auditKeywordField({ keywords: '' });
    expect(r).toMatchObject({ characters: 0, remaining: 100, terms: [], findings: [] });
  });
});
