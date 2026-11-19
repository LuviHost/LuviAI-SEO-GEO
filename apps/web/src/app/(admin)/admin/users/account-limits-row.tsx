'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, type AdminUserLimits } from '@/lib/api';

/**
 * Hesap ayarlari satiri (18.11.2026, sahip: "adminden kisiye hangi AI modelleri kullanabilir
 * tanimlayabilelim" ve "bu limiti de adminden belirleyelim").
 * Asistan yalniz KAPATILIR (planin kapsamindakiler listelenir); soru siniri bos = plan degeri.
 * Kural ve dogrulama sunucuda: api admin/account-limits.ts.
 */
export function AccountLimitsRow({ userId, colSpan }: { userId: string; colSpan: number }) {
  const [data, setData] = useState<AdminUserLimits | null>(null);
  const [acik, setAcik] = useState<Record<string, boolean>>({});
  const [soru, setSoru] = useState('');
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const uygula = (d: AdminUserLimits) => {
    setData(d);
    setAcik(Object.fromEntries(d.engines.map((e) => [e.id, e.enabled])));
    setSoru(d.promptsPerSite.override === null ? '' : String(d.promptsPerSite.override));
  };

  useEffect(() => {
    api.getAdminUserLimits(userId).then(uygula).catch((err: any) => toast.error(err?.message || 'Hesap ayarları okunamadı'));
  }, [userId]);

  const kaydet = async () => {
    if (!data) return;
    const temiz = soru.trim();
    const sayi = temiz === '' ? null : Number(temiz);
    if (sayi !== null && (!Number.isInteger(sayi) || sayi < 1 || sayi > 200)) {
      toast.error('Soru sınırı 1–200 arasında bir tam sayı olmalı (boş = plan değeri).');
      return;
    }
    setKaydediliyor(true);
    try {
      const d = await api.setAdminUserLimits(userId, {
        disabledEngines: data.engines.filter((e) => !acik[e.id]).map((e) => e.id),
        promptsPerSite: sayi,
      });
      uygula(d);
      toast.success('Hesap ayarları kaydedildi');
    } catch (err: any) {
      toast.error(err?.message || 'Hesap ayarları kaydedilemedi');
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <tr className="border-t bg-muted/20">
      <td colSpan={colSpan} className="p-4">
        {!data ? (
          <p className="text-xs text-muted-foreground">Yükleniyor…</p>
        ) : (
          <div className="flex flex-wrap items-end gap-6">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">Ölçülen asistanlar ({data.plan} planının kapsamı)</legend>
              <div className="flex flex-wrap gap-3">
                {data.engines.map((e) => (
                  <label key={e.id} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={!!acik[e.id]}
                      onChange={(ev) => setAcik((s) => ({ ...s, [e.id]: ev.target.checked }))}
                    />
                    {e.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">Site başına soru sınırı</span>
              <input
                type="number"
                min={1}
                max={200}
                inputMode="numeric"
                className="h-8 w-28 rounded-md border bg-background px-2 text-xs"
                placeholder={`Plan: ${data.promptsPerSite.planDefault}`}
                value={soru}
                onChange={(ev) => setSoru(ev.target.value)}
              />
            </label>
            <button
              type="button"
              className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-50"
              disabled={kaydediliyor}
              onClick={kaydet}
            >
              {kaydediliyor ? 'Kaydediliyor' : 'Kaydet'}
            </button>
            {data.exempt && <p className="text-xs text-muted-foreground">Yönetici hesabı: sınırlar uygulanmaz.</p>}
          </div>
        )}
      </td>
    </tr>
  );
}
