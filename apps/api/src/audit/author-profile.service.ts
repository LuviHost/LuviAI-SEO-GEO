import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeParseJson } from '../common/safe-json.js';

export interface AuthorProfile {
  name: string;
  jobTitle: string;
  worksFor: string;
  bio: string;
  expertise: string[];
  yearsOfExperience: number;
  sameAs: string[]; // LinkedIn, Twitter, vs.
  schemaJsonLd: any;
  evidenceMarkdown: string; // makalenin sonuna eklenecek imza bloğu
}

/**
 * Sitenin GERCEK yazari (site sahibinin girdigi). Uretim hatti makalenin
 * JSON-LD author'unu ve gorunur "Bu makale ... tarafindan hazirlandi" satirini
 * YALNIZ bundan uretir. Kayit yoksa author Organization kalir (bugunku davranis).
 *
 * NEDEN buildForPersona kullanilmiyor: persona okuyucu profilidir (hedef kitle),
 * yazar degil; ustelik eksik biyografiyi modelle URETIYOR. Uydurma kisiyi Person
 * olarak yayinlamak schema.org acisindan yanlis beyan olur.
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
 * Author Profile (E-E-A-T) — her makalenin yazar imzasi icin Person schema
 * uretir. Google ve AI'lar yazarin uzmanligini bu sayede dogrular.
 *
 * Each persona icin tek seferde uretilip site brain'e cache'lenir.
 */
@Injectable()
export class AuthorProfileService {
  private readonly log = new Logger(AuthorProfileService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

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

  /**
   * Site brain'deki persona icin yazar profili uret.
   */
  async buildForPersona(siteId: string, personaName: string): Promise<AuthorProfile> {
    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const brand = site.name;
    const niche = site.niche ?? 'sektor';
    const baseUrl = site.url.replace(/\/+$/, '');
    const brain: any = site.brain ?? {};
    const personas: any[] = Array.isArray(brain.personas) ? brain.personas : [];
    const persona = personas.find((p) => p.name === personaName) ?? { name: personaName };

    // AI bio uret (yoksa)
    let bio = persona.bio ?? '';
    let expertise: string[] = persona.expertise ?? [];
    let years = persona.years ?? 5;

    if ((!bio || expertise.length === 0) && this.anthropic) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-opus-5',
          max_tokens: 4000,
          system: 'Sen yazar profili olusturucusun. Verilen persona icin kisa, gercekci, abartisiz bir biyografi yazarsin. JSON dondur.',
          messages: [{
            role: 'user',
            content: `Persona: ${personaName}\nMarka: ${brand}\nSektor: ${niche}\n\n3-4 cumlelik 1.tekil biyografi (Turkce). Uzmanlik 3-5 alan. Tecrube yili 3-15 arasi makul rakam.\n\nJSON: {"bio": "...", "expertise": ["...","..."], "years": 7}`,
          }],
        });
        const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = safeParseJson(match[0]);
          bio = parsed.bio ?? bio;
          expertise = parsed.expertise ?? expertise;
          years = parsed.years ?? years;
        }
      } catch (err: any) {
        this.log.warn(`Author bio AI fail: ${err.message}`);
      }
    }

    if (!bio) {
      bio = `${personaName}, ${brand} bünyesinde ${niche} alanında çalışan deneyimli bir profesyoneldir.`;
    }
    if (expertise.length === 0) {
      expertise = [niche, 'içerik üretimi', 'müşteri deneyimi'];
    }

    const sameAs: string[] = persona.sameAs ?? [];
    const personaSlug = personaName.toLowerCase()
      .replace(/[ğ]/g, 'g').replace(/[ü]/g, 'u').replace(/[ş]/g, 's')
      .replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const profileUrl = `${baseUrl}/yazar/${personaSlug}`;

    const schemaJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: personaName,
      url: profileUrl,
      description: bio,
      jobTitle: `${niche} uzmanı`,
      worksFor: { '@type': 'Organization', name: brand, url: baseUrl },
      knowsAbout: expertise,
      ...(sameAs.length > 0 ? { sameAs } : {}),
    };

    const evidenceMarkdown = `

---

**${personaName}** — ${niche} alanında ${years}+ yıl deneyimli, ${brand} bünyesinde içerik uzmanı.
Uzmanlık alanları: ${expertise.slice(0, 4).join(' · ')}
${sameAs.length > 0 ? '\n[Profesyonel profil](' + sameAs[0] + ')' : ''}

*Bu makale ${new Date().toLocaleDateString('tr-TR')} tarihinde yayınlandı.*
`;

    return {
      name: personaName,
      jobTitle: `${niche} uzmanı`,
      worksFor: brand,
      bio,
      expertise,
      yearsOfExperience: years,
      sameAs,
      schemaJsonLd,
      evidenceMarkdown,
    };
  }
}
