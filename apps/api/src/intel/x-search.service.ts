import { Injectable, Logger } from '@nestjs/common';
import { parseJsonFromLlm } from '../common/safe-json.js';
import type { RawItem } from './collector.service.js';

/**
 * X (Twitter) toplayici — xAI Live Search uzerinden.
 *
 * NEDEN GROK: X'in kendi API'sinde arama ucu ucretli katmanda ve kota
 * dar. xAI'nin Live Search'u ayni canli X indeksini chat completions
 * istegine ILISTIRILEN bir arama parametresiyle acar; tek anahtarla hem
 * arama hem ozetleme yapilir.
 *
 * NEDEN JSON ISTIYORUZ: sadece citations dizisini alsak elimizde ciplak
 * URL'ler kalirdi — triage'in calisabilmesi icin baslik/ozet/yazar gerek.
 * Grok'tan yapilandirilmis liste isteyip citations'i DOGRULAMA icin
 * kullaniyoruz: modelin uydurdugu, aramada gecmeyen bir URL elenir.
 *
 * ANAHTAR YOKSA: sessizce bos doner. X kaynaklari katalogda kalir,
 * sistemin geri kalani XAI_API_KEY olmadan da tam calisir.
 */

const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4';
const TIMEOUT_MS = 60_000;
/** Sorgu basina en fazla kac post — maliyet ve gurultu freni */
const MAX_RESULTS = 20;
/** Kac gun geriye bakilir; gunluk cekim icin 2 gun guvenli ust sinir */
const LOOKBACK_DAYS = 2;

const SYSTEM_PROMPT = `Sen bir arama asistanisin. Verilen sorguyla ilgili GERCEK X (Twitter) paylasimlarini bul ve YALNIZCA JSON dizisi dondur.

Kurallar:
- Sadece aramada gercekten bulunan paylasimlari listele. Hicbir sey uydurma.
- Reklam, is ilani, jenerik motivasyon icerigi ve "thread yazdim, linke tikla" tarzi tanitim postlarini ATLA.
- Veri, olcum, test sonucu, platform degisikligi veya somut deneyim iceren paylasimlari tercih et.
- Ilgili paylasim yoksa bos dizi dondur: []

Cikti bicimi (baska hicbir metin yazma):
[
  {
    "url": "https://x.com/kullanici/status/123",
    "author": "@kullanici",
    "title": "paylasimin ozunu veren tek cumle",
    "summary": "paylasimin icerigi, 2-3 cumle",
    "publishedAt": "2026-08-10",
    "engagement": 250
  }
]`;

@Injectable()
export class XSearchService {
  private readonly log = new Logger(XSearchService.name);
  private warnedNoKey = false;

  get enabled(): boolean {
    return !!process.env.XAI_API_KEY;
  }

  async search(query: string): Promise<RawItem[]> {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      if (!this.warnedNoKey) {
        this.log.warn('XAI_API_KEY yok — X kaynaklari atlaniyor');
        this.warnedNoKey = true;
      }
      return [];
    }

    const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const res = await fetch(XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: process.env.XAI_MODEL ?? DEFAULT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Sorgu: ${query}` },
        ],
        search_parameters: {
          mode: 'on',
          sources: [{ type: 'x' }],
          from_date: fromDate,
          max_search_results: MAX_RESULTS,
          return_citations: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`xAI HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) return [];

    let parsed: any[];
    try {
      parsed = parseJsonFromLlm<any[]>(content);
    } catch (err: any) {
      this.log.warn(`xAI yaniti JSON'a cevrilemedi (${query}): ${err.message}`);
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    // Citations = aramanin GERCEKTEN dokundugu adresler. Modelin bunun
    // disinda urettigi her sey halusinasyon adayidir.
    const citations: string[] = Array.isArray(json?.citations) ? json.citations : [];
    const citedIds = new Set(citations.map(statusIdOf).filter(Boolean) as string[]);

    const out: RawItem[] = [];
    for (const p of parsed) {
      const url = typeof p?.url === 'string' ? p.url.trim() : '';
      const title = typeof p?.title === 'string' ? p.title.trim() : '';
      if (!url || !title) continue;
      if (!/(^https?:\/\/)?(www\.)?(x|twitter)\.com\//i.test(url)) continue;

      // Citations geldiyse dogrulama uygula; xAI citations dondurmediyse
      // (parametre desteklenmiyor/bos) eleme yapma, aksi halde tum
      // sonuclari kaybederiz.
      if (citedIds.size > 0) {
        const id = statusIdOf(url);
        if (!id || !citedIds.has(id)) continue;
      }

      out.push({
        url,
        title,
        author: typeof p?.author === 'string' ? p.author : null,
        publishedAt: p?.publishedAt ? safeDate(p.publishedAt) : null,
        summary: typeof p?.summary === 'string' ? p.summary : null,
        engagement: Number.isFinite(p?.engagement) ? Number(p.engagement) : null,
        meta: { via: 'xai-live-search', query },
      });
    }

    return out;
  }
}

/** x.com/u/status/123 → "123". Alan adi ve sorgu parametreleri degisken, id sabit. */
function statusIdOf(url: string): string | null {
  const m = /(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i.exec(url);
  return m ? m[1] : null;
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
