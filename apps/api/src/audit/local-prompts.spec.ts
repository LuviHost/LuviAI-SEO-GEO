import { describe, it, expect } from 'vitest';
import {
  buildLocalPrompts, isLocalPrompt, localTags, locativeTr, parseLocalPromptSpec, readLocalTags,
  titleCaseTr, LOCAL_PROMPT_SOURCE, MAX_LOCAL_DRAFTS,
} from './local-prompts.js';

describe('locativeTr — bulunma hali eki', () => {
  it('unlu uyumu ve sert unsuz', () => {
    expect(locativeTr('Kadıköy')).toBe("Kadıköy'de");
    expect(locativeTr('Çankaya')).toBe("Çankaya'da");
    expect(locativeTr('Beşiktaş')).toBe("Beşiktaş'ta");
    expect(locativeTr('İzmit')).toBe("İzmit'te");
    expect(locativeTr('Konak')).toBe("Konak'ta");
    expect(locativeTr('Bodrum')).toBe("Bodrum'da");
    expect(locativeTr('İstanbul')).toBe("İstanbul'da");
  });

  it('iyelik ekiyle biten bilesik adlar araya "n" alir', () => {
    expect(locativeTr('Beyoğlu')).toBe("Beyoğlu'nda");
    expect(locativeTr('Zeytinburnu')).toBe("Zeytinburnu'nda");
    expect(locativeTr('Beylikdüzü')).toBe("Beylikdüzü'nde");
    expect(locativeTr('Gölbaşı')).toBe("Gölbaşı'nda");
    expect(locativeTr('Kuşadası')).toBe("Kuşadası'nda");
    expect(locativeTr('Kocaeli')).toBe("Kocaeli'nde");
    // "ada" iyelik degil
    expect(locativeTr('Bozcaada')).toBe("Bozcaada'da");
  });
});

describe('parseLocalPromptSpec', () => {
  it('il kanonik ada cevrilir, ilce Turkce buyuk harfle, tekrarlar atilir', () => {
    const r = parseLocalPromptSpec({ il: 'istanbul', ilceler: 'kadıköy, Kadıköy , üsküdar', hizmetler: ['kuaför', ' kuaför ', 'saç boyama'] });
    expect(r).toEqual({ ok: true, spec: { il: 'İstanbul', ilceler: ['Kadıköy', 'Üsküdar'], hizmetler: ['kuaför', 'saç boyama'] } });
  });

  it('hatali girdiler Turkce mesajla reddedilir', () => {
    expect(parseLocalPromptSpec({})).toEqual({ ok: false, error: 'İl adı gerekli.' });
    expect(parseLocalPromptSpec({ il: 'Kadıköy', hizmetler: ['kuaför'] })).toMatchObject({ ok: false });
    expect(parseLocalPromptSpec({ il: 'Ankara', hizmetler: [] })).toMatchObject({ ok: false, error: expect.stringContaining('En az bir hizmet') });
    expect(parseLocalPromptSpec({ il: 'Ankara', ilceler: ['İzmir'], hizmetler: ['kuaför'] })).toMatchObject({ ok: false, error: expect.stringContaining('il adı') });
    expect(parseLocalPromptSpec({ il: 'Ankara', ilceler: ['<script>'], hizmetler: ['kuaför'] })).toMatchObject({ ok: false });
    expect(parseLocalPromptSpec({ il: 'Ankara', hizmetler: ['a', 'b', 'c', 'd', 'e', 'f'] })).toMatchObject({ ok: false });
    // 3 ilce x 4 hizmet x 3 kalip = 36 > 30
    const tooMany = parseLocalPromptSpec({ il: 'Ankara', ilceler: ['Çankaya', 'Keçiören', 'Mamak'], hizmetler: ['kuaför', 'berber', 'diş kliniği', 'veteriner'] });
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('en fazla 30') });
  });
});

describe('buildLocalPrompts', () => {
  it('her soruda konum acikca yazar; [hizmet] + [ilce/il] kaliplari', () => {
    const drafts = buildLocalPrompts({ il: 'Ankara', ilceler: ['Çankaya'], hizmetler: ['diş kliniği'] });
    expect(drafts.map((d) => d.text)).toEqual([
      'Çankaya diş kliniği',
      "Ankara Çankaya'da diş kliniği için nereyi önerirsin?",
      'Çankaya civarında en iyi diş kliniği önerileri',
    ]);
    expect(drafts.every((d) => d.text.includes('Çankaya'))).toBe(true);
    expect(drafts[0]).toMatchObject({ il: 'Ankara', ilce: 'Çankaya', hizmet: 'diş kliniği', template: 'arama' });
  });

  it('ilce yoksa il duzeyinde kurulur', () => {
    const drafts = buildLocalPrompts({ il: 'İzmir', ilceler: [], hizmetler: ['kahvaltı mekanı'] });
    expect(drafts.map((d) => d.text)).toEqual([
      'İzmir kahvaltı mekanı',
      "İzmir'de kahvaltı mekanı için nereyi önerirsin?",
      'İzmir genelinde en iyi kahvaltı mekanı önerileri',
    ]);
    expect(drafts.every((d) => d.ilce === null)).toBe(true);
  });

  it('hizmet x ilce x 3 kalip, ust sinir korunur', () => {
    const drafts = buildLocalPrompts({ il: 'İstanbul', ilceler: ['Kadıköy', 'Üsküdar'], hizmetler: ['kuaför', 'berber'] });
    expect(drafts).toHaveLength(12);
    expect(new Set(drafts.map((d) => d.text)).size).toBe(12);
    expect(drafts.length).toBeLessThanOrEqual(MAX_LOCAL_DRAFTS);
  });
});

describe('etiketler', () => {
  it('konum etiketleri gidip gelir; yerel isareti kaynak ya da etiketten', () => {
    const tags = localTags({ il: 'İstanbul', ilce: 'Kadıköy', hizmet: 'kuaför' });
    expect(tags).toEqual(['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför']);
    expect(readLocalTags(tags)).toEqual({ il: 'İstanbul', ilce: 'Kadıköy', hizmet: 'kuaför' });
    expect(readLocalTags(['pos', 'kredi'])).toBeNull();
    expect(readLocalTags(null)).toBeNull();
    expect(isLocalPrompt({ source: LOCAL_PROMPT_SOURCE, tags: null })).toBe(true);
    expect(isLocalPrompt({ source: 'manual', tags })).toBe(true);
    expect(isLocalPrompt({ source: 'brain', tags: ['pos'] })).toBe(false);
  });

  it('titleCaseTr: i → İ', () => {
    expect(titleCaseTr('istanbul')).toBe('İstanbul');
    expect(titleCaseTr('büyük  çekmece')).toBe('Büyük Çekmece');
  });
});
