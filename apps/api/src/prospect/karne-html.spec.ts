import { describe, it, expect } from 'vitest';
import { containsBrand } from '../audit/brand-in-query.js';
import { SEKTORLER } from './prospect-utils.js';
import { sorulariGetir, altsektorAnahtari, sektorAltAnahtarlari, tumSorular, ALT_SEKTOR_ANAHTARLARI } from './karne-sorular.js';
import { karneOzeti, karneHtml, karneBasligi, hataliProbe, type KarneSaglayiciSonucu } from './karne-html.js';

/**
 * Ornek marka listesi — soru bankasi bunlarin HICBIRINI icermemeli.
 * Gunluk kelimeyle cakisan markalar (Getir, Param, Garanti, Ziraat, Sok, Mavi,
 * Anadolu, Vatan, Divan) bilerek listede: soru yazarken en cok bunlar kacar.
 */
const ORNEK_MARKALAR = [
  'Papara', 'Param', 'iyzico', 'PayTR', 'Sipay', 'Paycell', 'Tosla', 'Enpara', 'Hayat Finans', 'Colendi', 'Midas',
  'Garanti', 'Garanti BBVA', 'Akbank', 'Ziraat', 'Ziraat Bankası', 'Halkbank', 'Yapı Kredi', 'İş Bankası', 'QNB', 'DenizBank', 'Kuveyt Türk',
  'Anadolu', 'Anadolu Sigorta', 'Allianz', 'Aksigorta', 'Türkiye Sigorta',
  'Getir', 'Trendyol', 'Hepsiburada', 'Yemeksepeti', 'Amazon', 'Çiçeksepeti', 'Teknosa', 'MediaMarkt', 'Vatan', 'Vatan Bilgisayar',
  'Migros', 'CarrefourSA', 'A101', 'Şok', 'Boyner', 'LC Waikiki', 'Koton', 'DeFacto', 'Mavi', 'Beymen', 'Arçelik', 'Beko', 'Vestel', 'Casper',
  'Pegasus', 'Türk Hava Yolları', 'SunExpress', 'AJet', 'Turkcell', 'Vodafone', 'Türk Telekom', 'Superonline', 'Togg', 'Tofaş', 'Ford Otosan',
  'Doğuş', 'Doğuş Otomotiv', 'Setur', 'Jolly', 'Tatilsepeti', 'Otelz', 'Dedeman', 'Rixos', 'Divan', 'Titanic', 'Cimri', 'Akakçe', 'Enuygun', 'Hangikredi',
  // leasing/faktoring/yatirim kuruluslari — yeni alt sektor sorulari bunlara da carpmamali
  'Garanti Leasing', 'Yapı Kredi Leasing', 'QNB Finans Leasing', 'Deniz Faktoring', 'Lider Faktoring', 'Koç Finansman', 'Oyak Yatırım', 'Gedik Yatırım', 'İş Yatırım',
];

