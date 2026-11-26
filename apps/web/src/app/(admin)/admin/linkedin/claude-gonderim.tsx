'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Copy, ExternalLink, KeyRound, Laptop, RefreshCw, Send, X } from 'lucide-react';
import {
  api,
  type LinkedinClaudeAdaylar,
  type LinkedinClaudeDurum,
  type LinkedinClaudeIs,
  type LinkedinClaudeKisiSonucu,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * CLAUDE ILE GONDERIM (26.11.2026) — eski bot (OpenClaw + sabit dugme adlari) 10.09'dan beri
 * gonderemiyordu. Burada kurucu listeyi ve notlari gorur, "Claude ile gönder"e basar (= onay);
 * kendi Mac'indeki ajan Claude Code'u Chrome'da calistirip istekleri gonderir, sonuc buraya duser.
 * Sunucu LinkedIn'e hic dokunmaz.
 */

const SONUC_ETIKETI: Record<LinkedinClaudeKisiSonucu, { label: string; variant: 'success' | 'info' | 'secondary' | 'warning' | 'danger' }> = {
  GONDERILDI: { label: 'Gönderildi', variant: 'success' },
  KURU_TAMAM: { label: 'Kuru: hazırdı', variant: 'info' },
  ZATEN_BAGLI: { label: 'Zaten bağlı', variant: 'secondary' },
  BEKLIYOR: { label: 'Zaten bekliyor', variant: 'secondary' },
  BULUNAMADI: { label: 'Bulunamadı', variant: 'warning' },
  EPOSTA_ISTIYOR: { label: 'E-posta istiyor', variant: 'warning' },
  KABUL_TAMAM: { label: 'Kontrol edildi', variant: 'info' },
  KABUL_ETTI: { label: 'Kabul etti', variant: 'success' },
  ENGEL: { label: 'LinkedIn engeli', variant: 'danger' },
  HATA: { label: 'Hata', variant: 'danger' },
};

const IS_ETIKETI: Record<LinkedinClaudeIs['durum'], string> = {
  BEKLIYOR: 'Mac bekleniyor', CALISIYOR: 'Çalışıyor', BITTI: 'Bitti', HATA: 'Durdu', IPTAL: 'İptal',
};

function saat(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ClaudeGonderimCard({ onDone }: { onDone: () => Promise<void> }) {
  const [aday, setAday] = useState<LinkedinClaudeAdaylar | null>(null);
  const [durum, setDurum] = useState<LinkedinClaudeDurum | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [kuru, setKuru] = useState(true);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [anahtarKomutu, setAnahtarKomutu] = useState<string | null>(null);
  const [acikNot, setAcikNot] = useState<string | null>(null);
  // Aday listesinde ad / firma / unvan ile suzme (liste 100 kisiye kadar)
  const [ara, setAra] = useState('');

  const durumYukle = useCallback(async () => {
    try { setDurum(await api.linkedinClaudeDurum()); } catch { /* sessiz */ }
  }, []);

  const adayYukle = useCallback(async () => {
    try {
      const a = await api.linkedinClaudeAdaylar();
      setAday(a);
      // Varsayilan secim: ilk 5 (kota ve is tavani icinde)
      setSecili(new Set(a.adaylar.slice(0, Math.min(5, a.isTavani, Math.max(a.kalanBugun, 1))).map((x) => x.id)));
    } catch (err: any) {
      toast.error(`Aday listesi alınamadı: ${err.message}`);
    }
  }, []);

  useEffect(() => { void adayYukle(); void durumYukle(); }, [adayYukle, durumYukle]);
  // CSV ice aktarma bitince aday listesi kendiliginden tazelensin (26.11: yeni kisiler gorunmuyordu)
  useEffect(() => {
    const f = () => { void adayYukle(); };
    window.addEventListener('linkedin-kuyruk-degisti', f);
    return () => window.removeEventListener('linkedin-kuyruk-degisti', f);
  }, [adayYukle]);

  const aktifIs = durum?.isler.find((i) => i.durum === 'BEKLIYOR' || i.durum === 'CALISIYOR') ?? null;

  // Is surerken 15 sn'de bir, yoksa dakikada bir (Mac servisi durumu)
  useEffect(() => {
    const t = setInterval(() => { void durumYukle(); }, aktifIs ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [aktifIs, durumYukle]);

  // Is bitince listeyi ve ust sayaclari tazele
  const [sonAktif, setSonAktif] = useState<string | null>(null);
  useEffect(() => {
    if (aktifIs) { setSonAktif(aktifIs.id); return; }
    if (sonAktif) { setSonAktif(null); void adayYukle(); void onDone(); }
  }, [aktifIs, sonAktif, adayYukle, onDone]);

  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase('tr');
    const liste = aday?.adaylar ?? [];
    if (!q) return liste;
    return liste.filter((a) => `${a.ad} ${a.soyad} ${a.firma} ${a.unvan ?? ''}`.toLocaleLowerCase('tr').includes(q));
  }, [aday, ara]);
  const seciliListe = useMemo(() => (aday?.adaylar ?? []).filter((a) => secili.has(a.id)), [aday, secili]);
  const tavan = aday ? Math.min(aday.isTavani, kuru ? aday.isTavani : aday.kalanBugun) : 0;

  const degistir = (id: string) => {
    setSecili((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < tavan) n.add(id);
      else toast.error(`En fazla ${tavan} kişi seçebilirsin`);
      return n;
    });
  };

  const gonder = async () => {
    if (seciliListe.length === 0) return;
    const metin = kuru
      ? `${seciliListe.length} kişi için KURU deneme: Claude profilleri açıp notu yazacak, "Gönder"e BASMAYACAK. Başlatılsın mı?`
      : `${seciliListe.length} kişiye, listede gördüğün notlarla GERÇEK bağlantı isteği gidecek (kişiler arası 2–6 dk). Eski bot kapatılacak. Onaylıyor musun?`;
    if (!window.confirm(metin)) return;
    setMesgul('gonder');
    try {
      await api.linkedinClaudeIs(seciliListe.map((a) => a.id), kuru);
      toast.success(durum?.ajan.canli ? 'İş açıldı — Mac 1 dakika içinde başlar' : 'İş açıldı — Mac servisi açılınca başlar');
      await Promise.all([durumYukle(), onDone()]);
    } catch (err: any) {
      toast.error(`Başlatılamadı: ${err.message}`);
    } finally {
      setMesgul(null);
    }
  };

  const iptal = async (id: string) => {
    if (!window.confirm('İş iptal edilsin mi? Sürmekte olan kişi bitince durur.')) return;
    setMesgul('iptal');
    try {
      await api.linkedinClaudeIptal(id);
      toast.success('İptal edildi');
      await durumYukle();
    } catch (err: any) {
      toast.error(`İptal edilemedi: ${err.message}`);
    } finally {
      setMesgul(null);
    }
  };

  const anahtarOlustur = async () => {
    if (durum?.anahtarVar && !window.confirm('Yeni anahtar oluşturulursa Mac\'teki eski anahtar geçersiz olur. Devam?')) return;
    setMesgul('anahtar');
    try {
      const { anahtar } = await api.linkedinClaudeAnahtar();
      setAnahtarKomutu(`mkdir -p ~/.ranksup && printf '%s' '${anahtar}' > ~/.ranksup/linkedin-claude.key && chmod 600 ~/.ranksup/linkedin-claude.key && echo "Anahtar yazıldı"`);
      await durumYukle();
    } catch (err: any) {
      toast.error(`Anahtar oluşturulamadı: ${err.message}`);
    } finally {
      setMesgul(null);
    }
  };

  const kopyala = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success('Kopyalandı'); } catch { toast.error('Kopyalanamadı — elle seç'); }
  };

  const ajan = durum?.ajan;

  return (
    <Card className="border-brand/40">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4" /> Claude ile gönderim
            </div>
            <div className="text-xs text-muted-foreground max-w-2xl">
              Listeyi ve notları kontrol et, &quot;Claude ile gönder&quot;e bas. İstekleri senin Mac&apos;inde, senin Chrome&apos;unda Claude gönderir;
              Claude aboneliğinin kotasından düşer, ayrıca ücret çıkmaz. Mac açık, Chrome&apos;da Claude eklentisi ve LinkedIn oturumu açık olmalı.
              Kabul kontrolü hafta içi 10:00, 14:00 ve 17:00&apos;de kendiliğinden yapılır; kabul edenler &quot;Bugün ilgilenilecekler&quot;e düşer.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={ajan?.canli ? 'success' : 'secondary'} className="gap-1">
              <Laptop className="h-3 w-3" />
              {ajan?.canli ? 'Mac servisi açık' : ajan?.sonGorulme ? `Mac servisi kapalı (son: ${saat(ajan.sonGorulme)})` : 'Mac servisi hiç bağlanmadı'}
            </Badge>
            <Button size="sm" variant="outline" onClick={anahtarOlustur} disabled={!!mesgul} title="Mac'teki servisin sunucuya bağlanma anahtarı">
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              {durum?.anahtarVar ? 'Anahtarı yenile' : 'Mac anahtarı oluştur'}
            </Button>
          </div>
        </div>

        {anahtarKomutu && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <div className="text-xs">
              Bu komutu <b>bir kez</b> Mac&apos;te Terminal&apos;e yapıştır. Anahtar bir daha gösterilmez; Mac servisi 1 dakika içinde bağlanır.
            </div>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded bg-background px-2 py-1.5 text-label font-mono">{anahtarKomutu}</code>
              <Button size="sm" variant="outline" onClick={() => kopyala(anahtarKomutu)}><Copy className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setAnahtarKomutu(null)} aria-label="Kapat"><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}

        {/* ── Suren / son isler ── */}
        {(durum?.isler ?? []).slice(0, 3).map((is) => (
          <div key={is.id} className={cn('rounded-md border p-3 space-y-2', (is.durum === 'BEKLIYOR' || is.durum === 'CALISIYOR') && 'border-brand/50 bg-brand/5')}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={is.durum === 'BITTI' ? 'success' : is.durum === 'HATA' ? 'danger' : is.durum === 'IPTAL' ? 'secondary' : 'info'}>
                {(is.durum === 'CALISIYOR' || is.durum === 'BEKLIYOR') && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                {IS_ETIKETI[is.durum]}
              </Badge>
              <span className="font-medium">{is.tur === 'KABUL' ? 'Kabul kontrolü' : is.kuru ? 'Kuru deneme' : 'Gerçek gönderim'}</span>
              <span className="text-muted-foreground">
                · {is.tur === 'KABUL'
                  ? `${is.kontrolEdilen ?? 0} kişi kontrol edildi${is.durum === 'BITTI' ? `, ${is.kisiler.length} kabul` : ''}`
                  : `${is.kisiler.length} kişi`}
                {' '}· açıldı {saat(is.createdAt)}{is.bittiAt ? ` · bitti ${saat(is.bittiAt)}` : ''}
                {is.maliyet > 0 && <span title="Claude kullanımı, API fiyatıyla karşılığı — abonelik kotasından düşer, ayrıca ödenmez"> · ≈{is.maliyet.toFixed(2)} USD kota</span>}
              </span>
              {(is.durum === 'BEKLIYOR' || is.durum === 'CALISIYOR') && (
                <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => iptal(is.id)} disabled={!!mesgul}>İptal</Button>
              )}
            </div>
            {is.hata && <div className="text-xs text-danger">{is.hata}</div>}
            {is.tur === 'KABUL' && is.durum === 'BITTI' && is.kisiler.length === 0 && (
              <div className="text-xs text-muted-foreground">Yeni kabul yok.</div>
            )}
            <ul className="space-y-1">
              {is.kisiler.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Bilinmeyen sonuc turu (sunucu yeni, sayfa eski) kartı cokertmesin: duz yazilir */}
                  {k.durum
                    ? <Badge variant={SONUC_ETIKETI[k.durum]?.variant ?? 'secondary'}>{SONUC_ETIKETI[k.durum]?.label ?? k.durum}</Badge>
                    : <Badge variant="outline">sırada</Badge>}
                  <span className="font-medium">{k.ad}</span>
                  {k.aciklama && <span className="text-muted-foreground">— {k.aciklama}</span>}
                  {k.at && <span className="text-muted-foreground">· {saat(k.at)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* ── Yeni gonderim ── */}
        {!aktifIs && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Bugün kalan istek: <b className="text-foreground">{aday?.kalanBugun ?? '—'}</b> · tek seferde en fazla {aday?.isTavani ?? 10} kişi
              </span>
              <input
                value={ara}
                onChange={(e) => setAra(e.target.value)}
                placeholder="Ad, firma ya da unvan ara"
                aria-label="Adaylarda ara"
                className="h-8 w-56 rounded-md border bg-background px-2.5 text-xs"
              />
              <span className="text-muted-foreground">{aday ? `${gorunen.length} / ${aday.adaylar.length} aday` : ''}</span>
              <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={kuru} onChange={(e) => setKuru(e.target.checked)} />
                Kuru deneme (&quot;Gönder&quot;e basmaz)
              </label>
              <Button size="sm" variant="ghost" onClick={adayYukle} disabled={!!mesgul}><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>

            {aday && aday.adaylar.length === 0 ? (
              <div className="text-sm text-muted-foreground">Kuyrukta gönderilecek kişi yok.</div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
                {gorunen.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 p-2.5">
                    <input type="checkbox" className="mt-1" checked={secili.has(a.id)} onChange={() => degistir(a.id)} aria-label={`${a.ad} ${a.soyad} seç`} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium">{a.ad} {a.soyad}</span>
                        <span className="text-xs text-muted-foreground">{a.firma}{a.unvan ? ` · ${a.unvan}` : ''}</span>
                        <a href={a.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 inline-flex items-center gap-0.5 hover:underline">
                          profil <ExternalLink className="h-3 w-3" />
                        </a>
                        {a.lastError && <Badge variant="warning" title={a.lastError}>önceki deneme hatalı</Badge>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAcikNot(acikNot === a.id ? null : a.id)}
                        className={cn('text-left text-xs text-muted-foreground', acikNot === a.id ? 'whitespace-pre-wrap' : 'line-clamp-1')}
                        title="Notun tamamı için tıkla"
                      >
                        {a.not}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={gonder} disabled={!!mesgul || seciliListe.length === 0 || (!kuru && (aday?.kalanBugun ?? 0) === 0)}>
                {mesgul === 'gonder' ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                Claude ile gönder ({seciliListe.length} kişi{kuru ? ', kuru' : ''})
              </Button>
              {!ajan?.canli && (
                <span className="text-xs text-muted-foreground">Mac servisi kapalıyken açılan iş, Mac bağlanınca başlar.</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
