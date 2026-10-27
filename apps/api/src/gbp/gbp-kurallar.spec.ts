import { describe, expect, it } from 'vitest';
import { gonderiKuralIhlali, yanitTemizle } from './gbp-kurallar.js';

describe('gonderiKuralIhlali', () => {
  it('temiz metin gecer', () => {
    expect(gonderiKuralIhlali('Bu hafta yeni sezon kahve çekirdeklerimiz raflarda. Bekleriz!')).toBeNull();
  });
  it('telefon, e-posta, sosyal medya ve URL yakalanir', () => {
    expect(gonderiKuralIhlali('Bizi arayın 0532 123 45 67')).toMatch(/telefon/);
    expect(gonderiKuralIhlali('Yazın: info@firma.com')).toMatch(/e-posta/);
    expect(gonderiKuralIhlali('Bizi takip edin: instagram.com/firma')).toMatch(/sosyal/);
    expect(gonderiKuralIhlali('Hesabımız @kahveduragi üzerinden duyurular')).toMatch(/sosyal/);
    expect(gonderiKuralIhlali('Detaylar www.firma.com.tr adresinde')).toMatch(/web adresi/);
  });
});

describe('gonderiKuralIhlali — yanlis pozitif yok', () => {
  it('hizmet adi olarak sosyal medya, fiyat, tarih ve bitisik nokta serbest', () => {
    expect(gonderiKuralIhlali('Instagram reklam yönetimi hizmetimiz bu ay 1.250 TL.')).toBeNull();
    expect(gonderiKuralIhlali('27.10.2026 tarihinde açılış! ürün.Ai destekli sistemimiz hazır.')).toBeNull();
  });
});

describe('yanitTemizle', () => {
  it('tirnak ve markdown temizler', () => {
    expect(yanitTemizle('"**Teşekkürler** Ayşe Hanım!"')).toBe('Teşekkürler Ayşe Hanım!');
  });
});