describe('karne-sorular', () => {
  it('her sektor icin 10 tekil soru verir', () => {
    for (const s of SEKTORLER) {
      const q = sorulariGetir(s);
      expect(q).toHaveLength(10);
      expect(new Set(q).size).toBe(10);
    }
  });

  it('alt sektor eslesince ilk 7 sabit kalir, son 3 degisir', () => {
    const genel = sorulariGetir('finans');
    const banka = sorulariGetir('finans', 'dijital-banka');
    expect(banka).toHaveLength(10);
    expect(banka.slice(0, 7)).toEqual(genel.slice(0, 7));
    expect(banka.slice(7)).not.toEqual(genel.slice(7));
    expect(new Set(banka).size).toBe(10);
    expect(altsektorAnahtari('finans', 'odeme-epara')).toBe('odeme');
    expect(altsektorAnahtari('finans', 'Sigorta ve BES')).toBe('sigorta');
    expect(altsektorAnahtari('turizm-havayolu-telekom-otomotiv', 'Havayolu')).toBe('havayolu');
    expect(altsektorAnahtari('turizm-havayolu-telekom-otomotiv', '5 yıldızlı otel')).toBe('otel');
    // sektor disi alt sektor kabul edilmez
    expect(altsektorAnahtari('finans', 'otel')).toBeNull();
    expect(sorulariGetir('finans', 'otel')).toEqual(genel);
    // tamamen bilinmeyen metin → null (script sert uyari verir)
    expect(altsektorAnahtari('finans', 'gayrimenkul')).toBeNull();
  });

  it('finans: leasing/faktoring/finansman ve yatirim/araci kurum alt sektorleri (plan Faz 1, FKB + KAP)', () => {
    expect(altsektorAnahtari('finans', 'leasing')).toBe('leasing');
    expect(altsektorAnahtari('finans', 'Faktoring')).toBe('leasing');
    expect(altsektorAnahtari('finans', 'finansal kiralama')).toBe('leasing');
    expect(altsektorAnahtari('finans', 'tüketici finansmanı')).toBe('leasing');
    expect(altsektorAnahtari('finans', 'yatirim')).toBe('yatirim');
    expect(altsektorAnahtari('finans', 'Aracı Kurum')).toBe('yatirim');
    expect(altsektorAnahtari('finans', 'portföy yönetimi')).toBe('yatirim');
    expect(altsektorAnahtari('finans', 'menkul kıymetler')).toBe('yatirim');
    // "yatirim bankasi" → yatirim, "katilim bankasi" → banka (siralama)
    expect(altsektorAnahtari('finans', 'yatırım bankası')).toBe('yatirim');
    expect(altsektorAnahtari('finans', 'katılım bankası')).toBe('banka');
    // "finans" tek basina finansman/leasing DEGIL
    expect(altsektorAnahtari('finans', 'finans')).toBeNull();
    // leasing sirketine "dijital banka"/"ogrenci hesabi" sorulmaz: son 3 B2B sorudur
    const leasing = sorulariGetir('finans', 'leasing');
    expect(leasing).toHaveLength(10);
    expect(leasing.slice(7).join(' ')).toMatch(/leasing|faktoring|finansman/i);
    expect(leasing.slice(7).join(' ')).not.toMatch(/öğrenci|dijital banka/i);
    const yatirim = sorulariGetir('finans', 'yatirim');
    expect(yatirim.slice(7).join(' ')).toMatch(/aracı kurum/i);
    expect(new Set(yatirim).size).toBe(10);
    expect(sektorAltAnahtarlari('finans')).toEqual(['sigorta', 'odeme', 'leasing', 'yatirim', 'banka']);
    expect(ALT_SEKTOR_ANAHTARLARI).toContain('leasing');
    expect(ALT_SEKTOR_ANAHTARLARI).toContain('yatirim');
  });

  it('bilinmeyen sektorde hata verir', () => {
    expect(() => sorulariGetir('sanayi')).toThrow(/Bilinmeyen sektör/);
    expect(() => sektorAltAnahtarlari('sanayi')).toThrow(/Bilinmeyen sektör/);
  });

  it('hicbir soruda marka adi gecmez (containsBrand)', () => {
    const kombinasyonlar: string[] = [];
    for (const s of SEKTORLER) {
      kombinasyonlar.push(...sorulariGetir(s));
      for (const a of ALT_SEKTOR_ANAHTARLARI) kombinasyonlar.push(...sorulariGetir(s, a));
    }
    kombinasyonlar.push(...tumSorular());
    const ihlaller: string[] = [];
    for (const soru of new Set(kombinasyonlar)) {
      for (const marka of ORNEK_MARKALAR) {
        if (containsBrand(soru, marka)) ihlaller.push(`${marka} ← ${soru}`);
      }
    }
    expect(ihlaller).toEqual([]);
  });
});

// ─── Sahte runPublicProbes sonucu ───────────────────────────────────────────

const BRAND = 'Acme Bank';
const HOST = 'acmebank.com.tr';
const SORULAR = sorulariGetir('finans', 'banka');

function probe(query: string, o: Partial<KarneSaglayiciSonucu['probes'][number]> = {}) {
  return { query, cited: false, brandMentioned: false, brandInQuery: false, ...o };
}

/** Servisin urettigi hatali probe kalibi (ai-citation.service.ts: `excerpt: 'HATA: ...'`). */
function hataProbe(query: string, neden = 'saglayici reddi (refusal)') {
  return { query, cited: false, brandMentioned: false, excerpt: `HATA: ${neden}` };
}

function saglayici(
  provider: string, label: string, available: boolean,
  probes: KarneSaglayiciSonucu['probes'] = [], extra: Partial<KarneSaglayiciSonucu> = {},
): KarneSaglayiciSonucu {
  return { provider: provider as any, label, available, probes, cost: available ? 0.01 : 0, ...extra };
}

