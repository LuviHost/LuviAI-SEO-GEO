import Link from 'next/link';

export default function SuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-brand/5">
      <div className="max-w-md text-center bg-white p-12 rounded-2xl shadow">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-2">Ödeme Başarılı!</h1>
        <p className="text-slate-600 mb-6">
          Aboneliğiniz aktif edildi. Dashboard'a giderek hemen başlayabilirsiniz.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold"
        >
          Dashboard'a Git
        </Link>
      </div>
    </main>
  );
}
