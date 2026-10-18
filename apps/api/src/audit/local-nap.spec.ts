import { describe, it, expect } from 'vitest';
import { normalizeText, foldForMatch } from '../common/text-normalize.js';
import { brandMatcher } from './brand-in-query.js';
import {
  addressFromSchema, answerNapSignal, compareAddress, comparePhone, hasUsableNap, parsePlainAddress,
  phonesFromTelHrefs, provinceFromPostalCode, provinceOf, siteNapFromJsonLd, siteNapFromPage, TR_PROVINCE_COUNT,
} from './local-nap.js';

/** buildProbe'un yaptigi gibi: normalize + katlanmis metin + marka eslestirici */
function signal(answer: string, brand = 'Lavanta Kuaför', host = 'lavantakuafor.com') {
  const text = normalizeText(answer);
  return answerNapSignal(text, foldForMatch(text), brandMatcher(brand, host));
}

describe('provinceOf — 81 il', () => {
  it('liste 81 il ve yazim farklari kanonik ada iner', () => {
    expect(TR_PROVINCE_COUNT).toBe(81);
    expect(provinceOf('istanbul')).toBe('İstanbul');
    expect(provinceOf('ISTANBUL')).toBe('İstanbul');
    expect(provinceOf("Ankara'da")).toBe('Ankara');
    expect(provinceOf('Antep')).toBe('Gaziantep');
    expect(provinceOf('İçel')).toBe('Mersin');
    expect(provinceOf('sanliurfa')).toBe('Şanlıurfa');
    expect(provinceOf('Kadıköy')).toBeNull();
  });
});

describe('site adresi', () => {
  it('duz metin adres: ilce/il/posta kodu', () => {
    expect(parsePlainAddress('Caferağa Mah. Moda Cad. No:12, 34710 Kadıköy/İstanbul')).toEqual({
      street: 'Caferağa Mah. Moda Cad. No:12', district: 'Kadıköy', city: 'İstanbul', postalCode: '34710',
    });
    expect(parsePlainAddress('Kızılay, Ankara')).toMatchObject({ district: 'Kızılay', city: 'Ankara' });
    // Ilden once numara geliyorsa ilce uydurulmaz
    expect(parsePlainAddress('Moda Cad. No:12 İstanbul')).toMatchObject({ district: null, city: 'İstanbul' });
  });

  it('PostalAddress: addressLocality ilce, addressRegion il; bolge/Merkez ilce sayilmaz', () => {
    expect(addressFromSchema({ '@type': 'PostalAddress', streetAddress: 'Moda Cd. 1', addressLocality: 'Kadikoy', addressRegion: 'Istanbul' }))
      .toMatchObject({ district: 'Kadikoy', city: 'İstanbul', street: 'Moda Cd. 1' });
    expect(addressFromSchema({ addressLocality: 'İstanbul', addressRegion: 'Marmara' })).toMatchObject({ district: null, city: 'İstanbul' });
    expect(addressFromSchema({ addressLocality: 'Merkez', addressRegion: 'Bolu' })).toMatchObject({ district: null, city: 'Bolu' });
    expect(addressFromSchema({ addressLocality: 'Çankaya, Ankara' })).toMatchObject({ district: 'Çankaya', city: 'Ankara' });
    // Tum adresi streetAddress'e yazan site
    expect(addressFromSchema({ streetAddress: 'Bağdat Cad. No:5 Kadıköy/İstanbul' })).toMatchObject({ district: 'Kadıköy', city: 'İstanbul' });
  });
});

