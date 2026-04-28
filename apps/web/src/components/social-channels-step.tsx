'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2, Star, Power, Link2, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type Catalog = Array<{ type: string; label: string; status: 'live' | 'soon'; note?: string; recommended?: boolean }>;

export function SocialChannelsStep({ siteId }: { siteId: string }) {
  const search = useSearchParams();
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, list] = await Promise.all([
        api.getSocialCatalog().catch(() => []),
        api.listSocialChannels(siteId).catch(() => []),
      ]);
      setCatalog(c);
      setChannels(list);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [siteId]);

  // Callback'ten döndüğünde toast + URL temizle
  useEffect(() => {
    if (search.get('social') === 'connected') {
      toast.success('Sosyal kanal bağlandı ✓');
      const url = new URL(window.location.href);
      url.searchParams.delete('social');
      url.searchParams.delete('channel');
      window.history.replaceState({}, '', url.toString());
      refresh();
    }
  }, [search]);

  const connect = async (type: string) => {
    setBusy(type);
    try {
      const { url } = await api.startSocialOAuth(siteId, type);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message);
      setBusy(null);
    }
  };

  const toggleActive = async (channelId: string, isActive: boolean) => {
    try {
      await api.updateSocialChannel(channelId, { isActive: !isActive });
      toast.success(isActive ? 'Kanal pasifleştirildi' : 'Kanal aktifleştirildi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const setDefault = async (channelId: string) => {
    try {
      await api.updateSocialChannel(channelId, { isDefault: true });
      toast.success('Varsayılan kanal güncellendi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (channelId: string, name: string) => {
    if (!confirm(`"${name}" kanalını silmek istediğine emin misin? İlişkili tüm taslak postlar silinir.`)) return;
    try {
      await api.deleteSocialChannel(channelId);
      toast.success('Kanal silindi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
        <p className="text-sm">
          <strong>💡 Önerimiz: LinkedIn ile başla.</strong> Ücretsiz, anında yayın yapabilirsin ve
          B2B / hosting içerikleri için en yüksek etkileşimi alır.
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">
          X (Twitter) artık her tweet için <em>ücretli kredi</em> istiyor (Pay Per Use). Önce
          kredi yüklemen gerekiyor — bu yüzden LinkedIn'i ön plana aldık.
        </p>
      </div>

      {/* Bağlı kanallar */}
      {channels.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bağlı kanallar</div>
          <ul className="divide-y border rounded-lg">
            {channels.map((c) => (
              <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {c.externalAvatar ? (
                    <img src={c.externalAvatar} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-bold">
                      {c.externalName?.[0] ?? '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.externalName ?? c.name}</span>
                      <Badge variant="outline" className="text-[10px]">{prettyType(c.type)}</Badge>
                      {c.isDefault && <Badge variant={'success' as any} className="text-[10px]">Varsayılan</Badge>}
                      {!c.isActive && <Badge variant="outline" className="text-[10px] opacity-60">Pasif</Badge>}
                    </div>
                    {c.lastError && (
                      <div className="text-xs text-red-500 mt-0.5 truncate" title={c.lastError}>
                        ⚠ {c.lastError}
                      </div>
                    )}
                    {c.lastUsedAt && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Son kullanım: {new Date(c.lastUsedAt).toLocaleString('tr-TR')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {!c.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault(c.id)} title="Varsayılan yap">
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActive(c.id, c.isActive)}
                    title={c.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                  >
                    <Power className={`h-4 w-4 ${c.isActive ? 'text-green-500' : 'text-muted-foreground'}`} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id, c.externalName ?? c.name)} title="Sil">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {/* LinkedIn Şirket kanalları için sayfa seçici */}
          {channels.filter((c) => c.type === 'LINKEDIN_COMPANY').map((c) => (
            <LinkedInPageSelector key={`pgsel-${c.id}`} channelId={c.id} currentExternalId={c.externalId} onChanged={refresh} />
          ))}
        </div>
      )}

      {/* Eklenebilecek kanallar */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yeni kanal bağla</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {catalog.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={item.status === 'soon' || busy === item.type}
              onClick={() => connect(item.type)}
              title={item.note ?? ''}
              className={`flex flex-col items-start gap-1.5 px-4 py-3 rounded-lg border text-left transition-colors ${
                item.status === 'soon'
                  ? 'opacity-60 cursor-not-allowed bg-muted/40'
                  : item.recommended
                    ? 'border-brand/60 ring-2 ring-brand/20 hover:border-brand bg-brand/5 cursor-pointer'
                    : 'hover:border-brand bg-card cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.recommended && (
                    <Badge variant={'success' as any} className="text-[9px] uppercase">Önerilen</Badge>
                  )}
                </div>
                {item.status === 'soon' ? (
                  <Badge variant="outline" className="text-[10px]">Yakında</Badge>
                ) : (
                  <span className={`inline-flex items-center gap-1 text-xs ${item.recommended ? 'font-semibold text-brand' : 'text-brand'}`}>
                    <Link2 className="h-3.5 w-3.5" /> {busy === item.type ? '…' : 'Bağla'}
                  </span>
                )}
              </div>
              {item.note && (
                <span className="text-[11px] text-muted-foreground leading-snug">{item.note}</span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Bağlanma sonrası Google'a benzer şekilde LinkedIn izin sayfasına gidersin, onaylarsın ve geri dönersin.
        </p>
      </div>
    </div>
  );
}

function LinkedInPageSelector({
  channelId, currentExternalId, onChanged,
}: {
  channelId: string;
  currentExternalId: string | null;
  onChanged: () => void;
}) {
  const [pages, setPages] = useState<Array<{ organizationUrn: string; organizationId: string; name: string; vanityName?: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listLinkedInPages(channelId);
      setPages(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [channelId]);

  const select = async (urn: string, name: string) => {
    setSaving(true);
    try {
      await api.setLinkedInPage(channelId, { organizationUrn: urn, organizationName: name });
      toast.success(`Sayfa seçildi: ${name}`);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isOrgSet = currentExternalId?.startsWith('urn:li:organization:');

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        🔗 LinkedIn Şirket Sayfası — sayfa seç
      </div>

      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : error ? (
        <div className="text-xs text-red-600 dark:text-red-400 leading-relaxed whitespace-pre-wrap">
          {error}
          <Button size="sm" variant="outline" onClick={load} className="mt-2 ml-0">
            Tekrar dene
          </Button>
        </div>
      ) : pages && pages.length > 0 ? (
        <>
          <select
            value={isOrgSet ? currentExternalId! : ''}
            onChange={(e) => {
              const found = pages.find((p) => p.organizationUrn === e.target.value);
              if (found) select(found.organizationUrn, found.name);
            }}
            disabled={saving}
            className="w-full bg-card border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            {!isOrgSet && <option value="">— Şirket sayfası seç —</option>}
            {pages.map((p) => (
              <option key={p.organizationUrn} value={p.organizationUrn}>
                {p.name} {p.vanityName ? `(${p.vanityName})` : ''} · ID {p.organizationId}
              </option>
            ))}
          </select>
          {!isOrgSet && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ Henüz sayfa seçmedin — bu kanal şu an kişisel profil URN'iyle kayıtlı, post atılırsa kişisel olarak gider.
            </p>
          )}
        </>
      ) : pages && pages.length === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Bu Google hesabı LinkedIn'de hiçbir sayfanın admin'i değil.
        </p>
      ) : null}
    </div>
  );
}

function prettyType(t: string): string {
  switch (t) {
    case 'LINKEDIN_PERSONAL': return 'LinkedIn';
    case 'LINKEDIN_COMPANY': return 'LinkedIn Şirket';
    case 'X_TWITTER': return 'X';
    case 'FACEBOOK_PAGE': return 'Facebook';
    case 'INSTAGRAM_BUSINESS': return 'Instagram';
    case 'TIKTOK': return 'TikTok';
    case 'YOUTUBE': return 'YouTube';
    case 'THREADS': return 'Threads';
    case 'BLUESKY': return 'Bluesky';
    case 'PINTEREST': return 'Pinterest';
    default: return t;
  }
}
