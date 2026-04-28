'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users as UsersIcon, Globe2, FileText, Activity, CreditCard, TrendingUp, AlertCircle, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminOverviewPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminOverview().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-muted-foreground">Veri yüklenemedi.</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Genel Bakış</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform metrikleri — gerçek zamanlı
        </p>
      </div>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Gelir</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4" /> Bu ay (PAID)
              </div>
              <div className="text-3xl font-bold text-brand mt-2">
                ₺{Number(data.revenueThisMonth ?? 0).toLocaleString('tr-TR')}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.paymentsThisMonth ?? 0} ödeme
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CreditCard className="h-4 w-4" /> Son 30 gün gelir
              </div>
              <div className="text-3xl font-bold mt-2">
                ₺{Number(data.revenueLast30 ?? 0).toLocaleString('tr-TR')}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-4 w-4" /> Bekleyen fatura
              </div>
              <div className="text-3xl font-bold mt-2">{data.pendingInvoices ?? 0}</div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Kullanıcılar</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<UsersIcon />} label="Toplam kullanıcı" value={data.users} />
          <Stat icon={<Activity />} label="Aktif abonelik" value={data.activeSubs} variant="success" />
          <Stat icon={<Clock />} label="Trial üyeler" value={data.trialUsers} />
          <Stat icon={<TrendingUp />} label="Son 30g yeni" value={data.newUsersLast30} variant="brand" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">İçerik</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat icon={<Globe2 />} label="Kayıtlı site" value={data.sites} />
          <Stat icon={<FileText />} label="Yayınlanan makale" value={data.publishedArticles} />
          <Stat
            icon={<AlertCircle />}
            label="Hatalı job"
            value={data.failedJobs}
            variant={data.failedJobs > 0 ? 'destructive' : 'default'}
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <QuickLink href="/admin/users" label="Kullanıcıları yönet →" />
        <QuickLink href="/admin/invoices" label="Faturalar →" />
        <QuickLink href="/admin/sites" label="Tüm siteler →" />
        <QuickLink href="/admin/jobs" label="Hatalı işler →" />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  variant = 'default',
}: {
  icon?: React.ReactNode;
  label: string;
  value: any;
  variant?: 'default' | 'brand' | 'destructive' | 'success';
}) {
  const colorClass =
    variant === 'destructive'
      ? 'text-red-500'
      : variant === 'success'
        ? 'text-green-500'
        : variant === 'brand'
          ? 'text-brand'
          : '';
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`text-3xl font-bold mt-2 ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href as any}
      className="text-sm font-medium text-brand hover:underline px-3 py-2 rounded-md bg-brand/5 hover:bg-brand/10"
    >
      {label}
    </Link>
  );
}
