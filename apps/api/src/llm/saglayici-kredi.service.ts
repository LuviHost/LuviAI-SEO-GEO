import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SAGLAYICI_DURUM_KV, durumOku, krediDurumu, type SaglayiciDurumKaydi } from '../audit/saglayici-durum.js';
import { KREDI_SAGLAYICILARI, dataforseoBakiye, deepseekBakiye, satirDurumu, type KrediSaglayici, type SatirDurumu } from './saglayici-kredi.js';

/** Bakiye uclarini her sayfa acilisinda cagirmamak icin (surec bellegi) */
const BAKIYE_ONBELLEK_MS = 5 * 60_000;
const ISTEK_ZAMAN_ASIMI_MS = 8_000;

interface Bakiye {
  usd: number | null;
  paraBirimi: string | null;
  kullanilabilir: boolean | null;
  hata: string | null;
  at: string;
}

export interface KrediSatiri {
  id: KrediSaglayici;
  ad: string;
  kullanim: string;
  yukleUrl: string;
  durum: SatirDurumu;
  anahtarVar: boolean;
  /** Bakiye API'si olanlarda */
  bakiye: { tutar: number | null; paraBirimi: string | null; hata: string | null; at: string } | null;
  sonBasari: string | null;
  sonKrediHatasi: string | null;
}

/**
 * Admin kredi tablosu (bkz. saglayici-kredi.ts). Anahtar degerleri ASLA donmez; yalniz var/yok.
 */
@Injectable()
export class SaglayiciKrediService {
  private readonly log = new Logger(SaglayiciKrediService.name);
  private onbellek = new Map<KrediSaglayici, Bakiye>();

  constructor(private readonly prisma: PrismaService) {}

  async tablo(opts: { tazele?: boolean } = {}): Promise<{ satirlar: KrediSatiri[]; at: string }> {
    const kayitlar = await this.prisma.kvStore
      .findMany({ where: { key: { startsWith: SAGLAYICI_DURUM_KV } } })
      .catch(() => [] as Array<{ key: string; value: string }>);
    const kayit = new Map<string, SaglayiciDurumKaydi>(
      kayitlar.map((k): [string, SaglayiciDurumKaydi] => [k.key.slice(SAGLAYICI_DURUM_KV.length), durumOku(k.value)]),
    );
    // Google AI Modu + AI Bakisi ayni DataForSEO hesabi
    const dfsKayit = [kayit.get('google_ai_mode'), kayit.get('google_ai_overview')].filter(Boolean);

    const [deepseek, dataforseo] = await Promise.all([
      this.bakiyeAl('deepseek', opts.tazele === true),
      this.bakiyeAl('dataforseo', opts.tazele === true),
    ]);
    const bakiyeler: Partial<Record<KrediSaglayici, Bakiye | null>> = { deepseek, dataforseo };

    const satirlar = KREDI_SAGLAYICILARI.map((t): KrediSatiri => {
      const anahtarVar = !!process.env[t.envAnahtari];
      const k = t.id === 'dataforseo'
        ? {
            sonBasari: dfsKayit.map((x) => x!.sonBasari).filter(Boolean).sort().pop(),
            sonKrediHatasi: dfsKayit.map((x) => x!.sonKrediHatasi).filter(Boolean).sort().pop(),
          }
        : kayit.get(t.id) ?? {};
      const b = bakiyeler[t.id] ?? null;
      return {
        id: t.id,
        ad: t.ad,
        kullanim: t.kullanim,
        yukleUrl: t.yukleUrl,
        anahtarVar,
        durum: satirDurumu({
          anahtarVar,
          kayit: krediDurumu(k),
          bakiyeUsd: b && !b.hata && (b.paraBirimi === null || b.paraBirimi === 'USD') ? b.usd : null,
          bakiyeKullanilabilir: b?.kullanilabilir ?? null,
        }),
        bakiye: b ? { tutar: b.usd, paraBirimi: b.paraBirimi, hata: b.hata, at: b.at } : null,
        sonBasari: k.sonBasari ?? null,
        sonKrediHatasi: k.sonKrediHatasi ?? null,
      };
    });
    return { satirlar, at: new Date().toISOString() };
  }

  private async bakiyeAl(id: 'deepseek' | 'dataforseo', tazele: boolean): Promise<Bakiye | null> {
    const env = KREDI_SAGLAYICILARI.find((t) => t.id === id)!.envAnahtari;
    const anahtar = process.env[env];
    if (!anahtar) return null;
    const eski = this.onbellek.get(id);
    if (!tazele && eski && Date.now() - Date.parse(eski.at) < BAKIYE_ONBELLEK_MS) return eski;
    const at = new Date().toISOString();
    let sonuc: Bakiye;
    try {
      if (id === 'deepseek') {
        const r = await fetch('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${anahtar}` },
          signal: AbortSignal.timeout(ISTEK_ZAMAN_ASIMI_MS),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = deepseekBakiye(await r.json());
        sonuc = { usd: d.bakiye, paraBirimi: d.paraBirimi, kullanilabilir: d.kullanilabilir, hata: null, at };
      } else {
        // Ucretsiz uc (docs.dataforseo.com/v3/appendix/user_data); anahtar zaten base64 "login:parola"
        const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
          headers: { Authorization: `Basic ${anahtar}` },
          signal: AbortSignal.timeout(ISTEK_ZAMAN_ASIMI_MS),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        sonuc = { usd: dataforseoBakiye(await r.json()), paraBirimi: 'USD', kullanilabilir: null, hata: null, at };
      }
    } catch (err: any) {
      // Hata metni anahtar icermez (yalniz durum kodu / zaman asimi)
      const mesaj = err?.name === 'TimeoutError' ? 'zaman aşımı' : String(err?.message ?? 'bilinmeyen hata').slice(0, 80);
      this.log.warn(`${id} bakiyesi alinamadi: ${mesaj}`);
      sonuc = { usd: null, paraBirimi: null, kullanilabilir: null, hata: mesaj, at };
    }
    this.onbellek.set(id, sonuc);
    return sonuc;
  }
}
