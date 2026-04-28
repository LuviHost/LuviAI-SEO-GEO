'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users as UsersIcon, Globe2, FileText, Activity, CreditCard, TrendingUp, AlertCircle, Clock, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

      <EmailTestCard />
    </div>
  );
}

const TEMPLATE_OPTIONS = [
  { value: 'welcome_day0', label: 'Welcome Day 0 (kayıt)' },
  { value: 'welcome_day1', label: 'Welcome Day 1' },
  { value: 'welcome_day3', label: 'Welcome Day 3 (GSC reminder)' },
  { value: 'welcome_day7', label: 'Welcome Day 7 (feedback)' },
  { value: 'first_article_published', label: 'First Article Published' },
  { value: 'article_ready', label: 'Article Ready' },
  { value: 'weekly_report', label: 'Weekly Report' },
  { value: 'plan_upgraded', label: 'Plan Upgraded' },
  { value: 'payment_failed', label: 'Payment Failed' },
];

function EmailTestCard() {
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('first_article_published');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; mode: string; resendId?: string } | null>(null);

  const send = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const res = await api.sendAdminEmailTest({ to, template, name: name || undefined });
      setLast(res);
      if (res.ok) {
        toast.success(
          res.mode === 'resend'
            ? `Mail gönderildi (${res.resendId ?? 'no-id'})`
            : 'Mail gönderildi (log-only — RESEND_API_KEY yok)',
        );
      } else {
        toast.error('Mail gönderilemedi — sunucu loglarını kontrol et');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4 text-amber-600" /> Email Test (Resend)
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Resend.com entegrasyonunu canlıda test et. Seçtiğin template'i belirttiğin adrese gönderir.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Alıcı email</label>
            <Input
              type="email"
              placeholder="test@email.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">İsim (opsiyonel)</label>
            <Input
              placeholder="Test Kullanıcısı"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Template</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full bg-card border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            {TEMPLATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          {last ? (
            <div className="text-xs text-muted-foreground">
              Son gönderim: <strong>{last.mode}</strong>
              {last.resendId ? ` · id ${last.resendId}` : ''}
            </div>
          ) : <span />}
          <Button onClick={send} disabled={busy || !to}>
            {busy ? 'Gönderiliyor…' : 'Test Maili Gönder'}
          </Button>
        </div>
      </CardContent>
    </Card>
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
