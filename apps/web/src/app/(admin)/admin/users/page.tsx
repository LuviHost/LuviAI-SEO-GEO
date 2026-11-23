'use client';

import { Fragment, useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { AccountLimitsRow } from './account-limits-row';
import { yoneticiBilgisi, yoneticiYetkisi } from './yonetici-actions';

const PLAN_VARIANT: Record<string, any> = {
  TRIAL: 'secondary',
  STARTER: 'default',
  PRO: 'default',
  AGENCY: 'success',
  ENTERPRISE: 'success',
  PARTNER: 'success',
};

/**
 * Elle atanabilen planlar — api admin/plan-assignment.ts ASSIGNABLE_PLANS ile ayni.
 * Fatura olusmaz; TRIAL plani kapatir (deneme yeniden baslamaz).
 */
const ASSIGNABLE: { value: string; label: string }[] = [
  { value: 'STARTER', label: 'Başlangıç' },
  { value: 'PRO', label: 'Profesyonel' },
  { value: 'PARTNER', label: 'İş Ortağı' },
  { value: 'ENTERPRISE', label: 'Kurumsal' },
  { value: 'AGENCY', label: 'Ajans (eski)' },
  { value: 'TRIAL', label: 'Planı kapat' },
];

const SUB_VARIANT: Record<string, any> = {
  TRIAL: 'secondary',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'outline',
  EXPIRED: 'destructive',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [secim, setSecim] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState<string | null>(null);
  const [ayarAcik, setAyarAcik] = useState<string | null>(null);
  // Yonetici ekleme yalniz kurucuda (sunucu eylemi ayrica dogrular; bu yalniz dugme gorunurlugu)
  const [benKurucu, setBenKurucu] = useState(false);
  const [kurucular, setKurucular] = useState<string[]>([]);
  const [yetkiCalisan, setYetkiCalisan] = useState<string | null>(null);

  const yetkiDegistir = async (u: any, islem: 'ver' | 'al') => {
    const soru = islem === 'ver'
      ? `${u.email} yönetici yapılsın mı?\n\nTüm müşteri sitelerini ve raporlarını görür, LinkedIn botunu ve ayarları yönetebilir, ücretli ölçüm başlatabilir. Yönetici ekleyip çıkaramaz. Girişte kod kendi e-postasına gelir.`
      : `${u.email} yöneticilikten çıkarılsın mı? Admin paneline bir sonraki tıklamada erişimi kapanır.`;
    if (!confirm(soru)) return;
    setYetkiCalisan(u.id);
    try {
      const r = await yoneticiYetkisi(u.id, islem);
      if (!r.ok) { toast.error(r.neden); return; }
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, role: r.role, adminYetkiAt: r.adminYetkiAt } : x)));
      toast.success(islem === 'ver' ? `${u.email} yönetici yapıldı` : `${u.email} yöneticilikten çıkarıldı`);
    } catch (err: any) {
      toast.error(err?.message || 'İşlem yapılamadı');
    } finally {
      setYetkiCalisan(null);
    }
  };

  const planAta = async (u: any) => {
    const plan = secim[u.id];
    if (!plan || plan === u.plan) return;
    const ad = ASSIGNABLE.find((a) => a.value === plan)?.label ?? plan;
    const soru = plan === 'TRIAL'
      ? `${u.email} hesabının planı kapatılsın mı? Hesap salt okunur olur.`
      : `${u.email} hesabına ${ad} planı atansın mı? Fatura oluşmaz; ödemeyi ayrıca kaydet.`;
    if (!confirm(soru)) return;
    setKaydediliyor(u.id);
    try {
      const res = await api.setAdminUserPlan(u.id, plan);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, plan: res.plan, subscriptionStatus: res.subscriptionStatus } : x)));
      setSecim((s) => { const { [u.id]: _, ...rest } = s; return rest; });
      toast.success(plan === 'TRIAL' ? 'Plan kapatıldı' : `${ad} planı atandı`);
    } catch (err: any) {
      toast.error(err?.message || 'Plan atanamadı');
    } finally {
      setKaydediliyor(null);
    }
  };

  useEffect(() => {
    api.getAdminUsers()
      .then(async (list) => {
        setUsers(list);
        const b = await yoneticiBilgisi(list.map((u: any) => u.email ?? '')).catch(() => null);
        if (b) { setBenKurucu(b.benKurucu); setKurucular(b.kurucular); }
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      (u.email ?? '').toLowerCase().includes(needle) ||
      (u.name ?? '').toLowerCase().includes(needle),
    );
  }, [users, q]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-[450] tracking-[-0.04em]">Kullanıcılar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toplam {users.length} kullanıcı · Filtrelenmiş: {filtered.length}
          </p>
        </div>
        <Input
          placeholder="email veya isim ara..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3">Email / İsim</th>
                    <th className="p-3">Rol</th>
                    <th className="p-3">Plan</th>
                    <th className="p-3">Sub Status</th>
                    <th className="p-3 text-center">Site</th>
                    <th className="p-3 text-center">Job</th>
                    <th className="p-3 text-center">Fatura</th>
                    <th className="p-3">Kayıt</th>
                    <th className="p-3">Plan ata</th>
                    <th className="p-3">Ayarlar</th>
                    <th className="p-3">Yönetici</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <Fragment key={u.id}>
                    <tr className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{u.email}</div>
                        {u.name && <div className="text-xs text-muted-foreground">{u.name}</div>}
                      </td>
                      <td className="p-3">
                        <Badge variant={u.role === 'ADMIN' ? 'default' : 'outline'} className={u.role === 'ADMIN' ? 'bg-amber-500 text-white' : ''}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={PLAN_VARIANT[u.plan] ?? 'outline'}>{u.plan}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={SUB_VARIANT[u.subscriptionStatus] ?? 'outline'}>
                          {u.subscriptionStatus}
                        </Badge>
                      </td>
                      <td className="p-3 text-center font-mono">{u._count?.sites ?? 0}</td>
                      <td className="p-3 text-center font-mono">{u._count?.jobs ?? 0}</td>
                      <td className="p-3 text-center font-mono">{u._count?.invoices ?? 0}</td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                      <td className="p-3">
                        {u.role === 'ADMIN' ? (
                          <span className="text-xs text-muted-foreground">Yönetici</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`${u.email} için plan`}
                              className="h-8 rounded-md border bg-background px-2 text-xs"
                              value={secim[u.id] ?? ''}
                              onChange={(e) => setSecim((s) => ({ ...s, [u.id]: e.target.value }))}
                            >
                              <option value="">Seç</option>
                              {ASSIGNABLE.filter((a) => a.value !== u.plan || a.value === 'TRIAL').map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-50"
                              disabled={!secim[u.id] || kaydediliyor === u.id}
                              onClick={() => planAta(u)}
                            >
                              {kaydediliyor === u.id ? 'Atanıyor' : 'Ata'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          aria-expanded={ayarAcik === u.id}
                          className="h-8 rounded-md border px-3 text-xs font-medium"
                          onClick={() => setAyarAcik((a) => (a === u.id ? null : u.id))}
                        >
                          {ayarAcik === u.id ? 'Kapat' : 'Asistan ve soru'}
                        </button>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <YoneticiHucresi
                          u={u}
                          kurucu={kurucular.includes((u.email ?? '').toLowerCase())}
                          benKurucu={benKurucu}
                          calisiyor={yetkiCalisan === u.id}
                          onDegistir={yetkiDegistir}
                        />
                      </td>
                    </tr>
                    {ayarAcik === u.id && <AccountLimitsRow userId={u.id} colSpan={11} />}
                    </Fragment>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td colSpan={11} className="p-12 text-center text-muted-foreground">
                        Kullanıcı bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Yonetici sutunu. Kurucu: degistirilemez. Panelden verilmis yonetici: kurucu cikarabilir.
 * Rolu ADMIN ama yetkisi panelden verilmemis eski hesap: admin girisine kapali (bilgi).
 */
function YoneticiHucresi({ u, kurucu, benKurucu, calisiyor, onDegistir }: {
  u: any;
  kurucu: boolean;
  benKurucu: boolean;
  calisiyor: boolean;
  onDegistir: (u: any, islem: 'ver' | 'al') => void;
}) {
  if (kurucu) return <span className="text-xs font-medium">Kurucu</span>;
  if (u.role === 'ADMIN' && u.adminYetkiAt) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Yönetici · {new Date(u.adminYetkiAt).toLocaleDateString('tr-TR')}</span>
        {benKurucu && (
          <button
            type="button"
            className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-50"
            disabled={calisiyor}
            onClick={() => onDegistir(u, 'al')}
          >
            {calisiyor ? 'Çıkarılıyor' : 'Yöneticilikten çıkar'}
          </button>
        )}
      </div>
    );
  }
  if (u.role === 'ADMIN') {
    return <span className="text-xs text-muted-foreground" title="Rolü ADMIN ama kurucu listesinde değil ve panelden yetki verilmemiş: admin girişi kapalı">Giriş kapalı</span>;
  }
  if (!benKurucu || u.role !== 'USER' || u.deletionRequestedAt) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-50"
      disabled={calisiyor}
      onClick={() => onDegistir(u, 'ver')}
    >
      {calisiyor ? 'Yapılıyor' : 'Yönetici yap'}
    </button>
  );
}
