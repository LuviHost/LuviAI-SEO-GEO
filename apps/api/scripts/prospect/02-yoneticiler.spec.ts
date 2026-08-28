/**
 * 02-yoneticiler saf fonksiyon testleri. NEDEN: ag yok; unvan filtresi, baslik
 * ayristirma, firma eslestirme ve KAP RSC ayristirma sozlesmesi burada kilitlenir.
 * Isimler kurgusaldir.
 */
import { describe, expect, it } from 'vitest';
import {
  adCikar,
  atamaFiiliVarMi,
  firmaAnahtarlari,
  firmaCekirdek,
  firmaEslestir,
  firmaYap,
  firmayiKirp,
  hataKodu,
  hedefFirmaEslestir,
  kademe,
  kapIndeksOlustur,
  kapKimlik,
  kapKimlikBul,
  kapPersonelParcala,
  kapWebParcala,
  kisileriBirlestir,
  mtYazi,
  negatifFiilVarMi,
  tarihGuven,
  unvanCikar,
  unvanCikarDetay,
  unvanEkiAt,
  unvanUygunMu,
  type Kisi,
} from './02-yoneticiler.js';

const AYRILIS_1 = 'Ali Veli, Turkcell Pazarlama Direktörü görevinden ayrıldı';
const AYRILIS_2 = "Turkcell CMO'su Ali Veli istifa etti";
const GETIR = "Getir'in CMO'su Ali Veli oldu";
const IZOCAM = "İzocam'da Satış ve Pazarlama Direktörlüğü Görevine Barış Orbay atandı";

describe('unvanUygunMu', () => {
  it('pazarlama tarafindaki unvanlari kabul eder', () => {
    expect(unvanUygunMu('Pazarlama Direktörü')).toBe(true);
    expect(unvanUygunMu('Pazarlamadan Sorumlu Genel Müdür Yardımcısı')).toBe(true);
    expect(unvanUygunMu("CMO'su")).toBe(true);
  });
  it('finans kelimesi pazarlama rolunu oldurmez, finans rolleri elenir (madde 20)', () => {
    expect(unvanUygunMu('Finansal Ürünler Pazarlama Müdürü')).toBe(true);
    expect(unvanUygunMu('Finans Genel Müdür Yardımcısı')).toBe(false);
    expect(unvanUygunMu('CFO')).toBe(false);
    expect(unvanUygunMu('Mali İşler Direktörü')).toBe(false);
  });
  it('BT/hukuk/IK ve pazarlama disi unvanlari eler', () => {
    expect(unvanUygunMu('Bilgi ve İletişim Teknolojileri Genel Müdür Yardımcısı')).toBe(false);
    expect(unvanUygunMu('Hukuk Müşaviri')).toBe(false);
    expect(unvanUygunMu('Satış Direktörü')).toBe(false);
    expect(unvanUygunMu('')).toBe(false);
  });
});

describe('kademe (madde 19)', () => {
  it('Mudur / Manager / Yonetici / Head of / Lead → 1', () => {
    for (const u of ['Pazarlama Müdürü', 'Marketing Manager', 'Dijital Pazarlama Yöneticisi', 'Head of Growth', 'Growth Lead', 'Pazarlamadan Sorumlu GMY']) {
      expect(kademe(u), u).toBe(1);
    }
  });
  it('Uzman / Sorumlu / Koordinator / Specialist → 2', () => {
    for (const u of ['Pazarlama Uzmanı', 'Dijital Pazarlama Sorumlusu', 'Pazarlama Koordinatörü', 'Marketing Specialist']) {
      expect(kademe(u), u).toBe(2);
    }
  });
});

describe('unvanEkiAt (madde 17)', () => {
  it('iyelik/hal ekini atar', () => {
    expect(unvanEkiAt("CMO'su")).toBe('CMO');
    expect(unvanEkiAt('Trendyol Group CMO’su')).toBe('Trendyol Group CMO');
    expect(unvanEkiAt("Direktörlüğü'ne")).toBe('Direktörlüğü');
  });
});

