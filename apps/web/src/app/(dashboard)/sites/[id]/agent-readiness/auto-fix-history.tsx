'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { api, type AutoFixHistoryItem } from '@/lib/api';

/**
 * Son kök dosya düzeltmeleri + geri alma. Geri alma, düzeltmeden önceki içeriği
 * aynen yazar; dosya RanksUp'ın yazdığından sonra değiştiyse API reddeder
 * (sonraki elle değişiklikler silinmesin).
 */

const STATUS: Record<string, { text: string; variant: 'success' | 'secondary' | 'danger' }> = {
  APPLIED: { text: 'Uygulandı', variant: 'success' },
  REVERTED: { text: 'Geri alındı', variant: 'secondary' },
  FAILED: { text: 'Başarısız', variant: 'danger' },
};

const ACTION: Record<string, string> = {
  merge: 'mevcut dosyaya ekleme',
  create: 'yeni dosya',
  regenerate: 'RanksUp dosyası yenilendi',
};

export function AutoFixHistory({ siteId, refreshKey }: { siteId: string; refreshKey: number }) {
  const [items, setItems] = useState<AutoFixHistoryItem[] | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setItems(await api.getAutoFixHistory(siteId));
    } catch {
      setItems([]);
    }
  }, [siteId]);

  // refreshKey: bir duzeltme uygulandiginda ust sayfa listeyi tazeletir
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const revert = async (item: AutoFixHistoryItem) => {
    const ok = await confirm({
      title: `${item.filename} geri alınsın mı?`,
      description: 'Dosyanın düzeltmeden önceki hali aynen geri yazılır. Dosya o günden beri değiştiyse geri alma yapılmaz.',
      confirmLabel: 'Geri al',
      danger: true,
    });
    if (!ok) return;
    setReverting(item.id);
    try {
      const res = await api.revertAutoFix(siteId, item.id);
      if (res.ok) {
        toast.success(res.note ?? `${item.filename} geri alındı.`, { duration: 9000 });
        if (res.verified === false) toast.warning('Geri yazıldı ama sitede henüz görünmüyor — önbellek olabilir.');
      } else {
        toast.error(res.error ?? 'Geri alınamadı.', { duration: 9000 });
      }
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setReverting(null);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Son dosya düzeltmeleri</span>
        </div>
        <div className="divide-y rounded-lg border">
          {items.map((item) => {
            const st = STATUS[item.status] ?? { text: item.status, variant: 'secondary' as const };
            return (
              <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5 flex-wrap">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{item.filename}</span>
                    <Badge variant={st.variant} className="text-label">{st.text}</Badge>
                    {item.action && ACTION[item.action] && <span className="text-xs text-muted-foreground">{ACTION[item.action]}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.appliedAt).toLocaleString('tr-TR')}
                    {item.status === 'APPLIED' && item.verified === true && ' · sitede doğrulandı'}
                    {item.status === 'APPLIED' && item.verified === false && ' · sitede henüz görünmedi (önbellek ya da kök dizin)'}
                    {item.status === 'FAILED' && item.error ? ` · ${item.error}` : ''}
                  </div>
                  {item.revertNote && <div className="text-xs text-muted-foreground">{item.revertNote}</div>}
                </div>
                {item.revertible && (
                  <Button size="sm" variant="outline" onClick={() => revert(item)} disabled={reverting !== null}>
                    {reverting === item.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                    Geri al
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
