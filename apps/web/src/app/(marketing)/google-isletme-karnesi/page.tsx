import type { Metadata } from 'next';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { GbpKarne } from '@/components/landing/gbp-karne';
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

export default function GoogleIsletmeKarnesiPage() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 top-0 h-96 w-96 rounded-full bg-brand-500/8 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-8">
          <p className="mb-2 text-xs font-medium text-brand-600">Ücretsiz araç</p>
          <h1 className="mb-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Google İşletme Karnesi</h1>
          <p className="leading-relaxed text-muted-foreground">
            Google Haritalar’daki işletme profilinizi saniyeler içinde denetleyin. Eksik bilgileri, yorum ve puan durumunu
            ve Google kurallarına aykırı olabilecek noktaları 100 üzerinden puanla, ne yapmanız gerektiğiyle birlikte görün.
          </p>
          <PageUpdatedLine path="/google-isletme-karnesi" className="mt-3" fixedLocale="tr" />
        </header>

        <GbpKarne />

        <section className="mt-12 space-y-4">
          <h2 className="text-xl font-bold">Karnede neler kontrol ediliyor?</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {KONTROLLER.map(([baslik, aciklama]) => (
              <li key={baslik} className="rounded-xl border bg-card p-4">
                <p className="font-semibold">{baslik}</p>
                <p className="text-sm text-muted-foreground">{aciklama}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Profil bilgisinin eksiksiz ve doğru olması, yorumlar ve tutarlı iletişim bilgisi Google’ın yerel sonuçlarda
            belirttiği ilgililik ve öne çıkma etkenlerine doğrudan girer; yapay zekâ asistanları da yerel öneri yaparken
            bu bilgileri kullanır. Karne Google Haritalar’daki herkese açık bilgilerden anlık hesaplanır, kaydedilmez.
            Günde birkaç ücretsiz karne alabilirsiniz.
          </p>
          <p className="text-label text-muted-foreground">Veriler: Google Haritalar</p>
        </section>
      </div>
    </div>
  );
}
