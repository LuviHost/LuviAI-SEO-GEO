import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SAGLAYICI_DURUM_KV, durumOku, krediDurumu, saglayiciKontrolKaydet, type SaglayiciDurumKaydi } from '../audit/saglayici-durum.js';
import { isBillingProviderError } from '../audit/probe-retry.js';
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
  /** Elle kontrolde kredi disi hata (gecersiz anahtar, model yok...) */
  sonKontrolHatasi: string | null;
  sonKontrolHatasiAt: string | null;
}

/** Elle kontrolde saglayiciya atilan en kucuk istek (5-16 token; Perplexity istek ucreti ~0,005 USD) */
const PING_ZAMAN_ASIMI_MS = 20_000;

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
      const k: SaglayiciDurumKaydi = t.id === 'dataforseo'
        ? {
            sonBasari: dfsKayit.map((x) => x!.sonBasari).filter(Boolean).sort().pop(),
            sonKrediHatasi: dfsKayit.map((x) => x!.sonKrediHatasi).filter(Boolean).sort().pop(),
          }
        : kayit.get(t.id) ?? {};
      const kontrolHatasiGuncel = !!k.sonKontrolHatasiAt
        && (!k.sonBasari || Date.parse(k.sonKontrolHatasiAt) > Date.parse(k.sonBasari));
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
          kontrolHatasiGuncel,
        }),
        bakiye: b ? { tutar: b.usd, paraBirimi: b.paraBirimi, hata: b.hata, at: b.at } : null,
        sonBasari: k.sonBasari ?? null,
        sonKrediHatasi: k.sonKrediHatasi ?? null,
        sonKontrolHatasi: kontrolHatasiGuncel ? k.sonKontrolHatasi ?? null : null,
        sonKontrolHatasiAt: kontrolHatasiGuncel ? k.sonKontrolHatasiAt ?? null : null,
      };
    });
    return { satirlar, at: new Date().toISOString() };
  }

  /**
   * "Şimdi kontrol et": havuz anahtariyla her saglayiciya en kucuk istegi atar, sonucu kaydeder
   * (kredi bitti / calisiyor / kontrol hatasi). Bakiyeleri de tazeler. Yalniz elle — zamanlayici
   * ping atmaz (Perplexity istek ucreti saatlik denemede ayda birkac dolar ederdi).
   */
  async kontrolEt(): Promise<{ satirlar: KrediSatiri[]; at: string }> {
    const hedefler = KREDI_SAGLAYICILARI.filter((t) => t.id !== 'dataforseo' && !!process.env[t.envAnahtari]);
    await Promise.all(hedefler.map(async (t) => {
      const sonuc = await this.ping(t.id, process.env[t.envAnahtari]!);
      await saglayiciKontrolKaydet(this.prisma, t.id, sonuc);
      if (sonuc.tur !== 'ok') this.log.warn(`${t.id} kontrolu: ${sonuc.tur} — ${sonuc.mesaj ?? ''}`);
    }));
    return this.tablo({ tazele: true });
  }

  /** Tek saglayiciya en kucuk istek. Hata metni anahtar icermez (yalniz durum kodu + saglayici mesaji). */
  private async ping(id: KrediSaglayici, anahtar: string): Promise<{ tur: 'ok' | 'kredi' | 'hata'; mesaj?: string }> {
    type Istek = { url: string; headers: Record<string, string>; body: unknown };
    const sohbet = (url: string, model: string): Istek => ({
      url,
      headers: { Authorization: `Bearer ${anahtar}`, 'Content-Type': 'application/json' },
      body: { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] },
    });
    const istek: Istek | null = ((): Istek | null => {
      switch (id) {
        case 'anthropic': return {
          url: 'https://api.anthropic.com/v1/messages',
          headers: { 'x-api-key': anahtar, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: { model: process.env.ANTHROPIC_CITATION_MODEL_STANDARD ?? 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] },
        };
        case 'gemini': {
          const model = process.env.GEMINI_CITATION_MODEL ?? 'gemini-3.5-flash-lite';
          return {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            headers: { 'x-goog-api-key': anahtar, 'Content-Type': 'application/json' },
            body: { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 16 } },
          };
        }
        case 'openai': return sohbet('https://api.openai.com/v1/chat/completions', process.env.OPENAI_CITATION_MODEL_STANDARD ?? 'gpt-6-luna');
        case 'perplexity': return sohbet('https://api.perplexity.ai/chat/completions', 'sonar');
        case 'xai': return sohbet('https://api.x.ai/v1/chat/completions', process.env.XAI_CITATION_MODEL ?? 'grok-4.7');
        case 'deepseek': return sohbet('https://api.deepseek.com/chat/completions', process.env.DEEPSEEK_CITATION_MODEL ?? 'deepseek-v4-pro');
        case 'meta': return {
          url: 'https://api.meta.ai/v1/responses',
          headers: { Authorization: `Bearer ${anahtar}`, 'Content-Type': 'application/json' },
          body: { model: process.env.META_CITATION_MODEL ?? 'muse-spark-1.3', input: 'ping', max_output_tokens: 16 },
        };
        default: return null;
      }
    })();
    if (!istek) return { tur: 'hata', mesaj: 'kontrol tanımlı değil' };
    try {
      const r = await fetch(istek.url, {
        method: 'POST',
        headers: istek.headers,
        body: JSON.stringify(istek.body),
        signal: AbortSignal.timeout(PING_ZAMAN_ASIMI_MS),
      });
      if (r.ok) return { tur: 'ok' };
      const govde = (await r.text().catch(() => '')).replace(/\s+/g, ' ');
      const err = Object.assign(new Error(`HTTP ${r.status}: ${govde.slice(0, 300)}`), { status: r.status });
      // Kredi hatasi probe-retry.ts ile ayni kural (402, "credit balance is too low", insufficient_quota...)
      if (isBillingProviderError(err)) return { tur: 'kredi', mesaj: `HTTP ${r.status}` };
      return { tur: 'hata', mesaj: `HTTP ${r.status}: ${govde.slice(0, 120)}` };
    } catch (err: any) {
      return { tur: 'hata', mesaj: err?.name === 'TimeoutError' ? 'zaman aşımı' : String(err?.message ?? err).slice(0, 120) };
    }
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
