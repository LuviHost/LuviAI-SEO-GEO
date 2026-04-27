import Link from 'next/link';

export default function FailurePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50">
      <div className="max-w-md text-center bg-white p-12 rounded-2xl shadow">
        <div className="text-6xl mb-4">❌</div>
        <h1 className="text-3xl font-bold mb-2">Ödeme Başarısız</h1>
        <p className="text-slate-600 mb-6">
          Bir sorun oluştu — kart bilgilerinizi kontrol edip tekrar deneyebilirsiniz.
          Sorun devam ederse <a href="mailto:destek@luvihost.com" className="text-brand underline">destek@luvihost.com</a> ile iletişime geçin.
        </p>
        <Link
          href="/pricing"
          className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold"
        >
          Tekrar Dene
        </Link>
      </div>
    </main>
  );
}
