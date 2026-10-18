import { describe, it, expect } from 'vitest';
import { guardText, competitorBrandIn } from './metadata-guard.js';

const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);

describe('guardText — Google Play adi (politika 9898842)', () => {
  it('ücretsiz, #1, en iyi ve emoji kaldırılır; ayraçlar toparlanır', () => {
    const r = guardText('🔥 Bütçem: #1 Ücretsiz Bütçe Takibi', { field: 'title', store: 'ANDROID', limit: 30 });
    expect(r.text).toBe('Bütçem: Bütçe Takibi');
    expect(codes(r)).toEqual(expect.arrayContaining(['EMOJI', 'RANKING', 'FREE']));
    expect(r.issues.every((i) => i.action === 'removed')).toBe(true);
  });

  it('"ÜCRETSİZ" (Türkçe büyük İ) de yakalanır', () => {
    const r = guardText('Bütçem - ÜCRETSİZ', { field: 'title', store: 'ANDROID' });
    expect(r.text).toBe('Bütçem');
    expect(codes(r)).toContain('FREE');
  });

  it('tamamı büyük harf kelime işaretlenir, marka adıysa işaretlenmez; metin değişmez', () => {
    const a = guardText('Bütçem HARİKA Takip', { field: 'title', store: 'ANDROID', facts: { brand: 'Bütçem' } });
    expect(a.text).toBe('Bütçem HARİKA Takip');
    expect(a.issues).toEqual([expect.objectContaining({ code: 'ALL_CAPS', action: 'flagged', excerpt: 'HARİKA' })]);
    const b = guardText('KOBIPRATIK: Ön Muhasebe', { field: 'title', store: 'ANDROID', facts: { brand: 'KobiPratik' } });
    expect(codes(b)).not.toContain('ALL_CAPS');
  });

  it('30 karakteri aşan ad işaretlenir ama kesilmez', () => {
    const t = 'Bütçem: Harcama ve Gelir Takip Uygulaması';
    const r = guardText(t, { field: 'title', store: 'ANDROID', limit: 30 });
    expect(r.text).toBe(t);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'OVER_LIMIT', action: 'flagged' })]);
  });

  it('iOS adında emoji ve büyük harf kuralı uygulanmaz (Apple kuralı yok), fiyat yine çıkar', () => {
    const r = guardText('Bütçem 🙂 PLUS 9,99 TL', { field: 'title', store: 'IOS' });
    expect(r.text).toBe('Bütçem 🙂 PLUS');
    expect(codes(r)).toEqual(['PRICE']);
  });

  it('temiz başlığa dokunulmaz', () => {
    const r = guardText('Bütçem: Harcama Takibi', { field: 'title', store: 'BOTH', limit: 30 });
    expect(r).toEqual({ text: 'Bütçem: Harcama Takibi', issues: [] });
  });
});

describe('guardText — kısa açıklama ve görsel metni (clause)', () => {
  it('eylem çağrısı ve indirim içeren cümlecik atılır', () => {
    const r = guardText('Harcamalarını kolayca takip et, hemen indir!', { field: 'shortDescription', store: 'ANDROID', limit: 80 });
    expect(r.text).toBe('Harcamalarını kolayca takip et');
    expect(codes(r)).toContain('CALL_TO_ACTION');
  });

  it('görsel metninde puan, kullanıcı sayısı ve ödül sağlanan veride olsa bile kaldırılır', () => {
    const facts = { sourceText: '1 milyondan fazla kullanıcı, Editörün Seçimi', rating: 4.8 };
    const a = guardText('4,8 yıldızlı deneyim', { field: 'caption', store: 'BOTH', facts });
    expect(a.text).toBe('');
    expect(codes(a)).toEqual(['RATING_CLAIM']);
    const b = guardText('1M+ kullanıcının tercihi', { field: 'caption', store: 'BOTH', facts });
    expect(b.text).toBe('');
    expect(codes(b)).toEqual(['USER_COUNT']);
    const c = guardText('Editörün Seçimi uygulama', { field: 'caption', store: 'BOTH', facts });
    expect(codes(c)).toEqual(['AWARD_PRESS']);
  });

  it('kaynaksız övgü alıntısı görsel metninden çıkar', () => {
    const r = guardText('Planlama kolaylaştı. “Bu uygulamaya bayıldım, herkese tavsiye ederim”', { field: 'caption', store: 'BOTH' });
    expect(r.text).toBe('Planlama kolaylaştı.');
    expect(codes(r)).toContain('TESTIMONIAL');
  });

  it('indirim / deneme teklifleri yakalanır', () => {
    expect(codes(guardText('%50 indirim fırsatı', { field: 'caption', store: 'BOTH' }))).toContain('DISCOUNT');
    expect(codes(guardText('7 gün ücretsiz dene', { field: 'caption', store: 'BOTH' }))).toContain('DISCOUNT');
    expect(codes(guardText('Premium indirimli', { field: 'caption', store: 'BOTH' }))).toContain('DISCOUNT');
  });
});

