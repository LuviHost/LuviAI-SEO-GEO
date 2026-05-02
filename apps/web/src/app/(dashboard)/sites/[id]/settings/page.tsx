'use client';
import { useSiteContext } from '../site-context';
import { Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400 grid place-items-center">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Ayarlar</h2>
          <p className="text-sm text-muted-foreground">Site genel konfigürasyonu, dil, niş, agent re-run.</p>
        </div>
      </div>
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Site Adı</div>
          <div className="text-base font-medium mt-1">{site.name}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">URL</div>
          <div className="text-base font-mono text-muted-foreground mt-1">{site.url}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Niş</div>
          <div className="text-base mt-1">{site.niche ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dil</div>
          <div className="text-base mt-1">{site.language ?? 'tr'}</div>
        </div>
        <div className="pt-3 text-sm text-muted-foreground">
          Daha kapsamlı ayar için <Link href={`/sites/${site.id}/connections`} className="text-brand hover:underline">Bağlantılar</Link> veya <Link href={`/sites/${site.id}/autopilot`} className="text-brand hover:underline">Otomatik Akış</Link> sayfalarına bak.
        </div>
      </div>
    </div>
  );
}