describe('unvanCikar', () => {
  it('apostroflu kurum baglamini atip unvani doner', () => {
    expect(unvanCikar(IZOCAM)).toBe('Satış ve Pazarlama Direktörlüğü');
    expect(unvanCikar(GETIR)).toBe('CMO');
  });
  it('pazarlama disi unvanda null', () => {
    expect(unvanCikar('Sanofi Avrasya Finans Direktörü pozisyonuna Ali Veli atandı')).toBeNull();
  });
  it('konum unvanin basligin icindeki yerini gosterir', () => {
    const d = unvanCikarDetay(GETIR);
    expect(d?.konum).toBe(GETIR.indexOf('CMO'));
  });
});

describe('adCikar', () => {
  it('atama fiilinden onceki adi alir', () => {
    expect(adCikar(GETIR)).toEqual({ ad: 'Ali', soyad: 'Veli' });
    expect(adCikar(IZOCAM)).toEqual({ ad: 'Barış', soyad: 'Orbay' });
  });
  it('bastaki virgullu adi alir (X, Y ... olarak atandi)', () => {
    expect(adCikar('Selda Sakaroğlu Solak, SWOT Hospitality Ticari Strateji ve Marka Başkanı olarak Atandı'))
      .toEqual({ ad: 'Selda Sakaroğlu', soyad: 'Solak' });
  });
  it('ayrilis basliklarindan atama uretmez (madde 2)', () => {
    expect(adCikar(AYRILIS_1)).toBeNull();
    expect(adCikar(AYRILIS_2)).toBeNull();
    expect(adCikar("Deneyimli pazarlamacı Zeynep Ege Dura Edenred'e veda etti")).toBeNull();
  });
  it('olumlu fiil yoksa ilk buyuk harfli diziye dusmez', () => {
    expect(adCikar('Turkcell Pazarlama Direktörü Ali Veli')).toBeNull();
    expect(adCikar('Novartis Türkiye liderlik ekibinde üç üst düzey atama')).toBeNull();
  });
});

describe('negatif / olumlu fiil', () => {
  it('ayrilis fiilleri', () => {
    expect(negatifFiilVarMi(AYRILIS_1)).toBe(true);
    expect(negatifFiilVarMi(AYRILIS_2)).toBe(true);
    expect(negatifFiilVarMi('Ali Veli emekli oldu')).toBe(true);
    expect(negatifFiilVarMi(GETIR)).toBe(false);
  });
  it('atama fiilleri', () => {
    expect(atamaFiiliVarMi(GETIR)).toBe(true);
    expect(atamaFiiliVarMi('Ali Veli Pazarlama Direktörlüğü görevini üstlendi')).toBe(true);
    expect(atamaFiiliVarMi('Turkcell Pazarlama Direktörü Ali Veli')).toBe(false);
  });
});

describe('firmaAnahtarlari (madde 13)', () => {
  it('takma ad ve cekirdek ad uretir, jenerik tek kelimeyi uretmez', () => {
    const tt = firmaAnahtarlari('TÜRK TELEKOMÜNİKASYON A.Ş.');
    expect(tt).toContain('turk telekom');
    expect(tt).toContain('turk telekomunikasyon');
    expect(tt).not.toContain('turk');
    expect(firmaAnahtarlari('YAPI VE KREDİ BANKASI A.Ş.')).toContain('yapi kredi');
    expect(firmaAnahtarlari('TURKCELL İLETİŞİM HİZMETLERİ A.Ş.')).toContain('turkcell');
    expect(firmaAnahtarlari('TÜRKİYE SİGORTA A.Ş.')).not.toContain('sigorta');
  });
  it('soyadi olabilecek marka tek basina anahtar olmaz, 3 harfli markalar olur', () => {
    const koc = firmaAnahtarlari('KOÇ HOLDİNG A.Ş.');
    expect(koc).toContain('koc holding');
    expect(koc).not.toContain('koc');
    expect(firmaAnahtarlari('BİM BİRLEŞİK MAĞAZALAR A.Ş.')).toContain('bim');
    expect(firmaAnahtarlari('n11')).toContain('n11');
  });
  it('firmaCekirdek tuzel ad ile markayi ayni anahtara indirir', () => {
    expect(firmaCekirdek('TURKCELL İLETİŞİM HİZMETLERİ A.Ş.')).toBe('turkcell');
    expect(firmaCekirdek('Turkcell')).toBe('turkcell');
    expect(firmaCekirdek('TÜRK TELEKOMÜNİKASYON A.Ş.')).toBe('turk telekomunikasyon');
  });
});

