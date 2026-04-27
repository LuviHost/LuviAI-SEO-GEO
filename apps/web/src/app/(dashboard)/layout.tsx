export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-slate-900 text-white p-4">
        <h2 className="font-bold mb-6">LuviAI</h2>
        <nav className="space-y-2 text-sm">
          <a href="/dashboard" className="block hover:text-brand-light">Sites</a>
          <a href="/dashboard/billing" className="block hover:text-brand-light">Billing</a>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
