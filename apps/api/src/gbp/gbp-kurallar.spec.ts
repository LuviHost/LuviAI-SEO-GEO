import { describe, expect, it } from 'vitest';
import { gonderiKuralIhlali, yanitTemizle } from './gbp-kurallar.js';

describe('gonderiKuralIhlali', () => {
  it('temiz metin gecer', () => {
    expect(gonderiKuralIhlali('Bu hafta yeni sezon kahve çekirdeklerimiz raflarda. Bekleriz!')).toBeNull();
  });
  it('telefon, e-posta, sosyal medya ve URL yakalanir', () => {
    expect(gonderiKuralIhlali('Bizi arayın 0532 123 45 67')).toMatch(/telefon/);
    expect(gonderiKuralIhlali('Yazın: info@firma.com')).toMatch(/e-posta/);
    expect(gonderiKuralIhlali('Instagram hesabımızı takip edin')).toMatch(/sosyal/);
    expect(gonderiKuralIhlali('Detaylar www.firma.com.tr adresinde')).toMatch(/web adresi/);
  });
});

describe('yanitTemizle', () => {
  it('tirnak ve markdown temizler', () => {
    expect(yanitTemizle('"**Teşekkürler** Ayşe Hanım!"')).toBe('Teşekkürler Ayşe Hanım!');
  });
});