describe('firmaEslestir / hedefFirmaEslestir (madde 13, 14)', () => {
  const firmalar = [
    firmaYap('TURKCELL İLETİŞİM HİZMETLERİ A.Ş.'),
    firmaYap('Vodafone Telekomünikasyon A.Ş.'),
    firmaYap('TÜRK TELEKOMÜNİKASYON A.Ş.'),
    firmaYap('İzocam Ticaret ve Sanayi A.Ş.'),
    firmaYap('Getir'),
  ];
  it('basin yazimi tuzel adla bulusur; apostroflu ek engel degil', () => {
    expect(firmaEslestir("Türk Telekom'un yeni CMO'su belli oldu", firmalar)?.firma).toBe('TÜRK TELEKOMÜNİKASYON A.Ş.');
    expect(firmaEslestir(IZOCAM, firmalar)?.firma).toBe('İzocam Ticaret ve Sanayi A.Ş.');
    expect(firmaEslestir('Pazarlama Direktörlüğüne getirildi', firmalar)).toBeNull();
  });
  it("'X, Y'den Z'ye ... gecti' basliginda varis sirketini secer", () => {
    const baslik = "Ali Veli, Turkcell'den Vodafone'a Pazarlama Direktörü olarak geçti";
    const d = unvanCikarDetay(baslik);
    expect(d?.unvan).toBe('Pazarlama Direktörü');
    expect(hedefFirmaEslestir(baslik, d!.konum, firmalar)?.firma).toBe('Vodafone Telekomünikasyon A.Ş.');
    expect(hedefFirmaEslestir(GETIR, unvanCikarDetay(GETIR)!.konum, firmalar)?.firma).toBe('Getir');
  });
});

describe('firmayiKirp', () => {
  it('bastaki firma adini ve kurum kelimelerini kirpar', () => {
    expect(unvanEkiAt(firmayiKirp('Trendyol Group CMO’su', firmaAnahtarlari('Trendyol')))).toBe('CMO');
    expect(firmayiKirp('Watsons Türkiye Pazarlama ve Kategori Direktörü', firmaAnahtarlari('Watsons Türkiye'))).toBe('Pazarlama ve Kategori Direktörü');
    expect(firmayiKirp('Migros Ticaret A.Ş. İcra Kurulu Üyesi', firmaAnahtarlari('MİGROS TİCARET A.Ş.'))).toBe('İcra Kurulu Üyesi');
  });
});

