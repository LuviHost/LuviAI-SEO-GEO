import { describe, expect, it } from 'vitest';
import { cfemailCoz, enIyiRolAdresi, rolOnceligi, sayfadakiAdresler } from './kurumsal-adres.js';

describe('rolOnceligi', () => {
  it('rol kutulari kabul, sira korunur', () => {
    expect(rolOnceligi('pazarlama')).toBeLessThan(rolOnceligi('info'));
    expect(rolOnceligi('info')).toBeGreaterThanOrEqual(0);
    expect(rolOnceligi('iletisim')).toBeGreaterThanOrEqual(0);
    expect(rolOnceligi('kurumsal.iletisim')).toBeGreaterThanOrEqual(0);
  });

  it('isimli adres secilmez', () => {
    expect(rolOnceligi('ayse.yilmaz')).toBe(-1);
    expect(rolOnceligi('ayilmaz')).toBe(-1);
    expect(rolOnceligi('info-tr')).toBe(-1); // "tr" rol degil — bas harf olabilir
  });

  it('tanitima kapali kutular secilmez', () => {
    for (const l of ['destek', 'kvkk', 'ik', 'kariyer', 'noreply', 'muhasebe', 'kvkk.basvuru', 'info.kvkk', 'musterihizmetleri', 'basin', 'ir']) {
      expect(rolOnceligi(l), l).toBe(-1);
    }
  });
});

describe('enIyiRolAdresi', () => {
  it('ayni alan adindaki en iyi rol kutusunu secer', () => {
    const r = enIyiRolAdresi(['info@acme.com.tr', 'pazarlama@acme.com.tr', 'ali.veli@acme.com.tr', 'destek@acme.com.tr'], 'acme.com.tr');
    expect(r?.email).toBe('pazarlama@acme.com.tr');
  });

  it('baska alan adini ve gmaili almaz; alt alan adini alir', () => {
    expect(enIyiRolAdresi(['info@gmail.com', 'info@ajans.com'], 'acme.com.tr')).toBeNull();
    expect(enIyiRolAdresi(['info@tr.acme.com'], 'acme.com')?.email).toBe('info@tr.acme.com');
  });

  it('yalniz isimli/kapali adres varsa null', () => {
    expect(enIyiRolAdresi(['ayse.yilmaz@acme.com', 'kvkk@acme.com'], 'acme.com')).toBeNull();
  });
});

describe('marka / sube kutusu ve yakin alan adi', () => {
  it('marka adini tasiyan kutu info@ sirasinda; sube kutusu en sonda', () => {
    expect(rolOnceligi('atleasing', 'atleasing.com.tr')).toBe(rolOnceligi('info'));
    expect(rolOnceligi('ankara')).toBeGreaterThan(rolOnceligi('info'));
    expect(enIyiRolAdresi(['ankara@acme.com', 'info@acme.com'], 'acme.com')?.email).toBe('info@acme.com');
    expect(enIyiRolAdresi(['ankara@acme.com'], 'acme.com')?.email).toBe('ankara@acme.com');
  });

  it('sitede yayimlanmis yakin yazimli alan adi kabul; kisa/farkli etiket ve KEP degil', () => {
    expect(enIyiRolAdresi(['pazarlama@acarfaktoring.com.tr'], 'acarfactoring.com.tr')?.email).toBe('pazarlama@acarfaktoring.com.tr');
    expect(enIyiRolAdresi(['info@abd.com'], 'abc.com')).toBeNull();
    expect(enIyiRolAdresi(['aodeme@hs03.kep.tr'], 'morpara.com')).toBeNull();
  });
});

describe('cfemail', () => {
  it('Cloudflare gizlemesini cozer', () => {
    // anahtar 0x42, "info@a.co"
    const s = 'info@a.co';
    const hex = '42' + [...s].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
    expect(cfemailCoz(hex)).toBe(s);
    expect(cfemailCoz('zz')).toBeNull();
  });

  it('sayfadakiAdresler: mailto + metin + cfemail, script icini almaz', () => {
    const hex = '42' + [...'iletisim@acme.com'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
    const html = `<a href="mailto:Info@Acme.com?subject=x">yaz</a> <p>pazarlama@acme.com.</p>
      <span data-cfemail="${hex}">[email&#160;protected]</span><script>var a="gizli@acme.com"</script>`;
    const r = sayfadakiAdresler(html);
    expect(r).toContain('info@acme.com');
    expect(r).toContain('pazarlama@acme.com');
    expect(r).toContain('iletisim@acme.com');
    expect(r).not.toContain('gizli@acme.com');
  });
});
