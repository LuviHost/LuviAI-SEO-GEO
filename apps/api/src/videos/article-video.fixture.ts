/**
 * RanksUp Video testleri icin ornek makale (DB satiri bicimi). Metin kurgusaldir; sayilar
 * koruyucu testleri icin bilerek secildi: "%30", "90 gun", "2026" makalede GECER, baska sayi gecmez.
 */
export const FIXTURE_SITE = { id: 'cmsitevideo0000000000001', url: 'https://www.ornekklinik.com', name: 'Örnek Klinik' };

export const FIXTURE_BODY_MD = `---
title: "Fatura finansmanı nedir?"
---
# Fatura finansmanı nedir?

Fatura finansmanı, vadeli alacağı beklemeden nakde çevirmenin yoludur. İşletmeler bu yolla nakit akışını düzenler.

## Fatura finansmanı nasıl çalışır?

Kesilen fatura bir finansman kuruluşuna devredilir. Kuruluş tutarın bir kısmını hemen öder.

- Fatura kuruluşa sunulur
- Ön ödeme hesaba geçer

## Hangi işletmeler için uygundur?

Vadesi 90 gün olan alacakları bulunan işletmeler için uygundur. Özellikle toptan satış yapan firmalar sık kullanır.

## Maliyeti nasıl hesaplanır?

Maliyet vade ve risk düzeyine göre belirlenir. 2026 yılında bazı kuruluşlar ön ödeme oranını %30 seviyesinde tuttu.

## Sıkça Sorulan Sorular

### Kredi notu etkilenir mi?

Hayır, işlem borç olarak görünmez.
`;

export const FIXTURE_ARTICLE_ROW = {
  id: 'cmarticlevideo00000000001',
  title: 'Fatura finansmanı nedir?',
  status: 'PUBLISHED',
  language: 'tr',
  category: 'Finans Rehberi',
  metaDescription: 'Fatura finansmanı alacağı beklemeden nakde çevirmenin yoludur.',
  bodyMd: FIXTURE_BODY_MD,
  bodyHtml: null,
  publishedTo: [
    { targetId: 'cmtargetftp000000000001', ok: true, externalUrl: 'ftp://ornekklinik.com/public_html/blog/fatura-finansmani-nedir.html' },
    { targetId: 'cmtargetwp0000000000001', ok: true, externalUrl: 'https://www.ornekklinik.com/blog/fatura-finansmani-nedir/' },
  ],
};