describe('KAP RSC ayristirma', () => {
  const rsc = String.raw`self.__next_f.push([1,"\"itemKey\":\"kpy41_acc1_int_addres\",\"value\":\"www.ornek-firma.com.tr\",\"disclosureIndex\":1}` +
    String.raw`\"itemKey\":\"kpy41_acc6_yonetimde_soz_sahibi\",\"value\":[{\"nameSurname\":\"ALİ VELİ\",\"tcknYkn\":\"x\",\"credentialKey\":\"CREDENTIAL_TYPE_TCKN\",\"title\":\"Genel Müdür\",\"profession\":null},` +
    String.raw`{\"nameSurname\":\"AYŞE FATMA ÖRNEK\",\"tcknYkn\":\"y\",\"credentialKey\":\"CREDENTIAL_TYPE_TCKN\",\"title\":\"Pazarlama Genel Müdür Yardımcısı\",\"profession\":null}]}` +
    String.raw`\"itemKey\":\"kpy41_acc7_baska\",\"value\":[{\"nameSurname\":\"BASKA KISI\",\"title\":\"Pazarlama Direktörü\"}]"])`;
  it('kapPersonelParcala yalniz "Yonetimde Soz Sahibi" tablosunu okur', () => {
    expect(kapPersonelParcala(rsc)).toEqual([
      { isim: 'ALİ VELİ', unvan: 'Genel Müdür' },
      { isim: 'AYŞE FATMA ÖRNEK', unvan: 'Pazarlama Genel Müdür Yardımcısı' },
    ]);
    expect(kapPersonelParcala('<html>yok</html>')).toEqual([]);
  });
  it('kapWebParcala internet adresini alan adina cevirir; gecersizse bos (madde 3, 18)', () => {
    expect(kapWebParcala(rsc)).toBe('ornek-firma.com.tr');
    expect(kapWebParcala(String.raw`\"itemKey\":\"kpy41_acc1_int_addres\",\"value\":\"-\"`)).toBe('');
    expect(kapWebParcala('')).toBe('');
  });
});

describe('KAP kimlik (madde 1)', () => {
  it('liste URL kimlik tasimaz; kapStockCode sutunu ve genel/permaLink taninir', () => {
    expect(kapKimlik(['https://www.kap.org.tr/tr/api/company/items/IGS/A'])).toBeNull();
    expect(kapKimlik(['https://www.kap.org.tr/tr/api/company/items/IGS/A'], 'TCELL')).toEqual({ stockCode: 'TCELL' });
    expect(kapKimlik(['https://www.kap.org.tr/tr/sirket-bilgileri/genel/1103-turkcell-iletisim-hizmetleri-a-s'])).toEqual({ permaLink: '1103-turkcell-iletisim-hizmetleri-a-s' });
  });
  it('liste indeksinde tam ad ve hukuki eki atilmis ad ile bulur', () => {
    const indeks = kapIndeksOlustur([
      { unvan: 'TURKCELL İLETİŞİM HİZMETLERİ A.Ş.', stockCode: 'TCELL', mkkMemberOid: 'o1', tip: 'IGS' },
      { unvan: 'AGESA HAYAT VE EMEKLİLİK A.Ş.', stockCode: 'AGESA', mkkMemberOid: 'o2', tip: 'IGS' },
      { unvan: 'AAC BAĞIMSIZ DENETİM VE DANIŞMANLIK A.Ş.', stockCode: null, mkkMemberOid: 'o3', tip: 'BDK' },
      { unvan: 'OTOKAR OTOMOTİV VE SAVUNMA SANAYİ A.Ş.', stockCode: 'OTKAR', mkkMemberOid: 'o4', tip: 'IGS' },
      { unvan: 'GARANTİ FAKTORİNG A.Ş.', stockCode: 'GARFA', mkkMemberOid: 'o5', tip: 'IGS' },
      { unvan: 'TÜRKİYE GARANTİ BANKASI A.Ş.', stockCode: 'GARAN', mkkMemberOid: 'o6', tip: 'IGS' },
    ]);
    expect(kapKimlikBul('TURKCELL İLETİŞİM HİZMETLERİ A.Ş.', indeks)?.stockCode).toBe('TCELL');
    expect(kapKimlikBul('AgeSa Hayat ve Emeklilik AŞ', indeks)?.stockCode).toBe('AGESA');
    expect(kapKimlikBul('AAC Bağımsız Denetim ve Danışmanlık A.Ş.', indeks)?.mkkMemberOid).toBe('o3');
  });
  it('tek kelimelik marka adi listede TEK kayitta ilk kelimeyse eslesir; belirsizse asla', () => {
    const indeks = kapIndeksOlustur([
      { unvan: 'TURKCELL İLETİŞİM HİZMETLERİ A.Ş.', stockCode: 'TCELL', mkkMemberOid: 'o1', tip: 'IGS' },
      { unvan: 'OTOKAR OTOMOTİV VE SAVUNMA SANAYİ A.Ş.', stockCode: 'OTKAR', mkkMemberOid: 'o4', tip: 'IGS' },
      { unvan: 'GARANTİ FAKTORİNG A.Ş.', stockCode: 'GARFA', mkkMemberOid: 'o5', tip: 'IGS' },
      { unvan: 'TÜRKİYE GARANTİ BANKASI A.Ş.', stockCode: 'GARAN', mkkMemberOid: 'o6', tip: 'IGS' },
    ]);
    expect(kapKimlikBul('Otokar', indeks)?.stockCode).toBe('OTKAR');
    expect(kapKimlikBul('Turkcell', indeks)?.stockCode).toBe('TCELL');
    expect(kapKimlikBul('Garanti', indeks)).toBeNull();
    expect(kapKimlikBul('Garanti BBVA', indeks)).toBeNull();
    expect(kapKimlikBul('Bim', indeks)).toBeNull();
  });
});

