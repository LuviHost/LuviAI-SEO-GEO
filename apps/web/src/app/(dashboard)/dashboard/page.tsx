'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Plus, Trash2, AlertTriangle } from 'lucide-react';

const STATUS_VARIANT: Record<string, any> = {
  ONBOARDING: 'warning',
  AUDIT_PENDING: 'secondary',
  AUDIT_COMPLETE: 'default',
  ACTIVE: 'success',
  PAUSED: 'outline',
  ERROR: 'destructive',
};

export default function DashboardPage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const [sites, setSites] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    return Promise.all([
      api.listSites().catch(() => []),
      api.getMyDashboard().catch(() => null),
    ]).then(([s, m]) => {
      setSites(s);
      setMe(m);
    });
  };

  useEffect(() => {
    if (status === 'loading') return;
    reload().finally(() => setLoading(false));
  }, [status]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSite(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" ve tüm bağlı kayıtları silindi`);
      setDeleteTarget(null);
      await reload();
    } catch (err: any) {
      toast.error(err.message ?? 'Silme başarısız');
    } finally {
      setDeleting(false);
    }
  };

  const isTrial = me?.subscriptionStatus === 'TRIAL';
  const articlesUsed = me?.articlesUsedThisMonth ?? 0;
  const freeArticleRemaining = isTrial ? Math.max(0, 1 - articlesUsed) : null;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
          {session?.user?.name && (
            <p className="text-sm text-muted-foreground mt-1">
              Hoş geldin, <strong>{session.user.name}</strong>
            </p>
          )}
        </div>
        <Button asChild>
          <Link href="/onboarding"><Plus className="h-4 w-4 mr-2" />{t('dashboard.new_site')}</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : me ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Sitelerim" value={me.sitesCount ?? 0} />
          <Stat label="Yayınlanan makale" value={me.articlesPublished ?? 0} />
          <Stat label="Bu ay üretilen" value={me.articlesUsedThisMonth ?? 0} />
          <Stat
            label={isTrial ? 'Ücretsiz makale hakkı' : (me.plan ?? 'Plan')}
            value={isTrial ? `${freeArticleRemaining}/1 kaldı` : me.plan ?? '-'}
            variant="brand"
            stringValue
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{t('dashboard.sites')}</h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : sites.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground mb-4">{t('dashboard.empty')}</p>
              <Button asChild variant="outline">
                <Link href="/onboarding">{t('dashboard.add_first')}</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {sites.map((s) => (
                <div key={s.id} className="p-5 flex items-center justify-between hover:bg-muted/50 transition-colors gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="font-semibold truncate">{s.name}</h3>
                      <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1"
                    >
                      {s.url}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {s.niche && (
                      <span className="text-xs text-muted-foreground ml-3">· {s.niche}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/sites/${s.id}`}>Aç →</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(s)}
                      title="Siteyi sil"
                      className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {deleteTarget && (
        <DeleteSiteDialog
          site={deleteTarget}
          deleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function DeleteSiteDialog({
  site, deleting, onCancel, onConfirm,
}: {
  site: any;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const expected = site.name;
  const canDelete = typed.trim() === expected && !deleting;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-red-500/30 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-red-500/10 grid place-items-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Siteyi sil</h3>
            <p className="text-sm text-muted-foreground mt-1">
              <strong>{site.name}</strong> ile birlikte aşağıdakilerin tamamı silinir, geri alınamaz:
            </p>
          </div>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 mb-4 ml-13 pl-13" style={{ paddingLeft: '52px' }}>
          <li>• Brain (rakipler, persona, SEO stratejisi)</li>
          <li>• Tüm denetim (audit) kayıtları</li>
          <li>• Topic queue + üretilmiş & yayınlanmış makaleler</li>
          <li>• Sosyal kanal bağlantıları (X, LinkedIn vb.) + post takvimi</li>
          <li>• Yayın hedefleri (FTP, WordPress, GitHub vb.)</li>
          <li>• Analitik snapshot'lar + iş kuyruğu kayıtları</li>
        </ul>
        <div className="space-y-2 mb-5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Onaylamak için site adını yaz: <span className="text-red-500 font-mono">{expected}</span>
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            disabled={deleting}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-red-500"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            İptal
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={!canDelete}
          >
            {deleting ? 'Siliniyor…' : 'Kalıcı olarak sil'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  variant = 'default',
  stringValue = false,
}: {
  label: string;
  value: number | string;
  variant?: string;
  stringValue?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className={`${stringValue ? 'text-2xl' : 'text-3xl'} font-bold ${variant === 'destructive' ? 'text-red-500' : 'text-brand'}`}>
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
