import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PromptCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePromptDto {
  name: string;
  description?: string;
  category?: PromptCategory;
  body: string;
  variables?: any;
  siteId?: string | null;
  isPublic?: boolean;
  tags?: string[];
  language?: string;
  icon?: string;
}

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, filters: { siteId?: string; category?: string; q?: string; mine?: boolean; publicOnly?: boolean }) {
    const where: Prisma.PromptTemplateWhereInput = {};

    if (filters.publicOnly) {
      where.isPublic = true;
    } else if (filters.mine) {
      where.userId = userId;
    } else {
      // Default: kullanıcının kendi prompt'ları + public olanlar
      where.OR = [{ userId }, { isPublic: true }];
    }

    if (filters.siteId) {
      where.OR = [{ siteId: filters.siteId }, { siteId: null }];
    }
    if (filters.category) {
      where.category = filters.category as PromptCategory;
    }
    if (filters.q) {
      const q = filters.q;
      where.OR = [
        { name: { contains: q } },
        { description: { contains: q } },
      ];
    }

    return this.prisma.promptTemplate.findMany({
      where,
      orderBy: [
        { isFeatured: 'desc' },
        { upvotes: 'desc' },
        { usageCount: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 200,
    });
  }

  async getOne(id: string, userId: string) {
    const p = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Prompt bulunamadı');
    if (!p.isPublic && p.userId !== userId) {
      throw new ForbiddenException('Bu prompta erişimin yok');
    }
    return p;
  }

  async create(userId: string, dto: CreatePromptDto) {
    if (!dto.name?.trim()) throw new BadRequestException('İsim zorunlu');
    if (!dto.body?.trim()) throw new BadRequestException('Prompt body zorunlu');

    // Body'den {{variable}} otomatik çıkar — kullanıcı manuel listemediyse
    const variables = dto.variables ?? this.extractVariables(dto.body);

    return this.prisma.promptTemplate.create({
      data: {
        userId,
        siteId: dto.siteId ?? null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category ?? PromptCategory.GENERAL,
        body: dto.body,
        variables: variables as any,
        isPublic: dto.isPublic ?? false,
        tags: (dto.tags ?? []) as any,
        language: dto.language ?? 'tr',
        icon: dto.icon ?? null,
      },
    });
  }

  async update(id: string, userId: string, dto: Partial<CreatePromptDto>) {
    const p = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Prompt bulunamadı');
    if (p.userId !== userId) throw new ForbiddenException('Sadece sahibi düzenleyebilir');

    const variables = dto.body
      ? (dto.variables ?? this.extractVariables(dto.body))
      : (dto.variables ?? p.variables);

    return this.prisma.promptTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? p.name,
        description: dto.description ?? p.description,
        category: (dto.category ?? p.category) as PromptCategory,
        body: dto.body ?? p.body,
        variables: variables as any,
        isPublic: dto.isPublic ?? p.isPublic,
        tags: (dto.tags ?? p.tags) as any,
        language: dto.language ?? p.language,
        icon: dto.icon ?? p.icon,
        siteId: dto.siteId === undefined ? p.siteId : dto.siteId,
      },
    });
  }

  async remove(id: string, userId: string) {
    const p = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Prompt bulunamadı');
    if (p.userId !== userId) throw new ForbiddenException('Sadece sahibi silebilir');
    await this.prisma.promptTemplate.delete({ where: { id } });
    return { ok: true };
  }

  async use(id: string, userId: string, variables: Record<string, string>) {
    const p = await this.getOne(id, userId);

    // Body içine variable'ları substitue et
    let rendered = p.body;
    for (const [key, value] of Object.entries(variables ?? {})) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }

    // Usage tracking
    await this.prisma.promptTemplate.update({
      where: { id },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    return { rendered, prompt: p };
  }

  async upvote(id: string, userId: string) {
    const p = await this.getOne(id, userId);
    if (!p.isPublic) throw new BadRequestException('Sadece public promptlara oy verilebilir');
    return this.prisma.promptTemplate.update({
      where: { id },
      data: { upvotes: { increment: 1 } },
    });
  }

  async clone(id: string, userId: string) {
    const source = await this.getOne(id, userId);
    return this.prisma.promptTemplate.create({
      data: {
        userId,
        siteId: null,
        name: `${source.name} (kopya)`,
        description: source.description,
        category: source.category,
        body: source.body,
        variables: source.variables as any,
        isPublic: false,
        tags: source.tags as any,
        language: source.language,
        icon: source.icon,
      },
    });
  }

  /** Kullanıcının ilk girişinde seed: 8 hazır şablon. Idempotent (zaten varsa atlar). */
  async seedDefaults(userId: string) {
    const count = await this.prisma.promptTemplate.count({ where: { userId } });
    if (count > 0) return { ok: true, skipped: true };

    const templates: CreatePromptDto[] = [
      {
        name: 'SEO Makale — Hosting Karşılaştırma',
        description: 'İki hosting sağlayıcısını karşılaştıran, 1800-2500 kelime kapsamlı SEO makalesi.',
        category: PromptCategory.COMPARISON,
        icon: 'GitCompare',
        tags: ['hosting', 'karşılaştırma', 'seo'],
        body: `{{provider_a}} vs {{provider_b}} karşılaştırması yap. 1800-2500 kelime, Türkçe, SEO uyumlu.
Yapı:
- H1: Anahtar kelimeyi içeren başlık
- Giriş (60-100 kelime)
- Hızlı Cevap kutusu (40-60 kelime)
- 5 H2 bölüm: Fiyat, Performans, Destek, Özellikler, Sonuç
- FAQ bölümü (5 soru)
- CTA

Hedef kelime: {{keyword}}
Hedef kitle: {{audience}}`,
      },
      {
        name: 'Yerel İşletme Blog Yazısı',
        description: '{{city}} odaklı yerel SEO blog yazısı.',
        category: PromptCategory.ARTICLE,
        icon: 'MapPin',
        tags: ['yerel-seo', 'kobi'],
        body: `{{city}} merkezli {{business_type}} işletmeler için "{{topic}}" konulu blog yazısı yaz.
1500-2000 kelime. Türkçe. Yerel SEO için "{{city}}", "{{neighborhood}}" anahtar kelimeleri doğal şekilde 4-6 kez geçsin.
Yapı: Giriş → Sorun → Çözüm → 3 yerel örnek → Sıkça Sorulan Sorular → İletişim CTA.`,
      },
      {
        name: 'E-Ticaret Kategori Sayfası',
        description: 'Ürün kategorisi için SEO optimize landing copy.',
        category: PromptCategory.LANDING_PAGE,
        icon: 'ShoppingCart',
        tags: ['e-ticaret', 'kategori'],
        body: `{{product_category}} kategorisi için landing page metni yaz.
- H1: SEO friendly, anahtar kelimeli başlık
- Üst kopya: 100-150 kelime, ürün grubu özeti
- 5-7 alt kategori önerisi (H2)
- Avantajlar listesi
- 3 müşteri sorusu + cevap (FAQ)
- Aşağı kopya: 200 kelime, semantik SEO için "long-tail" varyantlar
Hedef kelime: {{keyword}}
Marka: {{brand}}`,
      },
      {
        name: 'LinkedIn Şirket Postu — Düşünce Liderliği',
        description: 'Sektörde yetkin görünmek için LinkedIn postu.',
        category: PromptCategory.SOCIAL_POST,
        icon: 'Linkedin',
        tags: ['linkedin', 'sosyal'],
        body: `LinkedIn şirket sayfası için düşünce liderliği postu yaz. Türkçe, 800-1300 karakter.
Konu: {{topic}}
Yapı:
- Hook (1 satır, sorulu/itirazlı)
- Bağlam (2-3 satır)
- 3-5 madde insight
- Soru ile bitir (engagement için)

Marka tonu: {{tone}}
Sektör: {{industry}}`,
      },
      {
        name: 'Meta Description — Yüksek CTR',
        description: 'Tıklamayı maksimize eden 150-160 karakter meta description.',
        category: PromptCategory.META_DESCRIPTION,
        icon: 'Search',
        tags: ['meta', 'ctr', 'seo'],
        body: `Sayfa başlığı: "{{title}}"
Sayfa konusu: {{topic}}
Hedef anahtar kelime: {{keyword}}

150-160 karakter arası meta description yaz. Türkçe. Şu kuralları uygula:
- Anahtar kelime başta
- Bir aksiyon fiili (öğren, keşfet, karşılaştır vb.)
- Bir somut sayı veya rakam
- CTA ile bitir

3 farklı varyant üret.`,
      },
      {
        name: 'Reklam Metni — Google Search Ads',
        description: 'Google Ads için 3 başlık + 2 description varyantı.',
        category: PromptCategory.AD_COPY,
        icon: 'Megaphone',
        tags: ['google-ads', 'reklam'],
        body: `Ürün/Hizmet: {{product}}
Hedef kitle: {{audience}}
USP (öne çıkan özellik): {{usp}}
Hedef anahtar kelime: {{keyword}}

Google Search Ads için yaz:
- 3 farklı Headline (her biri 30 karakter altı)
- 2 farklı Description (her biri 90 karakter altı)
- Türkçe, doğal, click-bait olmadan
- Her başlıkta anahtar kelime veya yakın varyantı geçmeli`,
      },
      {
        name: 'How-To Rehber Yazısı',
        description: 'Adım adım rehber, HowTo schema için ideal.',
        category: PromptCategory.HOWTO,
        icon: 'ListChecks',
        tags: ['rehber', 'howto'],
        body: `"{{action}}" konulu adım adım rehber yaz. 1500-2200 kelime, Türkçe.

Yapı:
- H1: "Nasıl {{action}}? Adım Adım Rehber {{year}}"
- Giriş (60-100 kelime, problem-vaat-pivot)
- Hızlı Cevap özeti (40-60 kelime)
- "Başlamadan Önce Gerekenler" H2 listesi
- 5-8 numaralı adım (her biri H2, kendi içinde 100-200 kelime)
- "Yaygın Hatalar" H2 bölümü
- FAQ (4-6 soru)

Hedef kitle: {{audience}}`,
      },
      {
        name: 'FAQ — Ürün Sayfası',
        description: 'Ürün sayfası için yapılandırılmış FAQ schema dostu.',
        category: PromptCategory.FAQ,
        icon: 'HelpCircle',
        tags: ['faq', 'schema'],
        body: `{{product}} için 6-8 SSS yaz. Her soru-cevap çifti FAQ Schema'ya uygun olsun.

Sorular hem alıcının itirazlarını hem de pratik kullanım sorularını kapsasın:
- Fiyat / değer (1 soru)
- Teknik özellik (2 soru)
- Karşılaştırma rakipler (1 soru)
- Garanti / iade (1 soru)
- Kullanım şekli (1-2 soru)
- KVKK/güvenlik (1 soru, varsa)

Her cevap 60-120 kelime. Doğal Türkçe. Anahtar kelime: {{keyword}}.`,
      },
    ];

    for (const t of templates) {
      await this.prisma.promptTemplate.create({
        data: {
          userId,
          name: t.name,
          description: t.description,
          category: t.category!,
          body: t.body,
          variables: this.extractVariables(t.body) as any,
          tags: (t.tags ?? []) as any,
          icon: t.icon,
          language: 'tr',
        },
      });
    }

    return { ok: true, seeded: templates.length };
  }

  private extractVariables(body: string): Array<{ name: string; label: string; type: string }> {
    const matches = body.matchAll(/\{\{(\w+)\}\}/g);
    const seen = new Set<string>();
    const vars: Array<{ name: string; label: string; type: string }> = [];
    for (const m of matches) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      // Long-form variables → textarea
      const type = ['body', 'content', 'description', 'topic'].includes(name) ? 'textarea' : 'text';
      vars.push({ name, label, type });
    }
    return vars;
  }
}