function sahteSonuc(): KarneSaglayiciSonucu[] {
  const hepsiYok = () => SORULAR.map((q) => probe(q, { mentionedDomains: ['rakip.com.tr'] }));
  return [
    // Claude: soru 1 anildi+atif (#1), soru 2 anildi (#3), rakip.com.tr her cevapta
    saglayici('anthropic', 'Anthropic Claude', true, SORULAR.map((q, i) => probe(q, {
      brandMentioned: i <= 1, cited: i === 0, position: i === 0 ? 1 : i === 1 ? 3 : null,
      mentionedDomains: ['rakip.com.tr', ...(i === 0 ? ['digerbanka.com'] : [])],
    }))),
    // Gemini: soru 1 anildi (#2), atif yok; competitors alaniyla rakip
    saglayici('gemini', 'Google Gemini', true, SORULAR.map((q, i) => probe(q, {
      brandMentioned: i === 0, position: i === 0 ? 2 : null,
      competitors: [{ name: 'rakip.com.tr', mentions: 4, positionFirst: 1 }, { name: 'sifir.com', mentions: 0, positionFirst: null }],
    }))),
    // ChatGPT: soru 3 atif (marka da anildi) — 2. atif saglayicisi
    saglayici('openai', 'OpenAI ChatGPT', true, SORULAR.map((q, i) => probe(q, {
      brandMentioned: i === 2, cited: i === 2, position: i === 2 ? 1 : null, mentionedDomains: ['rakip.com.tr'],
    }))),
    // Perplexity: hic anmadi
    saglayici('perplexity', 'Perplexity', true, hepsiYok()),
    // Grok: markali damgali probe — anildi ama skora girmemeli
    saglayici('xai', 'xAI Grok', true, SORULAR.map((q, i) => probe(q, {
      brandMentioned: i === 9, brandInQuery: i === 9, position: i === 9 ? 1 : null, mentionedDomains: ['rakip.com.tr'],
    }))),
    // Anahtari olmayan iki saglayici
    saglayici('deepseek', 'DeepSeek', false, [], { reason: 'NO_KEY' }),
    saglayici('meta', 'Meta AI (Llama)', false, [], { reason: 'NO_KEY' }),
  ];
}

describe('karneOzeti', () => {
  const ozet = karneOzeti({
    brand: BRAND, host: HOST, sektor: 'finans', altsektor: 'banka', sorular: SORULAR,
    saglayicilar: sahteSonuc(), rakipler: ['rakip.com.tr', 'gorunmeyen.com'], tarih: new Date('2026-08-29T10:00:00Z'),
  });

  it('asistan sayimlari: 3/7 anildi, 2/7 atif, 5 aktif', () => {
    expect(ozet.toplam).toEqual({
      saglayici: 7, aktifSaglayici: 5, anilanSaglayici: 3, atifSaglayici: 2,
      // 5 aktif x 10 soru = 50; Grok'un markali damgali 1 hucresi dusuldu
      olculenCevap: 49, anilanCevap: 4, atifCevap: 2, hataliCevap: 0,
    });
  });

  it('markali damgali probe skora girmez, markaliSorular listesine girer', () => {
    const grok = ozet.saglayicilar.find((s) => s.provider === 'xai')!;
    expect(grok.anilanSoru).toBe(0);
    expect(grok.hucreler[9]).toEqual({ olculdu: true, hata: false, markali: true, anildi: false, atif: false, sira: null });
    expect(ozet.markaliSorular).toEqual([SORULAR[9]]);
  });

  it('sira bilgisi anilan hucrede tasinir', () => {
    const claude = ozet.saglayicilar.find((s) => s.provider === 'anthropic')!;
    expect(claude.hucreler[0]).toEqual({ olculdu: true, hata: false, markali: false, anildi: true, atif: true, sira: 1 });
    expect(claude.hucreler[1].sira).toBe(3);
    expect(claude.hucreler[2].sira).toBeNull();
    const yok = ozet.saglayicilar.find((s) => s.provider === 'meta')!;
    expect(yok.hucreler.every((h) => !h.olculdu && !h.hata)).toBe(true);
  });

  it('bosluklar: olculen markasiz sorularda hic anilmayanlar', () => {
    // Anilan: soru 1 (Claude, Gemini), soru 2 (Claude), soru 3 (ChatGPT). Soru 10 markali → bosluk degil.
    expect(ozet.bosluklar).toEqual(SORULAR.slice(3, 9));
    expect(ozet.bosluklar).toHaveLength(6);
  });

  it('rakip payi: cevap basina en fazla 1, marka basta, gercek domain', () => {
    const marka = ozet.rakipPayi[0];
    expect(marka.isBrand).toBe(true);
    expect(marka.mentions).toBe(4); // markasiz cevaplarda: Claude 2 + Gemini 1 + ChatGPT 1
    const rakip = ozet.rakipPayi.find((r) => r.name === 'rakip.com.tr')!;
    expect(rakip.mentions).toBe(50); // 5 aktif saglayici x 10 cevap, her cevapta 1
    expect(ozet.rakipPayi.find((r) => r.name === 'digerbanka.com')!.mentions).toBe(1);
    expect(ozet.rakipPayi.find((r) => r.name === 'sifir.com')).toBeUndefined();
    expect(ozet.verilenRakipler).toEqual(['rakip.com.tr', 'gorunmeyen.com']);
  });

  it('cagri ve maliyet toplanir, tarih gg.aa.yyyy', () => {
    expect(ozet.cagriSayisi).toBe(50);
    expect(ozet.maliyetUsd).toBe(0.05);
    expect(ozet.tarihMetni).toBe('29.08.2026');
  });
});

