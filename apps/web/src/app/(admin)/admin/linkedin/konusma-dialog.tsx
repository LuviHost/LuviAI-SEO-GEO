'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Mail, PenLine, RefreshCw } from 'lucide-react';
import { api, type LinkedinProspect } from '@/lib/api';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { konusmaBalonlari, type Balon } from '@/lib/konusma';

/**
 * KONUSMA PENCERESI — takip kaydini sohbet gibi gosterir (23.11.2026, sahip istegi:
 * "chat ekrani gibi sagli sollu, farkli popupta").
 *  - Sag (marka rengi): bizim yazdiklarimiz — baglanti notu, mesajlar, hatirlatmalar.
 *  - Sol (gri): karsi tarafin cevaplari. Metni kaydedilmemis cevap kesik cizgili yer tutucu.
 *  - Alt: yeni mesaj KAYDI (gondermez). "Ben yazdim" / "<ad> yazdi" secilir; ayni kartin
 *    metnine tarihli eklenir (api elle-kayit). Karsi tarafin mesaji kaydi "Cevap verdi" yapar.
 */

const DURUM_ETIKETI: Record<string, string> = {
  QUEUED: 'Kuyrukta', REQUESTED: 'İstek gönderildi', ACCEPTED: 'Kabul etti', MESSAGED: 'Mesaj gönderildi',
  REPLIED: 'Cevap verdi', SKIPPED: 'Atlandı', FAILED: 'Hata',
};

