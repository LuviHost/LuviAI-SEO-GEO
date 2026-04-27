export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-slate-900 text-white p-4">
        <h2 className="font-bold mb-6 text-xl">LuviAI</h2>
        <nav className="space-y-2 text-sm">
          <a href="/dashboard" className="block hover:text-brand-light py-2 px-3 rounded hover:bg-slate-800">📊 Sites</a>
          <a href="/onboarding" className="block hover:text-brand-light py-2 px-3 rounded hover:bg-slate-800">➕ Yeni Site</a>
          <a href="/billing" className="block hover:text-brand-light py-2 px-3 rounded hover:bg-slate-800">💳 Abonelik</a>
        </nav>
        <div className="absolute bottom-4 text-xs text-slate-400">
          v0.2 (Faz 2 Beta)
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