describe('siteNapFromJsonLd / tel:', () => {
  const salon = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: 'Salon Moda',
    telephone: '+90 216 555 00 00',
    address: { '@type': 'PostalAddress', streetAddress: 'Moda Cd. 1', addressLocality: 'Kadıköy', addressRegion: 'İstanbul', postalCode: '34710' },
  };

  it('LocalBusiness alt turu: telefon E.164, adres ilce/il', () => {
    expect(siteNapFromJsonLd([salon])).toEqual({
      phones: ['+902165550000'],
      addresses: [{ street: 'Moda Cd. 1', district: 'Kadıköy', city: 'İstanbul', postalCode: '34710' }],
      businessTypes: ['HairSalon'],
    });
  });

  it('@graph icinde ve cok subeli; Organization telefonu alinmaz', () => {
    const graph = {
      '@graph': [
        { '@type': 'Organization', name: 'X Holding', telephone: '0212 999 99 99' },
        { ...salon, '@id': 'a' },
        { '@type': 'BeautySalon', telephone: ['0216 555 00 01'], address: 'Bahariye Cad. No:3 Kadıköy/İstanbul' },
      ],
    };
    const nap = siteNapFromJsonLd([graph]);
    expect(nap.phones).toEqual(['+902165550000', '+902165550001']);
    expect(nap.addresses).toHaveLength(2);
    expect(nap.businessTypes).toEqual(['HairSalon', 'BeautySalon']);
  });

  it('tel: baglantilari ve sayfa birlesimi', () => {
    expect(phonesFromTelHrefs(['tel:+902165550000', 'mailto:a@b.com', 'tel:0532 111 22 33', 'tel:+902165550000'])).toEqual(['+902165550000', '+905321112233']);
    const page = siteNapFromPage({ jsonLdBlocks: [], telHrefs: ['tel:0216 555 00 00'] });
    expect(page.sources).toEqual(['tel-link']);
    expect(hasUsableNap(page)).toBe(true);
    expect(hasUsableNap(siteNapFromPage({ jsonLdBlocks: [{ '@type': 'WebSite' }], telHrefs: [] }))).toBe(false);
  });
});

describe('answerNapSignal — markanin yanindaki telefon/adres', () => {
  it('liste bicimi: markanin maddesindeki ayrinti satirlari, sonraki isletme haric', () => {
    const answer = [
      "Kadıköy'de öne çıkan kuaförler:",
      '',
      '1. **Lavanta Kuaför**',
      '   - Adres: Caferağa Mah. Moda Cad. No:12, Kadıköy/İstanbul',
      '   - Telefon: 0216 555 00 00',
      '',
      '2. **Rakip Kuaför**',
      '   - Adres: Bahariye Cad. No:3, Kadıköy',
      '   - Telefon: 0216 999 88 77',
    ].join('\n');
    const s = signal(answer)!;
    expect(s.nearPhones).toEqual(['+902165550000']);
    expect(s.allPhones).toEqual(['+902165550000', '+902169998877']);
    expect(s.address).toBe('Caferağa Mah. Moda Cad. No:12, Kadıköy/İstanbul');
  });

  it('marka bir ozet cumlede de geciyorsa liste maddesindeki ayrinti bulunur', () => {
    const answer = 'Lavanta Kuaför ve Rakip Kuaför öne çıkıyor.\n\n### Lavanta Kuaför\nModa sahiline yakın, butik bir salon.\nTelefon: 0532 111 22 33\n\n### Rakip Kuaför\nTelefon: 0216 999 88 77';
    const s = signal(answer)!;
    expect(s.nearPhones).toEqual(['+905321112233']);
    expect(s.address).toBeNull();
  });

  it('marka yoksa yakin numara yok; tum numaralar yine listelenir', () => {
    const s = signal('Rakip Kuaför: 0216 999 88 77')!;
    expect(s.nearPhones).toEqual([]);
    expect(s.allPhones).toEqual(['+902169998877']);
  });

  it('ayni cumlede baglacla baslayan baska isletmenin numarasi markaya yazilmaz', () => {
    const s = signal("Kadıköy'de Lavanta Kuaför ve Rakip Salon (0216 999 88 77) öne çıkıyor.")!;
    expect(s.nearPhones).toEqual([]);
    expect(s.allPhones).toEqual(['+902169998877']);
    // Markanin kendi cumlesindeki ikinci numara (baglactan sonra rakam) markanindir
    const own = signal('Lavanta Kuaför, Moda\'da: 0216 555 00 00 ve 0532 111 22 33.')!;
    expect(own.nearPhones).toEqual(['+902165550000', '+905321112233']);
  });

  it('adres alintisi: etiketten sonrasi, sonraki etikette kesilir; tablo hucresi; cumle', () => {
    const tek = signal("* **Lavanta Kuaför:** Moda'da butik salon. Adres: Caferağa Mah. Moda Cad. No:12 Kadıköy/İstanbul, Tel: 0216 555 00 00")!;
    expect(tek.address).toBe('Caferağa Mah. Moda Cad. No:12 Kadıköy/İstanbul');
    expect(tek.nearPhones).toEqual(['+902165550000']);
    const tablo = signal('| Salon | Adres | Telefon |\n|---|---|---|\n| Lavanta Kuaför | Moda Cad. No:12, Kadıköy | 0216 555 00 00 |')!;
    expect(tablo.address).toBe('Moda Cad. No:12, Kadıköy');
    const paragraf = signal('**Lavanta Kuaför** öne çıkıyor [1]. Salon Moda Caddesi üzerinde yer alıyor ve randevu alınabiliyor [2].')!;
    expect(paragraf.address).toBe('Salon Moda Caddesi üzerinde yer alıyor ve randevu alınabiliyor [2].');
  });

  it('isletme yalniz alan adiyla anilsa da maddedeki numara bulunur', () => {
    const s = signal('- lavantakuafor.com — Moda Cad. No:12, Kadıköy · Tel: 0216 555 00 00\n- rakip.com — 0216 999 88 77')!;
    expect(s.nearPhones).toEqual(['+902165550000']);
  });

  it('hicbir sey yoksa null (incelendi, bulunmadi)', () => {
    expect(signal('Kadıköy’de birçok iyi kuaför var; yorumlara bakarak seçebilirsiniz.')).toBeNull();
  });
});