describe('kisileriBirlestir (madde 6)', () => {
  it('KAP ve Fortune ayni kisiyi verirse KAP satiri kalir', () => {
    const fortune: Kisi = { firma: 'Turkcell', web: 'turkcell.com.tr', ad: 'Ali', soyad: 'Veli', unvan: 'CMO', kademe: 1, kaynak: 'fortune', kaynakUrl: 'f', kaynakTarihi: '2022', guven: 'dusuk' };
    const kap: Kisi = { ...fortune, firma: 'TURKCELL İLETİŞİM HİZMETLERİ A.Ş.', ad: 'ALİ', soyad: 'VELİ', unvan: 'Pazarlama Genel Müdür Yardımcısı', kaynak: 'kap', kaynakUrl: 'k', kaynakTarihi: '', guven: 'yuksek' };
    const baska: Kisi = { ...fortune, ad: 'Ayşe', soyad: 'Örnek' };
    const out = kisileriBirlestir([fortune, kap, baska]);
    expect(out).toHaveLength(2);
    expect(out.find((k) => k.soyad === 'VELİ')?.kaynak).toBe('kap');
    expect(out.some((k) => k.kaynak === 'fortune' && k.soyad === 'Veli')).toBe(false);
  });
});

describe('mtYazi (madde 28)', () => {
  it('yalniz govde basliklarini alir; ilgili yazi kutusu ve "Ilgili Haberler" sonrasi okunmaz', () => {
    const html = `<html><head>
      <meta property="og:title" content="${IZOCAM} | Marketing Türkiye">
      <meta property="article:published_time" content="2025-03-04T10:00:00+03:00">
      </head><body>
      <div class="post-content">
        <h2>${GETIR}</h2>
        <div class="thb-related-posts"><h3>Başka bir haberin başlığı burada durur</h3></div>
        <h2>İlgili Haberler</h2>
        <h3>Sonraki haberin başlığı da burada durur</h3>
      </div>
      <div class="related"><h2>Dış kutudaki haber başlığı burada</h2></div>
      </body></html>`;
    const y = mtYazi(html);
    expect(y.tarih).toBe('2025-03-04');
    expect(y.basliklar).toEqual([IZOCAM, GETIR]);
  });
});

describe('hataKodu (madde 16)', () => {
  it('URL basmaz, yalniz HTTP durumu / hata turu', () => {
    expect(hataKodu(new Error('HTTP 404 https://example.com/gizli-haber'))).toBe('HTTP 404');
    const abort = new Error('x'); abort.name = 'AbortError';
    expect(hataKodu(abort)).toBe('zaman asimi');
    expect(hataKodu(new SyntaxError('Unexpected token'))).toBe('yanit JSON degil');
  });
});

describe('tarihGuven', () => {
  it('2024+ orta, oncesi/bilinmeyen dusuk', () => {
    expect(tarihGuven('2024-05-01')).toBe('orta');
    expect(tarihGuven('2019-01-01')).toBe('dusuk');
    expect(tarihGuven('')).toBe('dusuk');
  });
});
