import { describe, expect, it } from 'vitest';
import type { EpostaKimlik } from '../prospect/eposta-sablon.js';
import { parseCsv } from '../prospect/prospect-utils.js';
import {
  SOGUK_SUTUNLAR, aracSozdizimi, imzaSatiri, satirBirlestir, retImzaGecerli, retImzasi, retSayfasi, retSirri, retUrl, sogukPaket, sogukSablonlar,
} from './soguk-gonderim.js';

const K: EpostaKimlik = {
  fromEmail: 'emir@ranksup.ai', fromName: 'Emir · RanksUp', replyTo: 'emir@ranksup.ai', gonderenAd: 'Emir Burgazlı',
  gonderenUnvan: 'RanksUp Kurucusu', gonderenAdres: 'Osmangazi/Bursa', mersis: '', kimlik: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.',
};
const SIR = 'test-sir';
const SEKTORLER = ['ajans', 'diger', 'finans', 'eticaret-perakende-teknoloji', 'turizm-havayolu-telekom-otomotiv'];

describe('ret imzasi', () => {
  it('ayni adres (buyuk/kucuk harf, bosluk) ayni imzayi verir ve dogrulanir', () => {
    const t = retImzasi('Info@Acme.com ', SIR);
    expect(t).toBe(retImzasi('info@acme.com', SIR));
    expect(retImzaGecerli('info@acme.com', t, SIR)).toBe(true);
  });

  it('baska adres, baska sir, bos/eksik deger reddedilir', () => {
    const t = retImzasi('info@acme.com', SIR);
    expect(retImzaGecerli('pazarlama@acme.com', t, SIR)).toBe(false);
    expect(retImzaGecerli('info@acme.com', t, 'baska')).toBe(false);
    expect(retImzaGecerli('info@acme.com', t, null)).toBe(false);
    expect(retImzaGecerli('info@acme.com', '', SIR)).toBe(false);
    expect(retImzaGecerli(undefined, t, SIR)).toBe(false);
    expect(retImzaGecerli('info@acme.com', t + 'x', SIR)).toBe(false);
    expect(retImzaGecerli('info@acme.com', 'ğ'.repeat(32), SIR)).toBe(false); // ASCII disi: uzunluk farki hata firlatmaz
  });

  it('URL api koku + /api/eposta/ret, adres kodlanir', () => {
    const u = new URL(retUrl('Info+x@Acme.com', SIR, 'https://api.ranksup.ai/'));
    expect(u.origin + u.pathname).toBe('https://api.ranksup.ai/api/eposta/ret');
    expect(u.searchParams.get('e')).toBe('info+x@acme.com');
    expect(retImzaGecerli(u.searchParams.get('e'), u.searchParams.get('t'), SIR)).toBe(true);
  });

  it('sir: ayri degisken > NEXTAUTH_SECRET > AUTH_SECRET; hicbiri yoksa null', () => {
    expect(retSirri({ EPOSTA_RET_SECRET: 'a', NEXTAUTH_SECRET: 'b' })).toBe('a');
    expect(retSirri({ NEXTAUTH_SECRET: 'b', AUTH_SECRET: 'c' })).toBe('b');
    expect(retSirri({ AUTH_SECRET: 'c' })).toBe('c');
    expect(retSirri({ EPOSTA_RET_SECRET: '  ' })).toBeNull();
  });
});

describe('sablonlar', () => {
  it('Mailjet sozdizimi arac sozdizimine cevrilir; kalinti varsa null', () => {
    expect(aracSozdizimi('Merhaba {{var:firma}} · çık: [[UNSUB_LINK_EN]]')).toBe('Merhaba {{firma}} · çık: {{ret_url}}');
    expect(aracSozdizimi('[[SENDER_ADDRESS]]')).toBeNull();
    expect(aracSozdizimi('Sayın {{var:ad}}')).toBeNull();
  });

  it('her sektorde ilk e-posta + 2 takip: isimsiz hitap, ret linki, md. 5/1 imzasi', () => {
    for (const s of SEKTORLER) {
      const t = sogukSablonlar(s, K);
      expect(t).toHaveLength(3);
      for (const m of t) {
        expect(m.govde, `${s} ${m.ad}`).toContain('Merhaba {{firma}} ekibi,');
        expect(m.govde).toContain('{{ret_url}}');
        expect(m.govde).toContain(imzaSatiri(K));
        expect(m.govde).not.toMatch(/\{\{var:|\[\[|\{\{(ad|soyad|unsubscribe|gonderen)/);
      }
    }
  });

  it('paragraf ici kirilimlar birlesir; imza, hitap ve paragraf araliklari korunur', () => {
    expect(satirBirlestir('{{firma}} adının\ngeçip geçmediğini')).toBe('{{firma}} adının geçip geçmediğini');
    expect(satirBirlestir('önermiştim.\nTek soru')).toBe('önermiştim.\nTek soru');
    expect(satirBirlestir('Saygılarımla,\nEmir Burgazlı\nKurucu')).toBe('Saygılarımla,\nEmir Burgazlı\nKurucu');
    expect(satirBirlestir('bir.\n\nyeni paragraf')).toBe('bir.\n\nyeni paragraf');
    const t1 = sogukSablonlar('diger', K)[1].govde;
    expect(t1).toContain('{{firma}} adının geçip geçmediğini');
  });

  it('kimlik eksikse sablon hazirlanmaz (hata)', () => {
    expect(() => sogukSablonlar('diger', { ...K, gonderenAdres: '' })).toThrow();
  });
});

describe('paket', () => {
  it('CSV sutunlari + satir degerleri; sablon metni yalniz CSV\'deki sektorleri icerir', () => {
    const p = sogukPaket(
      [
        { email: 'Info@Acme.com', firma: 'ACME TEKNOLOJİ A.Ş.', marka: null, sektor: 'diger', varyant: 'B', web: 'acme.com' },
        { email: 'isbirligi@ajans.com', firma: 'Ajans X', marka: 'X Ajans', sektor: 'ajans', varyant: 'A', web: null },
      ],
      K, SIR, 'https://api.ranksup.ai',
    );
    const rows = parseCsv(p.csv);
    expect(Object.keys(rows[0])).toEqual([...SOGUK_SUTUNLAR]);
    expect(rows[0].email).toBe('info@acme.com');
    expect(rows[0].firma).not.toMatch(/A\.Ş\./);
    expect(rows[0].konu).toContain(rows[0].firma);
    expect(rows[1].firma).toBe('X Ajans');
    expect(retImzaGecerli(rows[1].email, new URL(rows[1].ret_url).searchParams.get('t'), SIR)).toBe(true);
    expect(p.sablonlar).toContain('SEKTÖR: ajans');
    expect(p.sablonlar).toContain('SEKTÖR: diger');
    expect(p.sablonlar).not.toContain('SEKTÖR: finans');
  });

  it('bos liste → yalniz baslik satiri', () => {
    expect(sogukPaket([], K, SIR, 'https://x').csv.trim()).toBe(SOGUK_SUTUNLAR.join(','));
  });
});

describe('ret sayfasi', () => {
  it('GET onay sayfasi form ile POST eder (tarayici tarayicilari ret yazmasin), tamam sayfasinda form yok', () => {
    expect(retSayfasi('onay')).toMatch(/<form method="post"/);
    expect(retSayfasi('tamam')).not.toMatch(/<form/);
    expect(retSayfasi('gecersiz')).toContain('geçersiz');
  });
});