describe('karsilastirma', () => {
  const site = ['+902165550000'];
  const addr = [{ street: null, district: 'Kadıköy', city: 'İstanbul', postalCode: null }];

  it('telefon: eslesiyor / farkli / yok / bilinmiyor', () => {
    expect(comparePhone(site, { nearPhones: ['+902165550000'], allPhones: ['+902165550000'], address: null }).status).toBe('eslesiyor');
    // Sitedeki numara cevabin baska yerinde geciyorsa da dogru numara verilmistir
    expect(comparePhone(site, { nearPhones: [], allPhones: ['+902165550000'], address: null }).status).toBe('eslesiyor');
    expect(comparePhone(site, { nearPhones: ['+902169998877'], allPhones: ['+902169998877'], address: null }))
      .toEqual({ status: 'farkli', found: ['+902169998877'] });
    expect(comparePhone(site, { nearPhones: [], allPhones: ['+902169998877'], address: null }).status).toBe('yok');
    expect(comparePhone(site, null).status).toBe('yok');
    expect(comparePhone([], { nearPhones: ['+902169998877'], allPhones: [], address: null }))
      .toEqual({ status: 'bilinmiyor', found: ['+902169998877'] });
  });

  it('telefon: cevapta 10+ rakip numarası olsa da markanın yanındaki site numarası eşleşir', () => {
    const lines = Array.from({ length: 11 }, (_, i) => `${i + 1}. **Rakip Salon ${i + 1}** — Tel: 0216 999 ${String(10 + i).padStart(2, '0')} ${String(20 + i)}`);
    lines.push('12. **Lavanta Kuaför** — Tel: 0216 555 00 00');
    const s = signal(lines.join('\n'))!;
    expect(s.nearPhones).toEqual(['+902165550000']);
    expect(s.allPhones).toContain('+902165550000');
    // Eskiden allPhones 10'da kesiliyordu → "farkli" ve sitenin kendi numarasi "farkli numara" diye gosteriliyordu
    expect(comparePhone(site, s)).toEqual({ status: 'eslesiyor', found: ['+902165550000'] });
    // Eski (10'luk) kayitta da yakin numara sayilir
    expect(comparePhone(site, { nearPhones: ['+902165550000'], allPhones: lines.slice(0, 10).map((_, i) => `+90216999${i}`), address: null }).status).toBe('eslesiyor');
  });

  it('telefon: eski kurallarla saklanmış site numarası cevapla aynı kurala indirilir', () => {
    // "0212 444 0 448" eskiden +902124440448 diye saklanıyordu; artık 7 haneli 444 numarası
    const s = signal('**Lavanta Kuaför** çağrı merkezi: 0212 444 0 448')!;
    expect(s.nearPhones).toEqual(['+904440448']);
    expect(comparePhone(['+902124440448'], s)).toEqual({ status: 'eslesiyor', found: ['+904440448'] });
  });

  it('telefon: adresteki kapı numarası sahte numara üretmez ("No:5 - 0216 ...")', () => {
    const s = signal('- **Lavanta Kuaför** — Moda Cad. No:5 - 0216 555 00 00')!;
    expect(s.nearPhones).toEqual(['+902165550000']);
    expect(comparePhone(site, s).status).toBe('eslesiyor');
    const kat = signal('Lavanta Kuaför, Bahariye Cad. Kat 5 (0216) 555 00 00')!;
    expect(comparePhone(site, kat).status).toBe('eslesiyor');
  });

  it('adres: site ilinin bilinmediği adreste cevaptaki il "farklı il" sayılmaz', () => {
    const at = (address: string) => ({ nearPhones: [], allPhones: [], address });
    // addressRegion bölge adı ("Marmara"): il bilinmiyor
    const regionOnly = addressFromSchema({ streetAddress: 'Bağdat Cad. No:5', addressLocality: 'Kadıköy', addressRegion: 'Marmara' })!;
    expect(regionOnly).toMatchObject({ district: 'Kadıköy', city: null });
    expect(compareAddress([regionOnly], at('Bağdat Caddesi 5, İstanbul'))).toMatchObject({ status: 'dogrulanamadi', otherCity: null });
    // İki şube: birinin ili bilinmiyorsa "başka il" denemez
    const twoBranches = [
      { street: null, district: 'Kadıköy', city: null, postalCode: null },
      { street: null, district: 'Çankaya', city: 'Ankara', postalCode: null },
    ];
    expect(compareAddress(twoBranches, at('Bağdat Caddesi 5, İstanbul'))).toMatchObject({ status: 'dogrulanamadi', otherCity: null });
    // Tüm şubelerin ili biliniyorsa başka il yine yakalanır
    expect(compareAddress([{ street: null, district: 'Kadıköy', city: 'İstanbul', postalCode: null }, twoBranches[1]], at('Konak Meydanı, İzmir')))
      .toMatchObject({ status: 'eslesmiyor', otherCity: 'İzmir' });
  });

  it('adres: il, Türkiye posta kodunun ilk iki hanesinden (plaka kodu) çıkarılır', () => {
    const at = (address: string) => ({ nearPhones: [], allPhones: [], address });
    const withPostal = addressFromSchema({ addressLocality: 'Kadıköy', addressRegion: 'Marmara', postalCode: '34710' })!;
    expect(withPostal).toMatchObject({ district: 'Kadıköy', city: 'İstanbul', postalCode: '34710' });
    expect(compareAddress([withPostal], at('Bağdat Caddesi 5, İstanbul'))).toMatchObject({ status: 'kismen', matched: ['İstanbul'] });
    expect(compareAddress([withPostal], at('Kızılay, Çankaya/Ankara'))).toMatchObject({ status: 'eslesmiyor', otherCity: 'Ankara' });
    // Posta kodu streetAddress içinde
    expect(addressFromSchema({ streetAddress: 'Moda Cad. No:12, 34710', addressLocality: 'Kadıköy' })).toMatchObject({ city: 'İstanbul' });
    // Türkiye dışı adreste plaka çıkarımı yapılmaz (10115 Berlin ≠ Balıkesir)
    expect(addressFromSchema({ addressLocality: 'Mitte', postalCode: '10115', addressCountry: 'DE' })).toMatchObject({ city: null });
    expect(addressFromSchema({ addressLocality: 'Moda', postalCode: '34710', addressCountry: { '@type': 'Country', name: 'TR' } })).toMatchObject({ city: 'İstanbul' });
  });

  it('plaka kodu tablosu: 81 il, kaynaklardaki örneklerle tutarlı', () => {
    expect(provinceFromPostalCode('34710')).toBe('İstanbul');
    expect(provinceFromPostalCode('06100')).toBe('Ankara');
    expect(provinceFromPostalCode('16400')).toBe('Bursa'); // İnegöl
    expect(provinceFromPostalCode('76000')).toBe('Iğdır');
    expect(provinceFromPostalCode('81000')).toBe('Düzce');
    expect(provinceFromPostalCode('01000')).toBe('Adana');
    expect(provinceFromPostalCode('99010')).toBeNull(); // KKTC (Lefkoşa) — plaka kodu değil
    expect(provinceFromPostalCode('00100')).toBeNull();
    expect(provinceFromPostalCode('3471')).toBeNull();
    // Tablodaki her ad kanonik il adı (provinceOf ile birebir)
    for (let p = 1; p <= TR_PROVINCE_COUNT; p++) {
      const name = provinceFromPostalCode(`${String(p).padStart(2, '0')}000`);
      expect(name && provinceOf(name), String(p)).toBe(name);
    }
    expect(new Set(Array.from({ length: 81 }, (_, i) => provinceFromPostalCode(`${String(i + 1).padStart(2, '0')}000`))).size).toBe(81);
  });

  it('adres: mahalle ilçe sayılmaz; son uygun yer adı ilçedir', () => {
    expect(addressFromSchema({ addressLocality: 'Caferağa Mah., Kadıköy', addressRegion: 'İstanbul' })).toMatchObject({ district: 'Kadıköy', city: 'İstanbul' });
    expect(addressFromSchema({ addressLocality: 'Moda Cad. No:12, Kadıköy/İstanbul' })).toMatchObject({ district: 'Kadıköy', city: 'İstanbul' });
    expect(addressFromSchema({ addressLocality: 'Moda, Kadıköy', addressRegion: 'İstanbul' })).toMatchObject({ district: 'Kadıköy' });
    const site2 = [addressFromSchema({ addressLocality: 'Caferağa Mah., Kadıköy', addressRegion: 'İstanbul' })!];
    expect(compareAddress(site2, { nearPhones: [], allPhones: [], address: 'Moda Cad. No:12, Kadıköy/İstanbul' }).status).toBe('eslesiyor');
    // Düzeltmeden önce saklanmış kayıt (ilçe = mahalle) karşılaştırmada yok sayılır
    const stored = [{ street: null, district: 'Caferağa Mah.', city: 'İstanbul', postalCode: null }];
    expect(compareAddress(stored, { nearPhones: [], allPhones: [], address: 'Moda Cad. No:12, Kadıköy/İstanbul' })).toMatchObject({ status: 'eslesiyor', matched: ['İstanbul'] });
  });

  it('adres: ilce/il belirtecleri — eslesiyor / kismen / eslesmiyor / dogrulanamadi / yok / bilinmiyor', () => {
    const at = (address: string | null) => ({ nearPhones: [], allPhones: [], address });
    expect(compareAddress(addr, at('Moda Cad. No:12, Kadikoy/Istanbul'))).toMatchObject({ status: 'eslesiyor', matched: ['Kadıköy', 'İstanbul'] });
    expect(compareAddress(addr, at("Kadıköy'de Moda Caddesi üzerinde")).status).toBe('kismen');
    // Ayni il, baska ilce → kismen (ilce tutmuyor)
    expect(compareAddress(addr, at('Barbaros Bulvarı No:5, Beşiktaş/İstanbul'))).toMatchObject({ status: 'kismen', matched: ['İstanbul'] });
    // Baska il acikca geciyorsa eslesmiyor + hangi il
    expect(compareAddress(addr, at('Kızılay Mah. Atatürk Blv. No:5, Çankaya/Ankara'))).toMatchObject({ status: 'eslesmiyor', otherCity: 'Ankara' });
    // Il adi sokak adiysa ("Ankara Cad.") baska il sayilmaz; ilce/il yoksa yanlis da denmez
    expect(compareAddress(addr, at('Ankara Cad. No:3'))).toMatchObject({ status: 'dogrulanamadi', otherCity: null });
    expect(compareAddress(addr, at('Barbaros Bulvarı No:5, Beşiktaş')).status).toBe('dogrulanamadi');
    // "Kadıköylü" Kadıköy sayilmaz (kelime siniri)
    expect(compareAddress(addr, at('Kadıköylü ustalar, Bağdat Cad.')).status).toBe('dogrulanamadi');
    expect(compareAddress(addr, at(null)).status).toBe('yok');
    expect(compareAddress([], at('Moda Cad. Kadıköy')).status).toBe('bilinmiyor');
  });
});
