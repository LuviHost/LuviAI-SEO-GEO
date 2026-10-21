import { staticFile } from 'remotion';
import type { ArticleShortProps } from '../article-short/ArticleShort';
import type { SiteIntroProps } from '../promo/SiteIntro';
import type { ProductShortProps } from '../promo/ProductShort';

/**
 * Duyuru filmindeki ornek videolarin props'u — UYDURMA DEGIL. RanksUp'in kendi referans sitesi
 * kobipratik.com icin 21.10.2026'da sunucu hattinin (VideoRenderService.process) urettigi
 * scriptText + marka sonucu, harfi harfine:
 *   - makale: /pratik-kobi-rehberi/fatura-finansmani-nedir (yayindaki makale)
 *   - site:   anasayfa (h1, kurum aciklamasi, hizmet basliklari)
 *   - urun:   /pos/sorgulama (sitenin kendi hizmet sayfasi; yapisal fiyat yok -> fiyat gosterilmez,
 *             urun gorseli yok -> marka karosu)
 * Marka: ad "KOBİ Pratik", tema rengi #069093 (css-degiskeni:--color-primary-default), logo
 * https://www.kobipratik.com/logo.svg -> sunucudaki gibi 256 px PNG (public/launch/kobipratik-logo.png).
 * Metin stratejisi o calistirmada "extractive" (sayfanin kendi cumleleri). Ekranda "Örnek çıktı"
 * etiketiyle gosterilir. Sablonlar ayni bilesenler (ArticleShort, SiteIntro/Wide, ProductShort).
 */

const brand = { name: 'KOBİ Pratik', domain: 'kobipratik.com', primary: '#069093', logoUrl: staticFile('launch/kobipratik-logo.png') };

export const ARTICLE_URL = 'kobipratik.com/pratik-kobi-rehberi/fatura-finansmani-nedir';
export const SITE_URL = 'kobipratik.com';
export const PRODUCT_URL = 'kobipratik.com/pos/sorgulama';

export const articleExample: ArticleShortProps = {
  hook: 'Fatura Finansmanı Nedir?',
  hookSub: 'Fatura karşılığı kredi: Vadeli faturaların teminat gösterilerek nakde dönüştürülmesi.',
  kicker: '',
  points: [
    { title: 'Kimler Fatura Karşılığı Kredi Kullanabilir?', detail: 'Faturanın kesildiği alıcı firmanın ticari sicili güçlü olmalıdır.' },
    { title: 'Bankalar Faturayı Nasıl Değerlendirir?', detail: 'Fatura vadesi (çoğunlukla 30–120 gün)' },
    { title: 'Dikkat Edilmesi Gereken Riskler', detail: 'Alıcı firma ödeme yapmazsa sorumluluk satıcıya dönebilir' },
  ],
  cta: { label: 'Tamamını oku', domain: 'kobipratik.com', url: 'https://www.kobipratik.com/pratik-kobi-rehberi/fatura-finansmani-nedir' },
  brand,
  sourcePath: 'kobipratik.com/pratik-kobi-rehberi',
  muted: true,
  watermark: true,
};

export const siteExample: SiteIntroProps = {
  hook: 'KOBİ Kredisi, POS ve Ticari Kart Tekliflerini Karşılaştırın',
  hookSub: "KOBİ'ler ve esnaf için ticari kredi, POS ve ticari kredi kartı karşılaştırma platformu",
  kicker: '',
  points: [{ title: 'Ticari Krediler' }, { title: 'POS Çözümleri' }, { title: 'Ticari Kredi Kartları' }],
  cta: { label: 'Sitemizi ziyaret edin', domain: 'kobipratik.com', url: 'https://www.kobipratik.com/' },
  brand,
  muted: true,
  watermark: true,
};

export const productExample: ProductShortProps = {
  hook: 'POS Çözümleri',
  hookSub: 'Bankaların ve ödeme kuruluşlarının POS çözümlerini karşılaştırın; işletmeniz için en uygun komisyon oranını bulun.',
  kicker: '',
  points: [{ title: 'Yazar Kasa (ÖKC) POS' }, { title: 'Mobil / Taşınabilir POS' }, { title: 'Cep POS' }],
  cta: { label: 'Hemen inceleyin', domain: 'kobipratik.com/pos/sorgulama', url: 'https://www.kobipratik.com/pos/sorgulama' },
  brand,
  image: '',
  price: '',
  muted: true,
  watermark: true,
};
