'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Users, Settings, Mail, Globe, Award, FileText, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric';
import { AsyncState } from '@/components/ui/async-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/empty-state';

export default function AgencyDashboardPage() {
  const [tab, setTab] = useState<'clients' | 'whitelabel' | 'invite'>('clients');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAgencyOverview();
      setData(res);
    } catch (err: any) {
      setError(err);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const mrr = Number(data?.totals?.monthlyRevenueTRY ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajans paneli"
        description={data ? `${data.agencyName} · ${data.totals.clients} müşteri` : 'Müşterilerini, sitelerini ve markalı paneli tek yerden yönet.'}
      />

      <AsyncState
        loading={loading}
        error={error}
        onRetry={load}
        skeleton={<><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div><div className="h-48 animate-pulse rounded-lg bg-muted" /></>}
      >
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard icon={Users} label="Müşteri" value={data.totals.clients} />
              <MetricCard icon={Globe} label="Toplam site" value={data.totals.sites} />
              <MetricCard icon={FileText} label="Son 30 günde yayınlanan" value={data.totals.articlesPublished30d} />
              <MetricCard icon={Award} label="Aylık gelir (MRR)" value={mrr} prefix="₺" format={{ maximumFractionDigits: 0 }} />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
              <TabsList>
                <TabsTrigger value="clients"><Users className="h-3.5 w-3.5" aria-hidden /> Müşteriler</TabsTrigger>
                <TabsTrigger value="invite"><Mail className="h-3.5 w-3.5" aria-hidden /> Davet et</TabsTrigger>
                <TabsTrigger value="whitelabel"><Settings className="h-3.5 w-3.5" aria-hidden /> Markalı panel</TabsTrigger>
              </TabsList>
              <TabsContent value="clients" className="mt-4"><ClientsTab clients={data.clients} onInvite={() => setTab('invite')} /></TabsContent>
              <TabsContent value="invite" className="mt-4"><InviteTab onInvited={load} /></TabsContent>
              <TabsContent value="whitelabel" className="mt-4"><WhitelabelTab whitelabel={data.whitelabel} onSaved={load} /></TabsContent>
            </Tabs>
          </>
        )}
      </AsyncState>
    </div>
  );
}

function ClientsTab({ clients, onInvite }: { clients: any[]; onInvite: () => void }) {
  if (clients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Henüz müşterin yok"
        description="Müşterine davet linki gönder; linkten kayıt olan hesap otomatik olarak senin ajansına bağlanır."
        primary={{ label: 'Müşteri davet et', onClick: onInvite }}
      />
    );
  }
  return (
    <div className="space-y-2">
      {clients.map((c) => (
        <div key={c.userId} className="rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-sm">{c.name ?? c.email}</p>
              <p className="text-label text-muted-foreground">{c.email} · {new Date(c.createdAt).toLocaleDateString('tr-TR')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{c.plan}</Badge>
              {c.geoScoreAvg !== null && (
                <Badge variant={c.geoScoreAvg >= 70 ? 'success' : c.geoScoreAvg >= 50 ? 'warning' : 'danger'}>
                  GEO: {c.geoScoreAvg}
                </Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div><span className="text-muted-foreground">Site:</span> <strong>{c.sitesActive}/{c.sitesCount}</strong></div>
            <div><span className="text-muted-foreground">Sorun:</span> <strong className={c.issuesCount > 5 ? 'text-danger' : ''}>{c.issuesCount}</strong></div>
            <div><span className="text-muted-foreground">Plan:</span> <strong>{c.plan}</strong></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteTab({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const invite = async () => {
    if (!email.includes('@')) { toast.error('Geçerli bir e-posta adresi yaz'); return; }
    setLoading(true);
    try {
      const r = await api.inviteAgencyClient({ email, name: name || undefined });
      setInviteUrl(r.inviteUrl);
      toast.success('Davet linki üretildi');
      onInvited();
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">Müşterine bir davet linki gönder. Linkten kayıt olunca hesap otomatik olarak senin ajansına bağlanır.</p>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="musteri@firma.com" aria-label="Müşteri e-postası" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad (isteğe bağlı)" aria-label="Müşteri adı" />
        <Button onClick={invite} disabled={loading} className="w-full">{loading ? 'Oluşturuluyor…' : 'Davet linki oluştur'}</Button>
      </CardContent></Card>
      {inviteUrl && (
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Davet linki <span className="font-normal text-muted-foreground">· 14 gün geçerli</span></p>
          <Input value={inviteUrl} readOnly className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} aria-label="Davet linki" />
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('Link kopyalandı'); }}><Copy className="h-4 w-4" aria-hidden /> Linki kopyala</Button>
        </CardContent></Card>
      )}
    </div>
  );
}

function WhitelabelTab({ whitelabel, onSaved }: { whitelabel: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    enabled: whitelabel?.enabled ?? false,
    brandName: whitelabel?.brandName ?? '',
    logoUrl: whitelabel?.logoUrl ?? '',
    primaryColor: whitelabel?.primaryColor ?? '#6c5ce7',
    domain: whitelabel?.domain ?? '',
    emailFrom: whitelabel?.emailFrom ?? '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateWhitelabel(form);
      toast.success('Markalı panel ayarları kaydedildi');
      onSaved();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 max-w-2xl">
      <Card><CardContent className="p-4 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="mt-1" />
          <div>
            <p className="text-sm font-semibold">Markalı paneli aç</p>
            <p className="text-xs text-muted-foreground">Kendi alan adından giriş yapan müşterilerin RanksUp yerine senin markanı görür.</p>
          </div>
        </label>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium">Marka adı</span>
          <Input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} className="mt-1" placeholder="Webmasters Ajansı" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Logo adresi (URL)</span>
          <Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} className="mt-1" placeholder="https://ajansadi.com.tr/logo.png" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Marka rengi (hex)</span>
          <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="mt-1 font-mono" placeholder="#6c5ce7" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Alan adı (CNAME)</span>
          <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className="mt-1" placeholder="ai.ajansadi.com.tr" />
          <p className="text-label text-muted-foreground mt-1">Alan adının CNAME kaydını ranksup.ai'ye yönlendir.</p>
        </label>
        <label className="block">
          <span className="text-xs font-medium">Gönderen e-posta</span>
          <Input value={form.emailFrom} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} className="mt-1" placeholder="noreply@ajansadi.com.tr" />
        </label>

        <Button onClick={save} disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      </CardContent></Card>
    </div>
  );
}
