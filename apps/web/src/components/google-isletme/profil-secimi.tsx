'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Search } from 'lucide-react';
import { api, type GbpAday, type GbpDurum } from '@/lib/api';
import { gbpHataMetni } from '@/lib/google-isletme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBanner } from '@/components/ui/status-banner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { AdayKarti } from './aday-karti';
import { GoogleAttribution } from './denetim-karti';

/**
 * Profil secimi — isletme adi + sehirle Google Haritalar'da arar, kullanici kendi isletmesini secer.
 * Sunucuda yalniz placeId saklanir (Google Maps Platform kosulu); ad bu yuzden yalniz bu oturumda
 * (secim ya da denetim sonrasi) bilinir.
 */
export function ProfilSecimi({ siteId, durum, bilinenAd, onDegisti }: {
  siteId: string;
  durum: GbpDurum;
  /** Bu oturumda secilen ya da denetimde gorulen isletme adi */
  bilinenAd: string | null;
  onDegisti: (ad: string | null) => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const [degistiriliyor, setDegistiriliyor] = useState(false);
  const [sorgu, setSorgu] = useState('');
  const [adaylar, setAdaylar] = useState<GbpAday[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const [kaydedilen, setKaydedilen] = useState<string | null>(null);
  const [kaldiriliyor, setKaldiriliyor] = useState(false);

  if (!durum.placesHazir) {
    return (
      <StatusBanner tone="info" title="Google İşletme denetimi yakında">
        Google Haritalar bağlantısı henüz etkin değil. Etkinleştiğinde işletme profilinizi buradan seçip denetleyebileceksiniz.
      </StatusBanner>
    );
  }

  async function ara() {
    const q = sorgu.trim();
    if (q.length < 3) {
      toast.error('İşletme adını ve şehri yazın (en az 3 karakter).');
      return;
    }
    setAraniyor(true);
    try {
      setAdaylar(await api.araGbp(siteId, q));
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setAraniyor(false);
    }
  }

  async function sec(a: GbpAday) {
    setKaydedilen(a.placeId);
    try {
      await api.setGbpPlace(siteId, a.placeId);
      toast.success(`"${a.ad}" profiliniz olarak kaydedildi`);
      setAdaylar(null);
      setSorgu('');
      setDegistiriliyor(false);
      await onDegisti(a.ad);
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setKaydedilen(null);
    }
  }

  async function kaldir() {
    const ok = await confirm({
      title: 'Profil seçimi kaldırılsın mı?',
      description: 'Google İşletme Profili’niz değişmez; yalnız RanksUp’taki seçim silinir. İstediğiniz zaman yeniden seçebilirsiniz.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setKaldiriliyor(true);
    try {
      await api.removeGbpPlace(siteId);
      toast.success('Profil seçimi kaldırıldı');
      await onDegisti(null);
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setKaldiriliyor(false);
    }
  }

  const aramaAcik = !durum.placeId || degistiriliyor;

  return (
    <div className="space-y-3">
      {durum.placeId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{bilinenAd ?? 'İşletme profili seçildi'}</p>
              <p className="text-label text-muted-foreground">
                {bilinenAd ? 'Seçili Google İşletme Profili' : 'Adı ve bilgileri denetimde Google’dan canlı alınır.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDegistiriliyor((v) => !v)}>
              {degistiriliyor ? 'Vazgeç' : 'Değiştir'}
            </Button>
            <Button size="sm" variant="ghost" onClick={kaldir} disabled={kaldiriliyor}>
              {kaldiriliyor && <Loader2 className="h-3 w-3 animate-spin" />}
              Kaldır
            </Button>
          </div>
        </div>
      )}

      {aramaAcik && (
        <div className="space-y-2">
          <form
            onSubmit={(e) => { e.preventDefault(); void ara(); }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <label className="flex-1">
              <span className="sr-only">İşletme adı + şehir</span>
              <Input
                value={sorgu}
                onChange={(e) => setSorgu(e.target.value)}
                placeholder="İşletme adı + şehir (ör. Kahve Durağı Kadıköy)"
                autoComplete="off"
                maxLength={120}
              />
            </label>
            <Button type="submit" disabled={araniyor}>
              {araniyor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Google Haritalar’da ara
            </Button>
          </form>

          {adaylar && (adaylar.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sonuç bulunamadı. İşletme adını Google Haritalar’da göründüğü gibi ve şehirle birlikte yazın.
            </p>
          ) : (
            <div className="space-y-1">
              <ul className="divide-y rounded-lg border">
                {adaylar.map((a) => (
                  <li key={a.placeId}>
                    <AdayKarti
                      aday={a}
                      aksiyon={
                        <Button size="sm" onClick={() => sec(a)} disabled={kaydedilen !== null}>
                          {kaydedilen === a.placeId && <Loader2 className="h-3 w-3 animate-spin" />}
                          Bu benim işletmem
                        </Button>
                      }
                    />
                  </li>
                ))}
              </ul>
              <GoogleAttribution />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