// ─── HATA probe'lari (saglayici reddi / API hatasi) ─────────────────────────

describe('karneOzeti — HATA probe olcum sayilmaz', () => {
  it('hataliProbe: yalniz "HATA:" onekli excerpt', () => {
    expect(hataliProbe(hataProbe('q'))).toBe(true);
    expect(hataliProbe(probe('q', { excerpt: 'Hata yaptiniz derken...' }))).toBe(false);
    expect(hataliProbe(probe('q'))).toBe(false);
    expect(hataliProbe(undefined)).toBe(false);
  });

  it('tum probe lari HATA olan saglayici: 0 olculen, 0 bosluk, 10 hatali (sahte "bosluk" yok)', () => {
    const ozet = karneOzeti({
      brand: BRAND, host: HOST, sektor: 'finans', sorular: SORULAR,
      saglayicilar: [saglayici('anthropic', 'Anthropic Claude', true, SORULAR.map((q) => hataProbe(q)))],
    });
    expect(ozet.toplam).toEqual({
      saglayici: 1, aktifSaglayici: 1, anilanSaglayici: 0, atifSaglayici: 0,
      olculenCevap: 0, anilanCevap: 0, atifCevap: 0, hataliCevap: 10,
    });
    expect(ozet.bosluklar).toEqual([]);
    expect(ozet.saglayicilar[0].hataliSoru).toBe(10);
    expect(ozet.saglayicilar[0].hucreler[0]).toEqual({ olculdu: false, hata: true, markali: false, anildi: false, atif: false, sira: null });
    expect(ozet.rakipPayi).toEqual([]);
    // denenen cagri sayisi hatalilari da icerir (servis 10 istek atti)
    expect(ozet.cagriSayisi).toBe(10);
  });

  it('karisik: hatali hucre anilma oranini ve boslugu bozmaz', () => {
    // Claude: soru 1 anildi, soru 2-3 HATA, gerisi anilmadi. Gemini: soru 2 anildi, soru 3 HATA.
    const ozet = karneOzeti({
      brand: BRAND, host: HOST, sektor: 'finans', sorular: SORULAR,
      saglayicilar: [
        saglayici('anthropic', 'Anthropic Claude', true, SORULAR.map((q, i) =>
          i === 1 || i === 2 ? hataProbe(q, 'HTTP 529: overloaded') : probe(q, { brandMentioned: i === 0, position: i === 0 ? 1 : null, mentionedDomains: ['rakip.com.tr'] }))),
        saglayici('gemini', 'Google Gemini', true, SORULAR.map((q, i) =>
          i === 2 ? hataProbe(q) : probe(q, { brandMentioned: i === 1, position: i === 1 ? 2 : null, mentionedDomains: ['rakip.com.tr'] }))),
      ],
    });
    // 20 hucre - 3 hata = 17 olculen; anilan: Claude s1 + Gemini s2 = 2
    expect(ozet.toplam.olculenCevap).toBe(17);
    expect(ozet.toplam.hataliCevap).toBe(3);
    expect(ozet.toplam.anilanCevap).toBe(2);
    // Soru 3: her iki asistanda HATA → olculmedi → BOSLUK DEGIL. Soru 2: Gemini andi → bosluk degil.
    expect(ozet.bosluklar).toEqual(SORULAR.slice(3));
    expect(ozet.bosluklar).not.toContain(SORULAR[2]);
    // rakip gozlemi hatali probe'dan toplanmaz: 17 cevapta rakip.com.tr
    expect(ozet.rakipPayi.find((r) => r.name === 'rakip.com.tr')!.mentions).toBe(17);
  });

  it('HTML: "!" hucresi, lejant ve metodoloji cumlesi; ham hata govdesi HTML e girmez', () => {
    const ozet = karneOzeti({
      brand: BRAND, host: HOST, sektor: 'finans', sorular: SORULAR, tarih: new Date('2026-08-29T10:00:00Z'),
      saglayicilar: [
        saglayici('anthropic', 'Anthropic Claude', true, SORULAR.map((q, i) => (i === 0 ? hataProbe(q, 'HTTP 429: {"error":"rate_limit","key":"sk-ant-GIZLI"}') : probe(q)))),
        saglayici('openai', 'OpenAI ChatGPT', false, [], { reason: 'HTTP 401: {"error":{"message":"Incorrect API key sk-GIZLI"}}' }),
        saglayici('meta', 'Meta AI (Llama)', false, [], { reason: 'NO_KEY' }),
      ],
    });
    const html = karneHtml(ozet);
    expect(html).toContain('<td class="h hata" title="sağlayıcı hatası veya reddi — ölçülemedi, sayıma girmez">!</td>');
    expect(html).toContain('1 cevap sağlayıcı hatası veya reddi nedeniyle ölçülemedi (tabloda "!")');
    expect(html).toContain('! sağlayıcı hatası/reddi (sayıma girmez)');
    expect(html).toContain('<div class="sayi">0/9</div><div class="etiket">ölçülen cevapta anıldı (%0)</div>');
    // ham neden yalniz JSON'da: HTML'e ne anahtar durumu ne HTTP govdesi girer
    expect(html).not.toContain('NO_KEY');
    expect(html).not.toContain('GIZLI');
    expect(html).not.toContain('HTTP 4');
    expect(html).not.toContain('rate_limit');
    expect(html).toContain('Ölçülemeyen asistanlar: OpenAI ChatGPT, Meta AI (Llama) — bu koşumda ölçülemedi; sayımlara girmedi.');
    expect(ozet.saglayicilar[1].reason).toContain('HTTP 401'); // JSON tarafinda kalir
  });

  it('HTML: tum probe lari hatali asistan basligi "(ölçülemedi)" alir, bosluk listesi cikmaz', () => {
    const html = karneHtml(karneOzeti({
      brand: BRAND, host: HOST, sektor: 'finans', sorular: SORULAR,
      saglayicilar: [saglayici('anthropic', 'Anthropic Claude', true, SORULAR.map((q) => hataProbe(q)))],
    }));
    expect((html.match(/\(ölçülemedi\)/g) ?? []).length).toBe(1);
    expect(html).toContain('Ölçüm yapılamadı');
    expect(html).not.toContain('<ul class="bosluk">');
    expect(html).toContain('10 cevap sağlayıcı hatası veya reddi nedeniyle ölçülemedi');
  });
});

