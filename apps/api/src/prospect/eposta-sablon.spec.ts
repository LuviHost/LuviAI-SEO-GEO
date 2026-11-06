import { describe, expect, it } from 'vitest';
import { kimlikSorunlari, mailjetMesaj, mesajDenetimi, sablonSektoru, sektorSorusu, type EpostaKimlik } from './eposta-sablon.js';

const K: EpostaKimlik = {
  fromEmail: 'emir@ranksup.ai', fromName: 'Emir · RanksUp', replyTo: 'emir@ranksup.ai', gonderenAd: 'Emir Burgazlı',
  gonderenUnvan: 'RanksUp Kurucusu', gonderenAdres: 'Osmangazi/Bursa', mersis: '', kimlik: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.',
};

describe('eposta-sablon yasal denetim', () => {
  it('gercek sablonlarla uretilen mesaj denetimden gecer (her sektor)', () => {
    for (const sektor of ['ajans', 'diger', 'finans', 'eticaret-perakende-teknoloji', 'turizm-havayolu-telekom-otomotiv']) {
      const m = mailjetMesaj({ email: 'info@a.com', ad: '', soyad: '', firma: 'Acme', sektor, varyant: 'A' }, { kimlik: K, kampanya: 'kurumsal-2026-10' });
      expect(mesajDenetimi(m, K), sektor).toEqual([]);
      expect(m.TextPart).toContain('Merhaba {{var:firma}} ekibi,');
    }
    expect(kimlikSorunlari(K, ['ajans', 'diger'])).toEqual([]);
  });

  it('ret linki ya da kimlik satiri silinmisse denetim yakalar', () => {
    const m = mailjetMesaj({ email: 'info@a.com', ad: '', soyad: '', firma: 'Acme', sektor: 'ajans', varyant: 'A' }, { kimlik: K, kampanya: 'k' });
    const bozuk = { TextPart: m.TextPart.replace('[[UNSUB_LINK_EN]]', ''), HTMLPart: m.HTMLPart.replace(/VKN 1/g, '') };
    const eksik = mesajDenetimi(bozuk, K);
    expect(eksik.join(' ')).toMatch(/düz metinde ret linki yok/);
    expect(eksik.join(' ')).toMatch(/HTML'de kimlik/);
  });

  it('bosluktan ibaret adres eksik sayilir', () => {
    expect(kimlikSorunlari({ ...K, gonderenAdres: '  ' }, [])).toContain('MAILJET_GONDEREN_ADRES bos');
  });
});

describe('Sablon B yalniz tuketici markasina gider (B2B firma alisveris sorusu almaz)', () => {
  const B = 'eticaret-perakende-teknoloji';
  it.each([
    ['avasya.com.tr', 'avasya.com.tr'],
    ['AFN TEKNOLOJİ BİLİŞİM DESTEK VE DANIŞMANLIK HİZ. TİC. LTD. ŞTİ.', 'afnteknoloji.com'],
    ['ARVENTO Mobil Sistemleri A.Ş.', 'arvento.com'],
    ['Erak Giyim San. ve Tic. A.Ş.', 'erak.com'],
    ['İNTERDATA Veri Merkezi Ve Entegrasyon Hizmetleri A.Ş.', 'interdata.com.tr'],
    ['Tekzen Ticaret ve Yatırım A.Ş.', 'tekzen.com.tr'],
  ])('%s → genel sablon', (firma, web) => {
    expect(sablonSektoru(firma, B, web)).toBe('diger');
  });

  it.each([
    ['Akyol Mobilya', 'akyolmobilya.com', 'koltuk takımı almak için hangi marka güvenilir'],
    ['ZEN PIRLANTA', 'zenpirlanta.com', 'nişan yüzüğü için hangi kuyumcu güvenilir'],
    ['ALTINBAŞ', 'altinbas.com', 'nişan yüzüğü için hangi kuyumcu güvenilir'],
    ['GÖNÜL KAHVESİ', 'gonulkahvesi.com.tr', 'iyi kahve için hangi zinciri önerirsin'],
    ['getmobil.com', 'getmobil.com', 'telefon almak için hangi site güvenilir'],
    ['Rossmann Türkiye', 'rossmann.com.tr', 'cilt bakım ürünlerini nereden almalıyım'],
  ])('%s → Sablon B, uygun soru', (firma, web, soru) => {
    expect(sablonSektoru(firma, B, web)).toBe(B);
    expect(sektorSorusu(firma, B, undefined, web)).toBe(soru);
  });

  it('CSV ozel sorusu varsa Sablon B korunur; diger sektorlere dokunulmaz', () => {
    expect(sablonSektoru('avasya.com.tr', B, 'avasya.com.tr', 'kurumsal BT için hangi firma')).toBe(B);
    expect(sablonSektoru('Avasya', 'finans', null)).toBe('finans');
  });

  it('B2B firmaya giden mesaj genel metindir, "alışveriş" demez', () => {
    const m = mailjetMesaj({ email: 'bilgi@avasya.com.tr', ad: '', soyad: '', firma: 'avasya.com.tr', sektor: B, varyant: 'A', web: 'avasya.com.tr' }, { kimlik: K, kampanya: 'k' });
    expect(m.TextPart).not.toMatch(/alışveriş|telefon almak/);
    expect(mesajDenetimi(m, K)).toEqual([]);
  });
});