describe('guardText — açıklama (sentence): sağlanan veriyle doğrulama', () => {
  const desc = [
    'Bütçem ile harcamalarını kategorilere ayır.',
    '1 milyondan fazla kullanıcı Bütçem kullanıyor.',
    '4.9 yıldızlı uygulamayı keşfet.',
    'Premium aylık 49,99 TL.',
    'Tamamen ücretsiz başla.',
    '• Aylık rapor',
  ].join('\n');

  it('kaynakta olmayan kullanıcı sayısı ve gerçek puanla çelişen puan çıkar; fiyat çıkar; "ücretsiz" yalnız işaretlenir', () => {
    const r = guardText(desc, { field: 'description', store: 'IOS', facts: { sourceText: 'Harcama takibi', rating: 4.6 } });
    expect(r.text).toBe(['Bütçem ile harcamalarını kategorilere ayır.', 'Tamamen ücretsiz başla.', '• Aylık rapor'].join('\n'));
    expect(r.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'USER_COUNT', action: 'removed' }),
      expect.objectContaining({ code: 'RATING_CLAIM', action: 'removed' }),
      expect.objectContaining({ code: 'PRICE', action: 'removed' }),
      expect.objectContaining({ code: 'FREE', action: 'flagged' }),
    ]));
  });

  it('mevcut mağaza metninde geçen sayı ve gerçek puanla eşleşen puan kalır ("1.000.000+" = "1 milyondan fazla")', () => {
    const r = guardText('1 milyondan fazla kullanıcı Bütçem kullanıyor. 4,6 puanlı uygulama.', {
      field: 'description',
      store: 'ANDROID',
      facts: { sourceText: '1.000.000+ indirme ve kullanıcı', rating: 4.62 },
    });
    expect(r.text).toBe('1 milyondan fazla kullanıcı Bütçem kullanıyor. 4,6 puanlı uygulama.');
    expect(r.issues).toEqual([]);
  });

  it('özellik ifadeleri iddia sayılmaz: "5 kullanıcıya kadar", "2 kişilik", "5 yıldızlı oteller", "ad-free", "en iyi şekilde"', () => {
    const text = 'Aile planı 5 kullanıcıya kadar. 2 kişilik oyun modu. 5 yıldızlı otelleri listeler. Ad-free deneyim. Paranı en iyi şekilde yönet.';
    const r = guardText(text, { field: 'description', store: 'BOTH' });
    expect(r).toEqual({ text, issues: [] });
  });

  it('"en iyi" açıklamada yalnız işaretlenir', () => {
    const r = guardText('Türkiye’nin en iyi bütçe uygulaması.', { field: 'description', store: 'IOS' });
    expect(r.text).toBe('Türkiye’nin en iyi bütçe uygulaması.');
    expect(r.issues[0]).toMatchObject({ code: 'SUPERLATIVE', action: 'flagged' });
  });

  it('mode=flag kullanıcı girdisine dokunmaz, yalnız raporlar', () => {
    const r = guardText('Hemen indir, ücretsiz! 4.9 yıldız', { field: 'shortDescription', store: 'ANDROID', mode: 'flag' });
    expect(r.text).toBe('Hemen indir, ücretsiz! 4.9 yıldız');
    expect(r.issues.every((i) => i.action === 'flagged')).toBe(true);
    expect(codes(r)).toEqual(expect.arrayContaining(['CALL_TO_ACTION', 'FREE', 'RATING_CLAIM']));
  });
});

