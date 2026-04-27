export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-brand to-brand-light text-white">
      <h1 className="text-5xl font-bold mb-4">LuviAI</h1>
      <p className="text-xl max-w-2xl text-center mb-8">
        Sitenin URL'ini ver, GSC bağla, AI haftalık 5-50 makale üretip yayınlasın.
      </p>
      <div className="flex gap-4">
        <a href="/login" className="px-6 py-3 bg-white text-brand rounded-lg font-semibold hover:bg-brand-light/10">
          Erken Erişime Katıl
        </a>
        <a href="/pricing" className="px-6 py-3 border-2 border-white text-white rounded-lg font-semibold hover:bg-white/10">
          Fiyatlar
        </a>
      </div>
      <p className="mt-12 text-sm text-white/70">
        🟢 Faz 1 Beta — Şu anda davet üzeri kayıt
      </p>
    </main>
  );
}
