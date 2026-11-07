import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Sitenin GERCEK yazari (site sahibinin girdigi). Uretim hatti makalenin
 * JSON-LD author'unu ve gorunur "Bu makale ... tarafindan hazirlandi" satirini
 * YALNIZ bundan uretir. Kayit yoksa author Organization kalir (bugunku davranis).
 *
 * buildForPersona KALDIRILDI (08.11.2026): persona okuyucu profilidir (hedef
 * kitle), yazar degil; ustelik eksik biyografi, uzmanlik ve tecrube yilini
 * modelle URETIYORDU. Google uydurma yazar profilini aldatma sayar
 * ("Fabricating creator profiles ... is a form of deception"). Bu serviste
 * hicbir alan uretilmez; yalniz site sahibinin girdigi ad, unvan ve adresler
 * dogrulanip saklanir.
 *
 * Saklama: kv_store 'site-author:<siteId>' (JSON). Yeni kolon/migration yok;
 * brain'e konmadi cunku brain yeniden uretilince brandVoice ezilir.
 */
export interface SiteAuthor {
  name: string;
  url?: string;
  sameAs?: string[];
  jobTitle?: string;
}

export const SITE_AUTHOR_KV_PREFIX = 'site-author:';

function cleanHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Saklanan / gelen degeri dogrular; ad yoksa null (yazar yok sayilir). */
export function normalizeSiteAuthor(raw: unknown): SiteAuthor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // Ad yazar prompt'una ve gorunur satira girer: satir sonu ve markdown/HTML isaretleri atilir
  const name = typeof r.name === 'string' ? r.name.replace(/[[\]*_`<>#|\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!name) return null;
  const url = cleanHttpUrl(r.url);
  const sameAs = Array.isArray(r.sameAs)
    ? Array.from(new Set(r.sameAs.map(cleanHttpUrl).filter((x): x is string => !!x))).slice(0, 10)
    : [];
  const jobTitle = typeof r.jobTitle === 'string' ? r.jobTitle.replace(/[[\]*_`<>#|\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return {
    name,
    ...(url ? { url } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(jobTitle ? { jobTitle } : {}),
  };
}

interface KvReader {
  kvStore?: { findUnique: (args: any) => Promise<{ value: string } | null> };
}

/**
 * Sitenin kayitli gercek yazari; yoksa / okunamazsa null. Hata uretimi durdurmaz
 * (yazar yoksa Organization'a dusulur).
 */
export async function readSiteAuthor(prisma: KvReader, siteId: string): Promise<SiteAuthor | null> {
  try {
    const row = await prisma.kvStore?.findUnique({ where: { key: `${SITE_AUTHOR_KV_PREFIX}${siteId}` } });
    if (!row?.value) return null;
    return normalizeSiteAuthor(JSON.parse(row.value));
  } catch {
    return null;
  }
}

/**
 * Site yazari kaydi: okuma / kaydetme / silme. Model cagrisi yok; Person
 * semasi yalniz site sahibi yazar bilgisini girdiyse (pipeline.service) uretilir.
 */
@Injectable()
export class AuthorProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sitenin kayitli gercek yazari (yoksa null) */
  getSiteAuthor(siteId: string): Promise<SiteAuthor | null> {
    return readSiteAuthor(this.prisma, siteId);
  }

  /** Gercek yazari kaydeder; adsiz / gecersiz girdi 400 */
  async setSiteAuthor(siteId: string, input: unknown): Promise<SiteAuthor> {
    const author = normalizeSiteAuthor(input);
    if (!author) throw new BadRequestException('Yazar adı zorunlu.');
    const key = `${SITE_AUTHOR_KV_PREFIX}${siteId}`;
    const value = JSON.stringify(author);
    await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
    return author;
  }

  /** Yazar kaydini siler: sonraki makalelerde author yeniden Organization olur */
  async clearSiteAuthor(siteId: string): Promise<{ author: null }> {
    await this.prisma.kvStore.deleteMany({ where: { key: `${SITE_AUTHOR_KV_PREFIX}${siteId}` } });
    return { author: null };
  }
}