describe('guardText — anahtar kelime', () => {
  it('iOS anahtar kelime alanında ihlal içeren terim atılır, kalanlar virgülle birleşir', () => {
    const r = guardText('bütçe, ücretsiz,en iyi bütçe,harcama takibi', { field: 'keywords', store: 'IOS', limit: 100 });
    expect(r.text).toBe('bütçe,harcama takibi');
    expect(codes(r)).toEqual(expect.arrayContaining(['FREE', 'SUPERLATIVE']));
  });

  it('tek öneri ihlalliyse boş döner', () => {
    expect(guardText('bedava bütçe', { field: 'keyword', store: 'IOS' }).text).toBe('');
    expect(guardText('#1 finans', { field: 'keyword', store: 'IOS' }).text).toBe('');
    expect(guardText('bütçe planlama', { field: 'keyword', store: 'IOS' }).text).toBe('bütçe planlama');
  });
});

describe('guardText — İngilizce ve yanlış pozitif koruması', () => {
  it('İngilizce iddialar: free trial, download now, top rated, award-winning, #1', () => {
    const r = guardText('Award-winning budget app. Start your free trial. Download now!', { field: 'description', store: 'ANDROID' });
    // Tam açıklamada eylem çağrısı yasak değil (yalnız ad, kısa açıklama, görsel) → kalır
    expect(r.text).toBe('Download now!');
    expect(codes(r)).toEqual(expect.arrayContaining(['AWARD_PRESS', 'DISCOUNT']));
    expect(guardText('Top rated planner', { field: 'shortDescription', store: 'ANDROID' }).text).toBe('');
  });

  it('"free up space", "hands-free" ve özellik olarak "puan kazan" iddia sayılmaz', () => {
    const text = 'Free up space in seconds. Hands-free mode. Her alışverişte 5 puan kazan.';
    expect(guardText(text, { field: 'description', store: 'BOTH' })).toEqual({ text, issues: [] });
  });

  it('kaynakta geçen ödül açıklamada kalır, kaynakta yoksa cümle çıkar', () => {
    const src = { sourceText: 'Bütçem, Editörün Seçimi rozeti aldı.' };
    const kept = guardText('Editörün Seçimi uygulaması Bütçem.', { field: 'description', store: 'IOS', facts: src });
    expect(kept.issues).toEqual([]);
    const dropped = guardText('Bütçem harcama takibi yapar. Editörün Seçimi uygulaması.', { field: 'description', store: 'IOS' });
    expect(dropped.text).toBe('Bütçem harcama takibi yapar.');
  });

  it('marka adının içindeki kelime ihlal sayılmaz ("Best Secret", "FREE NOW"); markadan sonraki iddia yine çıkar', () => {
    expect(guardText('Best Secret: Moda Alışveriş', { field: 'title', store: 'ANDROID', facts: { brand: 'Best Secret: Moda' } }))
      .toEqual({ text: 'Best Secret: Moda Alışveriş', issues: [] });
    const r = guardText('FREE NOW - Taksi, ücretsiz ilk yolculuk', { field: 'title', store: 'ANDROID', facts: { brand: 'FREE NOW' } });
    expect(r.text).toBe('FREE NOW - Taksi, ilk yolculuk');
    expect(r.issues).toEqual([expect.objectContaining({ code: 'FREE', excerpt: 'ücretsiz' })]);
  });

  it('© ® ™ emoji sayılmaz', () => {
    expect(guardText('Bütçem™ Gider', { field: 'title', store: 'ANDROID' })).toEqual({ text: 'Bütçem™ Gider', issues: [] });
  });
});

