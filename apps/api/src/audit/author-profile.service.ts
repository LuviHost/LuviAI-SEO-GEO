import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

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
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 350,
          system: 'Sen yazar profili olusturucusun. Verilen persona icin kisa, gercekci, abartisiz bir biyografi yazarsin. JSON dondur.',
          messages: [{
            role: 'user',
            content: `Persona: ${personaName}\nMarka: ${brand}\nSektor: ${niche}\n\n3-4 cumlelik 1.tekil biyografi (Turkce). Uzmanlik 3-5 alan. Tecrube yili 3-15 arasi makul rakam.\n\nJSON: {"bio": "...", "expertise": ["...","..."], "years": 7}`,
          }],
        });
        const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
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