function simdiYerel(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function KonusmaDialog({ p, gonderen, onClose, onDone }: {
  p: LinkedinProspect | null;
  /** Iletisimi kuran yonetici ("Emir" / "Talat"): yazani bilinmeyen giden balonlarda gorunur */
  gonderen?: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const balonlar = useMemo(() => (p ? konusmaBalonlari(p) : []), [p]);
  const [yon, setYon] = useState<'GIDEN' | 'GELEN'>('GIDEN');
  const [metin, setMetin] = useState('');
  const [konu, setKonu] = useState('');
  const [zaman, setZaman] = useState(simdiYerel());
  const [kaydediyor, setKaydediyor] = useState(false);
  // Kaydirilan kutu (mesaj listesi). NEDEN kutunun kendisi: scrollIntoView pencere acilirken
  // (portal + acilis animasyonu) bos kaliyor ya da yanlis kapsayiciyi kaydiriyordu (23.11).
  const kutuRef = useRef<HTMLDivElement>(null);

  // Kisi degisince formu sifirla; acilista ve yeni balonda en alta kaydir
  useEffect(() => { setMetin(''); setKonu(''); setYon('GIDEN'); setZaman(simdiYerel()); }, [p?.id]);
  useEffect(() => {
    if (!p) return;
    const enAlta = () => { const el = kutuRef.current; if (el) el.scrollTop = el.scrollHeight; };
    // Hemen, bir sonraki karede ve acilis animasyonu bittikten sonra (icerik olculmus olur)
    enAlta();
    const kare = requestAnimationFrame(enAlta);
    const sure = setTimeout(enAlta, 250);
    return () => { cancelAnimationFrame(kare); clearTimeout(sure); };
  }, [balonlar.length, p]);

  if (!p) return null;
  const eposta = p.kanal === 'EPOSTA';
  const adres = eposta ? (p.eposta ?? p.profileUrl.replace(/^mailto:/i, '')) : p.profileUrl;

  const kaydet = async () => {
    if (!metin.trim()) return;
    setKaydediyor(true);
    try {
      await api.elleKayitLinkedin({
        kanal: eposta ? 'EPOSTA' : 'LINKEDIN',
        ad: p.ad,
        soyad: p.soyad,
        firma: p.firma,
        unvan: p.unvan,
        profileUrl: eposta ? null : p.profileUrl,
        eposta: eposta ? adres : null,
        konu: konu.trim() || null,
        mesaj: metin,
        gonderimAt: zaman ? new Date(zaman).toISOString() : null,
        yon,
      });
      toast.success(yon === 'GELEN' ? 'Cevap kaydedildi' : 'Mesaj kaydedildi — hatırlatma 4 iş günü sonraya kuruldu');
      setMetin('');
      setKonu('');
      setZaman(simdiYerel());
      await onDone();
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err?.message ?? 'beklenmeyen hata'}`);
    } finally {
      setKaydediyor(false);
    }
  };

  return (
    <Dialog open={!!p} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg" className="flex flex-col overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle>{p.ad} {p.soyad}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.firma}{p.unvan ? ` · ${p.unvan}` : ''}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-label">{DURUM_ETIKETI[p.status] ?? p.status}</span>
            {eposta ? (
              <a href={p.profileUrl} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                {adres} <Mail className="h-3 w-3" />
              </a>
            ) : (
              <a href={p.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                LinkedIn profili <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="p-0 bg-muted/30">
          <div ref={kutuRef} className="max-h-[55dvh] min-h-[160px] overflow-y-auto px-5 py-4">
          {balonlar.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Bu kişiyle henüz kayıtlı bir yazışma yok.</div>
          ) : (
            <div className="space-y-3">
              {balonlar.map((b, i) => (
                <Fragment key={i}>
                  {b.tarih && b.tarih !== balonlar[i - 1]?.tarih && (
                    <div className="flex justify-center">
                      <span className="rounded-full border bg-background px-2.5 py-0.5 text-label text-muted-foreground">{b.tarih}</span>
                    </div>
                  )}
                  <BalonGorunum b={b} kisi={p.ad} gonderen={gonderen ?? null} />
                </Fragment>
              ))}
            </div>
          )}
          </div>
        </DialogBody>

        <DialogFooter className="block space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Yeni kayıt (gönderilmez):</span>
            {(['GIDEN', 'GELEN'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={yon === k}
                onClick={() => setYon(k)}
                className={cn('rounded-md border px-2.5 py-1 transition-colors', yon === k ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
              >
                {k === 'GIDEN' ? 'Ben yazdım' : `${p.ad} yazdı`}
              </button>
            ))}
            <Input type="datetime-local" value={zaman} onChange={(e) => setZaman(e.target.value)} className="ml-auto h-8 w-[190px]" aria-label="Mesaj zamanı" />
          </div>
          {eposta && (
            <Input value={konu} onChange={(e) => setKonu(e.target.value)} placeholder="Konu (isteğe bağlı)" aria-label="Konu" className="h-8" />
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
              rows={3}
              placeholder={yon === 'GIDEN' ? 'Gönderdiğin mesajı yapıştır' : `${p.ad} kişisinin cevabını yapıştır`}
              aria-label="Mesaj metni"
            />
            <Button size="sm" onClick={kaydet} disabled={kaydediyor || !metin.trim()}>
              {kaydediyor ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1.5 h-3.5 w-3.5" />}
              Kaydet
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BalonGorunum({ b, kisi, gonderen }: { b: Balon; kisi: string; gonderen: string | null }) {
  const giden = b.yon === 'giden';
  return (
    <div className={cn('flex flex-col', giden ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
          giden ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md border bg-background text-foreground',
          b.yerTutucu && 'border-dashed italic text-muted-foreground shadow-none',
        )}
      >
        {b.baslik && (
          <div className={cn('mb-1 text-label', giden ? 'text-white/80' : 'text-muted-foreground')}>{b.baslik}</div>
        )}
        <div className="whitespace-pre-wrap break-words leading-relaxed">{b.metin}</div>
      </div>
      <div className="mt-1 px-1 text-label font-normal text-muted-foreground">
        {giden ? (b.yazan ?? gonderen ?? 'Sen') : kisi}{b.saat ? ` · ${b.saat}` : ''}{b.kanal ? ` · ${b.kanal}` : ''}
      </div>
    </div>
  );
}