describe('guardText — yanlış pozitif anlamı bozmamalı', () => {
  const unchanged = (text: string, opts: Parameters<typeof guardText>[1]) => expect(guardText(text, opts)).toEqual({ text, issues: [] });

  it('"X free" (X\'siz) fiyat iddiası değil: başlık, alt başlık ve anahtar kelimede kalır', () => {
    // Eskiden "Gluten Recipes" / "Ad Music Player" — ilan tersini söylüyordu
    unchanged('Gluten Free Recipes', { field: 'title', store: 'IOS', limit: 30 });
    unchanged('Ad Free Music Player', { field: 'title', store: 'ANDROID', limit: 30 });
    unchanged('Offline, ad free and private', { field: 'subtitle', store: 'IOS' });
    unchanged('ad free,offline,mp3', { field: 'keywords', store: 'IOS' });
    unchanged('Hands Free Driving Mode', { field: 'shortDescription', store: 'ANDROID' });
    unchanged('Sugar-free recipes', { field: 'title', store: 'IOS' });
    // Kaynakta geçen "gluten free" açıklamada işaret bile üretmez
    unchanged('Gluten free cooking made simple.', { field: 'description', store: 'IOS', facts: { sourceText: 'Gluten free cooking' } });
  });

  it('fiyat dışı kalıplar: feel free, free up, free time, free of ads', () => {
    unchanged('Feel free to explore', { field: 'caption', store: 'BOTH' });
    unchanged('Free up space and free time', { field: 'subtitle', store: 'IOS' });
    unchanged('Distraction free of ads writing', { field: 'subtitle', store: 'IOS' });
  });

  it('fiyat bağlamındaki "free" kalıbıyla birlikte çıkar; hiçbir kelime sarkmaz', () => {
    const cut = (text: string, field: 'title' | 'subtitle' = 'title') => guardText(text, { field, store: 'IOS' });
    expect(cut('Music Player for Free')).toMatchObject({ text: 'Music Player', issues: [expect.objectContaining({ code: 'FREE', action: 'removed', excerpt: 'for Free' })] });
    expect(cut('100% Free VPN').text).toBe('VPN');
    expect(cut('Free-to-Play Fantasy RPG').text).toBe('Fantasy RPG');
    expect(cut('Free of charge budget planner', 'subtitle').text).toBe('budget planner');
    // Ürün adı ("Download Manager") kalır, yalnız fiyat kelimesi gider
    expect(cut('Free Download Manager').text).toBe('Download Manager');
  });

  it('belirsiz "free" hiçbir alanda kesilmez, yalnız işaretlenir', () => {
    for (const [text, field] of [['Free Music Player', 'title'], ['Sudoku Free', 'title'], ['Fast, free and secure VPN', 'subtitle']] as const) {
      const r = guardText(text, { field, store: 'IOS' });
      expect(r.text, text).toBe(text);
      expect(r.issues, text).toEqual([expect.objectContaining({ code: 'FREE', action: 'flagged' })]);
    }
  });

  it('Türkçe "ücretsiz" her zaman fiyattır', () => {
    expect(guardText('Bütçem: Ücretsiz Harcama Takibi', { field: 'title', store: 'IOS' }).text).toBe('Bütçem: Harcama Takibi');
  });

  it('eylem çağrısı: "today\'s" iyelik eki CTA değil; "indir ve" yalnız uygulama indirme çağrısında', () => {
    // Eskiden kısa açıklama tamamen boşalıyordu
    unchanged("Get today's horoscope and daily tips", { field: 'shortDescription', store: 'ANDROID' });
    unchanged("Play today's puzzle", { field: 'caption', store: 'BOTH' });
    unchanged('PDF İndir ve Paylaş', { field: 'title', store: 'ANDROID' });
    expect(codes(guardText('Download now and track spending', { field: 'shortDescription', store: 'ANDROID' }))).toEqual(['CALL_TO_ACTION']);
    expect(codes(guardText('Oyunu indir ve kazan', { field: 'shortDescription', store: 'ANDROID' }))).toEqual(['CALL_TO_ACTION']);
  });

  it('"bir numara" sıralama iddiası değil; "bir numaralı uygulama" iddia', () => {
    unchanged('Bir numara seç ve hemen ara', { field: 'shortDescription', store: 'ANDROID' });
    unchanged('İkinci bir numara edin', { field: 'subtitle', store: 'IOS' });
    const r = guardText("Türkiye'nin bir numaralı bütçe uygulaması", { field: 'subtitle', store: 'IOS' });
    expect(r.text).toBe("Türkiye'nin bütçe uygulaması");
    expect(codes(r)).toEqual(['RANKING']);
  });

  it('sıralama ifadesinden yalnız iddia kelimeleri çıkar, uygulama adı kalır', () => {
    expect(guardText('Ailelerin en sevilen bütçe uygulaması', { field: 'subtitle', store: 'IOS' }).text).toBe('Ailelerin bütçe uygulaması');
    // "Türkiye'nin en ..." kendisi üstünlük iddiası: o da çıkar
    expect(guardText('Türkiye’nin en popüler bütçe uygulaması', { field: 'subtitle', store: 'IOS' }).text).toBe('bütçe uygulaması');
    expect(guardText('Best-selling budget app', { field: 'subtitle', store: 'IOS' }).text).toBe('budget app');
    // "approach" bir uygulama adı değil
    unchanged('The most popular approach to journaling', { field: 'description', store: 'IOS' });
  });

  it('tasarruf yalnız fiyat/abonelik bağlamında indirimdir', () => {
    unchanged('Faturada %20 tasarruf için enerji takibi', { field: 'shortDescription', store: 'ANDROID' });
    unchanged('Save 30% battery every day', { field: 'caption', store: 'BOTH' });
    expect(codes(guardText('Yıllık Premium planda %40 tasarruf', { field: 'caption', store: 'BOTH' }))).toEqual(['DISCOUNT']);
    expect(codes(guardText('Save 50% on Premium', { field: 'caption', store: 'BOTH' }))).toEqual(['DISCOUNT']);
  });

  it('kur/döviz metnindeki tutar uygulamanın fiyatı değil: işaretlenir, çıkarılmaz', () => {
    const r = guardText('Döviz: 1 USD kaç TL', { field: 'title', store: 'IOS' });
    expect(r.text).toBe('Döviz: 1 USD kaç TL');
    expect(r.issues).toEqual([expect.objectContaining({ code: 'PRICE', action: 'flagged' })]);
    // Uygulama fiyatı başlıktan yine çıkar
    expect(guardText('Bütçem Premium 49 TL', { field: 'title', store: 'IOS' }).text).toBe('Bütçem Premium');
  });

  it('açıklamada tutar: mevcut mağaza metninde geçiyorsa işaretlenir, AI uydurduysa cümle çıkar', () => {
    const text = 'Aylık 500 TL limit belirle.';
    const kept = guardText(text, { field: 'description', store: 'IOS', facts: { sourceText: 'Harcama takibi. Aylık 500 TL limit belirle.' } });
    expect(kept.text).toBe(text);
    expect(kept.issues).toEqual([expect.objectContaining({ code: 'PRICE', action: 'flagged' })]);
    expect(guardText(text, { field: 'description', store: 'IOS' })).toMatchObject({ text: '', issues: [expect.objectContaining({ code: 'PRICE', action: 'removed' })] });
  });

  it('üstünlük: "best friend", "en iyi arkadaş", "personal best", "best-seller" iddia değil', () => {
    unchanged('Best Friend Quiz', { field: 'title', store: 'IOS' });
    unchanged('En İyi Arkadaş Testi', { field: 'title', store: 'IOS' });
    unchanged('Personal best tracker', { field: 'title', store: 'IOS' });
    // Eskiden "best" kesilip "seller Books" kalıyordu
    unchanged('Best-seller Books', { field: 'title', store: 'IOS' });
  });

  it('tireli bileşiğin parçası kesilmez, bileşiğin tamamı çıkar', () => {
    expect(guardText('#1-ranked planner', { field: 'title', store: 'IOS' })).toMatchObject({
      text: 'planner', issues: [expect.objectContaining({ code: 'RANKING', excerpt: '#1-ranked' })],
    });
    expect(guardText('Best-in-class Planner', { field: 'title', store: 'IOS' })).toMatchObject({
      text: 'Planner', issues: [expect.objectContaining({ code: 'SUPERLATIVE', excerpt: 'Best-in-class' })],
    });
  });

  it('marka adı verilirse markanın kelimeleri anahtar kelimede kalır', () => {
    unchanged('free fire max', { field: 'keyword', store: 'BOTH', facts: { brand: 'Free Fire: Battlegrounds' } });
  });
});

describe('competitorBrandIn', () => {
  const names = ['Spotify: Müzik ve Podcast', 'Getir', 'Yemeksepeti Yemek Sipariş'];
  it('marka kısmı eşleşir, açıklama kelimeleri eşleşmez', () => {
    expect(competitorBrandIn('spotify alternatifi', names)).toBe('Spotify: Müzik ve Podcast');
    expect(competitorBrandIn('müzik', names)).toBeNull();
    expect(competitorBrandIn('getir', names)).toBe('Getir');
    // Ayraçsız çok kelimeli başlıkta marka sınırı bilinmez → genel kelime atılmaz
    expect(competitorBrandIn('yemek sipariş', names)).toBeNull();
  });
  it('kendi markamız rakip sayılmaz', () => {
    expect(competitorBrandIn('getir', names, 'Getir: Market')).toBeNull();
  });
});
