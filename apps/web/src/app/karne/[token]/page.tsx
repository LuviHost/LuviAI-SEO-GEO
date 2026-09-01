import { notFound } from 'next/navigation';

/**
 * Ucretsiz AI gorunurluk karnesinin PAYLASILABILIR sayfasi.
 *
 * NEDEN sunucuda cekip ham HTML basiyoruz: rapor `karne-html.ts` tarafindan tek dosya olarak
 * (inline CSS, A4 print kurallari) uretiliyor; burada yeniden tasarlanmasi hem ikilik yaratir hem
 * de yazdirma duzenini bozar. Sayfa yalniz token bilenle paylasilir ve arama motorlarina kapalidir.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'AI görünürlük karnesi',
  robots: { index: false, follow: false },
};

async function karneGetir(token: string): Promise<string | null> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/public/karne/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export default async function KarnePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const html = await karneGetir(token);
  if (!html) notFound();

  // Rapor kendi <html>/<style>'ini tasiyor; iframe icinde izole edilir ki sayfa CSS'i bozmasin.
  return (
    <iframe
      title="AI görünürlük karnesi"
      srcDoc={html}
      style={{ border: 0, width: '100%', height: '100vh', display: 'block' }}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    />
  );
}
