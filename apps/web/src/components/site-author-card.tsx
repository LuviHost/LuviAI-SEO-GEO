'use client';

import { useEffect, useState } from 'react';
import { PenLine, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EMPTY_AUTHOR_FORM, authorToForm, formToAuthor, type SiteAuthor, type SiteAuthorForm } from '@/lib/site-author';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';

/**
 * Sitenin gercek yazari (E-E-A-T). Kayit varsa yeni makalelerin JSON-LD author'u
 * Person olur ve gorunur yazar satiri bu adi tasir; kayit yoksa kurum adi
 * (Organization) kullanilir. RanksUp yazar uydurmaz.
 */
export function SiteAuthorCard({ siteId }: { siteId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SiteAuthor | null>(null);
  const [form, setForm] = useState<SiteAuthorForm>(EMPTY_AUTHOR_FORM);
  // Okuma hatasi bos form gibi gosterilmez: kayitli yazar varken "kurum adi" sanilip uzerine yazilmasin
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    api.getSiteAuthor(siteId)
      .then((r) => {
        if (!alive) return;
        setSaved(r?.author ?? null);
        setForm(authorToForm(r?.author));
      })
      .catch((err) => { if (alive) setLoadError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, reloadKey]);

  const set = (k: keyof SiteAuthorForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const parsed = formToAuthor(form);
    if ('error' in parsed) { toast.error(parsed.error); return; }
    setSaving(true);
    try {
      const r = await api.saveSiteAuthor(siteId, parsed.author);
      setSaved(r.author);
      setForm(authorToForm(r.author));
      toast.success('Yazar kaydedildi. Yeni makaleler bu adla imzalanır.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.deleteSiteAuthor(siteId);
      setSaved(null);
      setForm(EMPTY_AUTHOR_FORM);
      toast.success('Yazar kaldırıldı. Yeni makaleler kurum adıyla imzalanır.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="site-author" className="scroll-mt-24">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <PenLine className="h-5 w-5 text-brand" />
            <div>
              <h2 className="font-semibold">Makale yazarı</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Makaleleri gerçekten yazan ya da onaylayan kişi. Girersen yeni makalelerin yapısal verisinde yazar olarak bu kişi
                görünür ve makale sonundaki imza satırı bu adı taşır. Boş bırakırsan kurum adın kullanılır; RanksUp yazar uydurmaz.
              </p>
            </div>
          </div>
          {!loading && !loadError && (
            <Badge variant={saved ? 'success' : 'outline'}>
              {saved ? 'Tanımlı' : 'Kurum adı kullanılıyor'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="author-name" className="block text-xs font-medium mb-1">Ad soyad *</label>
                <Input id="author-name" value={form.name} onChange={set('name')} maxLength={120} placeholder="Ayşe Yılmaz" disabled={saving} />
              </div>
              <div>
                <label htmlFor="author-title" className="block text-xs font-medium mb-1">Unvan</label>
                <Input id="author-title" value={form.jobTitle} onChange={set('jobTitle')} maxLength={120} placeholder="Mali müşavir" disabled={saving} />
              </div>
            </div>
            <div>
              <label htmlFor="author-url" className="block text-xs font-medium mb-1">Yazar sayfası</label>
              <Input id="author-url" type="url" value={form.url} onChange={set('url')} maxLength={300} placeholder="https://siten.com/yazar/ayse-yilmaz" disabled={saving} />
            </div>
            <div>
              <label htmlFor="author-sameas" className="block text-xs font-medium mb-1">Profil adresleri</label>
              <Textarea id="author-sameas" value={form.sameAs} onChange={set('sameAs')} rows={3} placeholder={'https://www.linkedin.com/in/ayse-yilmaz\nhttps://x.com/ayse'} disabled={saving} />
              <p className="text-label text-muted-foreground mt-1">Satır başına bir adres (LinkedIn, X, kurum profili). En fazla 10.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              {saved && (
                <Button variant="outline" size="sm" onClick={remove} disabled={saving}>Yazarı kaldır</Button>
              )}
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Kaydet
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
