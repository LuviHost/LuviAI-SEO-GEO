import type { Metadata } from 'next';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { GbpKarne } from '@/components/landing/gbp-karne';
import { VitrinHero, VitrinSection } from '@/components/vitrin/vitrin-page';
import { SITE_URL } from '@/lib/page-updated';

/**
 * /google-isletme-karnesi — ucretsiz Google Isletme Profili karnesi (sunucu bileseni; form istemcide).
 * Sunucu: apps/api/src/gbp (public/gbp/ara + public/gbp/karne). Sonuc saklanmaz.
 */
const TITLE = 'Ücretsiz Google İşletme Karnesi | RanksUp';
const DESCRIPTION =
  'Google İşletme Profilinizi ücretsiz denetleyin: kategori, çalışma saatleri, telefon, web sitesi, yorumlar, puan, fotoğraflar ve ad kuralı. 100 üzerinden puan ve yapılacaklar listesi.';
const URL = `${SITE_URL}/google-isletme-karnesi`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'RanksUp',
    url: URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: `${SITE_URL}/og-image.png?v=2`, width: 1200, height: 630, alt: 'RanksUp Google İşletme Karnesi' }],
  },
};

const KONTROLLER = [
  ['İşletme durumu', 'Profil açık mı, geçici ya da kalıcı kapalı mı görünüyor.'],
  ['Birincil kategori', 'Ana hizmetinizi dar ve doğru tanımlıyor mu.'],
  ['Çalışma saatleri', 'Haftanın her günü için saat girilmiş mi.'],
  ['Web sitesi ve telefon', 'Profilde var mı; müşteriyi doğru yere götürüyor mu.'],
  ['Adres', 'Profildeki il ve ilçe bilgisi.'],
  ['Yorum sayısı ve puan', 'Yeni müşterinin güvenini etkileyen iki sinyal.'],
  ['Fotoğraflar', 'Profilde yeterli sayıda fotoğraf var mı (öneri: dış cephe, iç mekân, ekip ve ürün).'],
  ['İşletme adı kuralı', 'Ada eklenmiş şehir, slogan ya da iletişim bilgisi (askıya alma riski).'],
] as const;

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik, hemen altinda arac (ana sayfadaki alan adi
 * testi gibi sayfanin birincil eylemi), sonra solda yapiskan baslikli kontrol listesi.
 */
export default function GoogleIsletmeKarnesiPage() {
  return (
    <>
      <VitrinHero
        rail="Ücretsiz araç"
        a="Google İşletme"
        b="Karnesi"
        lead={
          <p>
            Google Haritalar’daki işletme profilinizi saniyeler içinde denetleyin. Eksik bilgileri, yorum ve puan durumunu
            ve Google kurallarına aykırı olabilecek noktaları 100 üzerinden puanla, ne yapmanız gerektiğiyle birlikte görün.
          </p>
        }
      >
        <PageUpdatedLine path="/google-isletme-karnesi" className="mt-4 font-mono" fixedLocale="tr" />

        <div className="mt-10 max-w-3xl">
          <GbpKarne />
        </div>
      </VitrinHero>

      <VitrinSection title="Karnede neler kontrol ediliyor?">
        <ul className="border-t border-border">
          {KONTROLLER.map(([baslik, aciklama]) => (
            <li key={baslik} className="grid gap-1.5 border-b border-border py-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6">
              <p className="text-base font-medium">{baslik}</p>
              <p className="text-sm leading-[1.8] text-muted-foreground">{aciklama}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-2xl text-sm leading-[1.8] text-muted-foreground">
          Profil bilgisinin eksiksiz ve doğru olması, yorumlar ve tutarlı iletişim bilgisi Google’ın yerel sonuçlarda
          belirttiği ilgililik ve öne çıkma etkenlerine doğrudan girer; yapay zekâ asistanları da yerel öneri yaparken
          bu bilgileri kullanır. Karne Google Haritalar’daki herkese açık bilgilerden anlık hesaplanır, kaydedilmez.
          Günde birkaç ücretsiz karne alabilirsiniz.
        </p>
        <p className="v-rail mt-4">Veriler: Google Haritalar</p>
      </VitrinSection>
    </>
  );
}
