'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Plus } from 'lucide-react';

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

  useEffect(() => {
    if (status === 'loading') return;
    Promise.all([
      api.listSites().catch(() => []),
      api.getMyDashboard().catch(() => null),
    ])
      .then(([s, m]) => {
        setSites(s);
        setMe(m);
      })
      .finally(() => setLoading(false));
  }, [status]);

  const trialLeft = me?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(me.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

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
            label={me.subscriptionStatus === 'TRIAL' ? `Trial — ${trialLeft ?? 0} gün` : (me.plan ?? 'Plan')}
            value={me.subscriptionStatus === 'TRIAL' ? '14 gün' : me.plan ?? '-'}
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
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/sites/${s.id}`}>Aç →</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
