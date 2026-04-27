'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  const [sites, setSites] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.listSites().catch(() => []),
      api.getAdminOverview().catch(() => null),
    ])
      .then(([s, o]) => {
        setSites(s);
        setOverview(o);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <Button asChild>
          <Link href="/onboarding"><Plus className="h-4 w-4 mr-2" />{t('dashboard.new_site')}</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Sites" value={overview.sites} />
          <Stat label="Users" value={overview.users} />
          <Stat label="Published" value={overview.publishedArticles} />
          <Stat label="Failed Jobs" value={overview.failedJobs} variant={overview.failedJobs > 0 ? 'destructive' : 'default'} />
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

function Stat({ label, value, variant = 'default' }: { label: string; value: number; variant?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className={`text-3xl font-bold ${variant === 'destructive' ? 'text-red-500' : 'text-brand'}`}>
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