describe('karneHtml', () => {
  const ozet = karneOzeti({
    brand: BRAND, host: HOST, sektor: 'finans', altsektor: 'banka', sorular: SORULAR,
    saglayicilar: sahteSonuc(), rakipler: ['rakip.com.tr', 'gorunmeyen.com'], tarih: new Date('2026-08-29T10:00:00Z'),
  });
  const html = karneHtml(ozet);

  it('baslik ve gizlilik ibaresi', () => {
    expect(karneBasligi(BRAND)).toBe('Acme Bank — AI görünürlük karnesi (gizli, yalnız kurum için)');
    expect(html).toContain('<title>Acme Bank — AI görünürlük karnesi (gizli, yalnız kurum için)</title>');
    expect(html).toContain('<h1>Acme Bank — AI görünürlük karnesi (gizli, yalnız kurum için)</h1>');
    expect(html).toContain('GİZLİ — yalnız Acme Bank için hazırlandı');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it('ozet sayilari', () => {
    expect(html).toContain('<div class="sayi">3/7</div><div class="etiket">asistan en az bir soruda kurumu andı</div>');
    expect(html).toContain('<div class="sayi">2/7</div><div class="etiket">asistan atıf (kaynak/link) verdi</div>');
    expect(html).toContain('<div class="sayi">4/49</div><div class="etiket">ölçülen cevapta anıldı (%8)</div>');
    expect(html).toContain('<div class="sayi">2/49</div><div class="etiket">ölçülen cevapta atıf (%4)</div>');
    // Payda: en az bir asistanin gercekten olctugu markasiz soru sayisi (hata/markali haric)
    expect(ozet.olculenSoruSayisi).toBeGreaterThanOrEqual(ozet.bosluklar.length);
    expect(ozet.olculenSoruSayisi).toBeLessThanOrEqual(9);
    expect(html).toContain(`<div class="sayi">6/${ozet.olculenSoruSayisi}</div><div class="etiket">ölçülen soruda hiçbir asistan anmadı (boşluk)</div>`);
  });

  it('asistan x soru tablosu: basliklar, hucreler, olculemeyenler (ham neden yok)', () => {
    for (const b of ['Claude', 'Gemini', 'ChatGPT', 'Perplexity', 'Grok', 'DeepSeek', 'Meta AI']) expect(html).toContain(`>${b}`);
    expect(html).toContain('◎ #1');
    expect(html).toContain('● #3');
    expect(html).toContain('title="markalı soru — skora girmez">m</td>');
    expect((html.match(/\(ölçülemedi\)/g) ?? []).length).toBe(2);
    expect(html).toContain('Ölçülemeyen asistanlar: DeepSeek, Meta AI (Llama) — bu koşumda ölçülemedi; sayımlara girmedi.');
    expect(html).not.toContain('NO_KEY');
    expect(html).toContain('<th class="asistan" title="DeepSeek">DeepSeek');
    for (const q of SORULAR) expect(html).toContain(q.replace(/'/g, '&#39;'));
  });

  it('rakip payi gercek domainlerle, verilen rakip ★', () => {
    expect(html).toContain('rakip.com.tr');
    expect(html).toContain('digerbanka.com');
    expect(html).toContain('<tr class="marka-satir"><td>Acme Bank <span style="font-weight:400;color:var(--soluk)">(acmebank.com.tr)</span></td><td class="h">4</td>');
    expect(html).toContain('rakip.com.tr <span title="karneyi isteyen kurumun verdiği rakip">★</span>');
    expect(html).toContain('★ = kurumun bildirdiği rakip; cevaplarda ayrıca arandı.');
    expect(html).toContain('Verilen ama hiç görünmeyen rakipler: gorunmeyen.com.');
  });

  it('bosluk listesi ve metodoloji', () => {
    expect(html).toContain('<h2>Boşluklar — kurumun hiç görünmediği sorular</h2>');
    expect((html.match(/<ul class="bosluk">/g) ?? []).length).toBe(1);
    expect(html).toContain('en az 2 farklı günde');
    expect(html).toContain('tek koşumdur = anlık görüntü');
    expect(html).toContain('1 soruda kurum adı geçtiği için o satırlar skora girmedi');
    expect(html).toContain('Toplam 50 asistan çağrısı. Ölçüm tarihi: 29.08.2026.');
    expect(html).toContain('#f97316');
    // hata yoksa hata cumlesi yazilmaz
    expect(html).not.toContain('sağlayıcı hatası veya reddi nedeniyle ölçülemedi');
  });

  it('sira tanimi: satir/madde (servis \\n ile boler), paragraf degil', () => {
    expect(html).toContain('#n = cevapta ilk geçtiği satır/madde sırası');
    expect(html).toContain('Sıra = kurumun cevapta ilk geçtiği satır/madde (1 = en üstte; liste maddeleri ayrı satır sayılır)');
    expect(html).not.toContain('paragraf');
  });

  it('HTML kacisi: marka ve rakip adi script enjekte edemez', () => {
    const kotu = karneHtml(karneOzeti({
      brand: '<script>alert(1)</script>', host: 'x.com', sektor: 'finans', sorular: ['soru?'],
      saglayicilar: [saglayici('openai', 'OpenAI ChatGPT', true, [probe('soru?', { mentionedDomains: ['<b>r</b>.com'] })])],
    }));
    expect(kotu).not.toContain('<script>alert');
    expect(kotu).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(kotu).not.toContain('<b>r</b>');
  });

  it('hic asistan yoksa olcum yok mesaji', () => {
    const bos = karneHtml(karneOzeti({
      brand: BRAND, host: HOST, sektor: 'finans', sorular: SORULAR,
      saglayicilar: [saglayici('openai', 'OpenAI ChatGPT', false, [], { reason: 'NO_KEY' })],
    }));
    expect(bos).toContain('Ölçüm yapılamadı');
    expect(bos).toContain('pay hesaplanamadı');
  });
});
