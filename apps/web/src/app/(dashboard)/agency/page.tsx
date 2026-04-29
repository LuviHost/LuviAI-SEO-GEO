'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Users, Plus, Settings, Mail, Globe, Award, FileText, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function AgencyDashboardPage() {
  const [tab, setTab] = useState<'clients' | 'whitelabel' | 'invite'>('clients');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAgencyOverview();
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-sm text-muted-foreground p-12 text-center">Yükleniyor…</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Building2 className="h-7 w-7 text-brand" /> Ajans Paneli</h1>
        <p className="text-sm text-muted-foreground mt-1">{data.agencyName} · {data.totals.clients} müşteri yönetiyorsun</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><Users className="h-4 w-4 text-brand mb-2" /><div className="text-2xl font-bold">{data.totals.clients}</div><p className="text-xs text-muted-foreground">Müşteri</p></CardContent></Card>
        <Card><CardContent className="p-4"><Globe className="h-4 w-4 text-brand mb-2" /><div className="text-2xl font-bold">{data.totals.sites}</div><p className="text-xs text-muted-foreground">Toplam Site</p></CardContent></Card>
        <Card><CardContent className="p-4"><FileText className="h-4 w-4 text-brand mb-2" /><div className="text-2xl font-bold">{data.totals.articlesPublished30d}</div><p className="text-xs text-muted-foreground">30g Makale</p></CardContent></Card>
        <Card><CardContent className="p-4"><Award className="h-4 w-4 text-brand mb-2" /><div className="text-2xl font-bold">{(data.totals.monthlyRevenueTRY / 1000).toFixed(1)}K ₺</div><p className="text-xs text-muted-foreground">MRR</p></CardContent></Card>
      </div>

      <div className="inline-flex border rounded-md overflow-hidden">
        {([
          ['clients', 'Müşteriler', <Users key="c" className="h-3 w-3" />],
          ['invite', 'Davet Et', <Mail key="i" className="h-3 w-3" />],
          ['whitelabel', 'Whitelabel', <Settings key="w" className="h-3 w-3" />],
        ] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id as any)} className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${tab === id ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'clients' && <ClientsTab clients={data.clients} />}
      {tab === 'invite' && <InviteTab onInvited={load} />}
      {tab === 'whitelabel' && <WhitelabelTab whitelabel={data.whitelabel} onSaved={load} />}
    </div>
  );
}

function ClientsTab({ clients }: { clients: any[] }) {
  if (clients.length === 0) return <div className="p-8 text-center text-sm text-muted-foreground">Henüz müşterin yok. "Davet Et" sekmesinden client ekleyebilirsin.</div>;
  return (
    <div className="space-y-2">
      {clients.map((c) => (
        <div key={c.userId} className="rounded-md border p-3 hover:border-brand/40">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-sm">{c.name ?? c.email}</p>
              <p className="text-[11px] text-muted-foreground">{c.email} · {new Date(c.createdAt).toLocaleDateString('tr-TR')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{c.plan}</Badge>
              {c.geoScoreAvg !== null && (
                <Badge className={c.geoScoreAvg >= 70 ? 'bg-green-500' : c.geoScoreAvg >= 50 ? 'bg-yellow-500' : 'bg-red-500'}>
                  GEO: {c.geoScoreAvg}
                </Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div><span className="text-muted-foreground">Site:</span> <strong>{c.sitesActive}/{c.sitesCount}</strong></div>
            <div><span className="text-muted-foreground">Sorun:</span> <strong className={c.issuesCount > 5 ? 'text-red-500' : ''}>{c.issuesCount}</strong></div>
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
    if (!email.includes('@')) { toast.error('Geçerli email girin'); return; }
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
        <p className="text-xs text-muted-foreground">Müşterine bir davet linki gönder. Link'ten kayıt olunca otomatik senin altına bağlanır.</p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="musteri@email.com" className="w-full px-3 py-2 border rounded text-sm bg-background" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="İsim (opsiyonel)" className="w-full px-3 py-2 border rounded text-sm bg-background" />
        <Button onClick={invite} disabled={loading} className="w-full">{loading ? 'Üretiliyor…' : 'Davet Linki Üret'}</Button>
      </CardContent></Card>
      {inviteUrl && (
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold">📨 Davet linki (14 gün geçerli):</p>
          <input value={inviteUrl} readOnly className="w-full px-3 py-2 border rounded text-xs font-mono bg-muted/30" onClick={(e) => (e.target as HTMLInputElement).select()} />
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('Kopyalandı'); }}>Kopyala</Button>
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
      toast.success('Whitelabel ayarları kaydedildi');
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
            <p className="text-sm font-semibold">Whitelabel aktif</p>
            <p className="text-xs text-muted-foreground">Custom domain'den giriş yapan müşterileriniz "powered by LuviAI" yerine sizin markanızı görür.</p>
          </div>
        </label>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium">Marka Adı</span>
          <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="Webmasters Ajansı" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Logo URL</span>
          <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="https://ajansadi.com.tr/logo.png" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Marka Rengi (hex)</span>
          <input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="#6c5ce7" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Custom Domain (CNAME)</span>
          <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="ai.ajansadi.com.tr" />
          <p className="text-[11px] text-muted-foreground mt-1">CNAME → ai.luvihost.com'a yönlendirin</p>
        </label>
        <label className="block">
          <span className="text-xs font-medium">Email Sender</span>
          <input value={form.emailFrom} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="noreply@ajansadi.com.tr" />
        </label>

        <Button onClick={save} disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      </CardContent></Card>
    </div>
  );
}
