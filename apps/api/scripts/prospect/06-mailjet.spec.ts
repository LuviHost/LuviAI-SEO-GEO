import { describe, expect, it } from 'vitest';
import { GONDERIM_SEKTORLERI, firmaKisa, isimsizHitap, konuSatiri } from './06-mailjet.js';

describe('06-mailjet kurumsal kutu destegi', () => {
  it('isimsiz alicida hitap "Merhaba {firma} ekibi," olur', () => {
    const govde = '<!-- {{var:ad}} {{var:soyad}} -->\n<p>Sayın {{var:ad}} {{var:soyad}},</p>\n<p>{{var:firma}} için</p>';
    const out = isimsizHitap(govde);
    expect(out).toContain('Merhaba {{var:firma}} ekibi,');
    expect(out).not.toMatch(/Sayın \{\{var:ad\}\}/);
  });

  it('hitap satiri yoksa ya da govdede baska {{ad}} kaldiysa null (bos adli selam gitmez)', () => {
    expect(isimsizHitap('Merhaba,')).toBeNull();
    expect(isimsizHitap('Sayın {{var:ad}} {{var:soyad}},\n{{var:ad}} Bey')).toBeNull();
  });

  it('ajans konu satiri ayri; diger sektorler A/B; 60 karakter siniri', () => {
    expect(konuSatiri('ajans', 'A', 'X')).toBe("Müşterileriniz ChatGPT'de görünüyor mu?");
    expect(konuSatiri('ajans', 'B', 'Medyaevi')).toBe('Medyaevi için AI görünürlük iş birliği');
    expect(konuSatiri('finans', 'B', 'Akbank')).toBe('ChatGPT Akbank hakkında ne söylüyor?');
    expect(konuSatiri('diger', 'Z', 'Arçelik')).toBe('Arçelik — AI asistanlarında görünürlük');
  });

  it('gonderim sektorleri ajans ve genel dahil', () => {
    expect(GONDERIM_SEKTORLERI).toContain('ajans');
    expect(GONDERIM_SEKTORLERI).toContain('diger');
  });

  it('uzun teknik unvanlarda faaliyet kuyrugu kirpilir; finans/otel adlari korunur', () => {
    expect(firmaKisa('ARKSİGNER YAZILIM VE DONANIM A.Ş.')).toBe('Arksigner');
    expect(firmaKisa('Belbim Elektronik Para ve Ödeme Hizmetleri A.Ş.')).toBe('Belbim');
    expect(firmaKisa('Crowne Plaza İstanbul Oryapark')).toBe('Crowne Plaza İstanbul Oryapark');
    expect(firmaKisa('Ankara Anonim Türk Sigorta Şirketi')).toBe('Ankara Anonim Türk Sigorta Şirketi');
    expect(firmaKisa('AFN Teknoloji')).toBe('AFN Teknoloji'); // kisa ad dokunulmaz
  });

  it('ajans unvan kuyruklari kirpilir, Turkce harf korunur', () => {
    expect(firmaKisa('PUNCH BBDO REKLAMCILIK VE İLETİŞİM HİZMETLERİ TİCARET A.Ş.')).toBe('Punch BBDO');
    expect(firmaKisa('ÖRNEK REKLAMCILIK A.Ş.')).toBe('Örnek');
  });
});
