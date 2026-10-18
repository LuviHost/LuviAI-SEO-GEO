import { describe, it, expect } from 'vitest';
import { assessOperability } from './operability.js';

const BASE = 'https://kuafor.com';

describe('assessOperability — iletisim', () => {
  it('tel: ve WhatsApp linklerini sayar; duz metin numara sayilmaz', () => {
    const r = assessOperability(`
      <a href="tel:+902125550000">Ara</a>
      <a href="TEL:+905551112233">Cep</a>
      <a href="https://wa.me/905551112233">WhatsApp</a>
      <a href="https://api.whatsapp.com/send?phone=905551112233">WA</a>
      <p>Telefon: 0212 555 00 00</p>`, BASE);
    expect(r.contact).toEqual({ tel: 2, whatsapp: 2 });
  });
});

describe('assessOperability — form anlamlari', () => {
  it('etiketli/etiketsiz alan, tur uyumsuzlugu ve autocomplete', () => {
    const r = assessOperability(`
      <form>
        <label for="ad">Ad Soyad</label><input id="ad" name="ad" autocomplete="name">
        <input name="telefon" type="text" placeholder="Telefon">
        <label>E-posta <input name="eposta" type="email" autocomplete="email"></label>
        <input aria-label="Randevu tarihi" name="tarih" type="text">
        <input type="hidden" name="csrf"><button type="submit">Gönder</button>
        <textarea name="mesaj"></textarea>
      </form>`, BASE);
    expect(r.forms.count).toBe(1);
    expect(r.forms.fields).toBe(5);
    expect(r.forms.labeled).toBe(3);
    expect(r.forms.unlabeled).toEqual(['telefon', 'mesaj']);
    expect(r.forms.autocomplete).toBe(2);
    expect(r.forms.typeMismatches).toEqual([
      'telefon alanı type="text" (önerilen type="tel")',
      'tarih alanı type="text" (önerilen type="date")',
    ]);
  });

  it('"hotel" gibi kelimeler telefon sanilmaz; autocomplete="off" sayilmaz', () => {
    const r = assessOperability('<form><input name="hotel-name" aria-label="Otel" autocomplete="off"></form>', BASE);
    expect(r.forms.typeMismatches).toEqual([]);
    expect(r.forms.autocomplete).toBe(0);
  });
});

describe('assessOperability — rezervasyon ve WebMCP', () => {
  it('yalniz baska alan adindan iframe ile rezervasyon; dogrudan link yok', () => {
    const r = assessOperability('<iframe src="https://booksy.com/widget/123"></iframe><iframe src="https://www.youtube.com/embed/x"></iframe>', BASE);
    expect(r.booking).toEqual({ iframeHosts: ['booksy.com'], directLink: false });
  });

  it('dogrudan randevu linki varsa directLink', () => {
    const r = assessOperability('<iframe src="https://calendly.com/x"></iframe><a href="/randevu">Randevu al</a>', BASE);
    expect(r.booking.directLink).toBe(true);
    expect(r.booking.iframeHosts).toEqual(['calendly.com']);
  });

  it('kendi alan adindaki iframe rezervasyon sayilmaz', () => {
    expect(assessOperability('<iframe src="https://kuafor.com/booking"></iframe>', BASE).booking.iframeHosts).toEqual([]);
  });

  it('bildirimsel WebMCP form nitelikleri', () => {
    const r = assessOperability(`
      <form toolname="randevuAl" tooldescription="Randevu oluşturur.">
        <select name="hizmet" toolparamdescription="Hizmet türü"><option>Kesim</option></select>
        <input name="saat" type="time" toolparamdescription="Saat">
      </form>
      <form toolname="ara"></form>`, BASE);
    expect(r.webmcp).toEqual({ forms: 2, described: 1, params: 2 });
  });

  it('bos HTML patlamaz', () => {
    expect(assessOperability('', BASE).forms.count).toBe(0);
  });
});
