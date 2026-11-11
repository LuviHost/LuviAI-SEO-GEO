'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2, Cloud, Globe, Palette, PenLine, ShoppingCart, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { VitrinBand, VitrinHero, VITRIN_CELL, VITRIN_GRID } from '@/components/vitrin/vitrin-page';

// Maddeler plans.ts ile dogrulandi (Ekim 2026). Eskiden "Faz 3" yol haritasi
// vaatleri (white-label panel, SLA'li kurumsal plan), calismayan white-label /
// ozel alan adi ve dayanaksiz "KKB + ETBIS uyumlu icerik", "haftada 50+ makale"
// (Ajans plani ayda 100) yaziyordu. WooCommerce'e ayri bir REST hedefi yok;
// yayin WordPress REST hedefiyle yapilir. Kurumsal kartindaki "Ozel hesap
// yoneticisi + SLA, sozlesmeli kurulum" maddesi de kaldirildi (30.10.2026):
// kodda ve operasyonda karsiligi yoktu.
const USE_CASES = {
  tr: {
    eyebrow: '🎯 Kullanım Senaryoları',
    titleA: 'Senin sektörüne',
    titleB: 'özel akış',
    subtitle: 'Sitenizin tipine göre RanksUp nasıl yardım eder?',
    items: [
      {
        icon: '🛒',
        title: 'E-ticaret',
        bullets: [
          'Ürün Radarı — haftalık rakip ses payı ve kategori sırası (Ajans planı)',
          'Ürün karşılaştırma blogları (organic traffic)',
          'WordPress / WooCommerce sitelerine WordPress REST ile otomatik yayın',
          'Sezonsal kampanya yazıları (Black Friday, Sevgililer Günü)',
        ],
        cta: 'E-ticaret için başla',
      },
      {
        icon: '☁️',
        title: 'SaaS',
        bullets: [
          'Documentation + tutorial otomasyonu',
          'Long-tail "X nasıl yapılır" içerik',
          'Use case sayfaları (her sektör için ayrı)',
          'Comparison ("X vs Competitor") sayfaları',
        ],
        cta: 'SaaS için başla',
      },
      {
        icon: '🎨',
        title: 'Ajans',
        bullets: [
          'Müşteri sitesi başına ayrı marka beyni ve marka sesi',
          'Ajans planında 15 site ve ayda 100 makale',
          'Ürün Radarı ve GEO ısı haritası (Ajans planı)',
          'Haftalık e-posta performans raporu',
        ],
        cta: 'Ajans için başla',
      },
      {
        icon: '📝',
        title: 'Blog & Yayın',
        bullets: [
          'Editorial calendar otomasyon',
          'WordPress REST + Ghost + custom CMS',
          'Affiliate makale yazımı',
          'Konu motoru: 4 kaynaktan konu, 3 öncelik seviyesi',
        ],
        cta: 'Blog için başla',
      },
      {
        icon: '🏢',
        title: 'Kurumsal',
        bullets: [
          'Kurumsal planda 50 site, ayda 350 makale',
          'MCP sunucusu, REST API ve scope’lu API anahtarları',
          'Kendi sağlayıcı anahtarınla ölçüm (BYOK)',
        ],
        cta: 'Kurumsal için başla',
      },
      {
        icon: '🌐',
        title: 'Hosting / Tech',
        bullets: [
          '"X hosting nedir" tarz teknik makaleler',
          'WHMCS Knowledge Base entegrasyonu',
          'cPanel/SFTP/FTP otomatik yayın',
          'AI aramadaki görünürlüğünü 6 asistanda ölç',
        ],
        cta: 'Hosting için başla',
      },
    ],
  },
  en: {
    eyebrow: '🎯 Use Cases',
    titleA: 'A flow tailored to',
    titleB: 'your industry',
    subtitle: 'See how RanksUp helps depending on your site type.',
    items: [
      {
        icon: '🛒',
        title: 'E-commerce',
        bullets: [
          'Product Radar — weekly competitor share of voice and category rank (Agency plan)',
          'Product comparison blogs (organic traffic)',
          'Auto-publish to WordPress / WooCommerce sites via WordPress REST',
          'Seasonal campaign articles (Black Friday, Valentine\'s Day)',
        ],
        cta: 'Start for E-commerce',
      },
      {
        icon: '☁️',
        title: 'SaaS',
        bullets: [
          'Documentation + tutorial automation',
          'Long-tail "how to X" content',
          'Use case pages (one per vertical)',
          'Comparison ("X vs Competitor") pages',
        ],
        cta: 'Start for SaaS',
      },
      {
        icon: '🎨',
        title: 'Agency',
        bullets: [
          'Separate brand brain and brand voice per client site',
          '15 sites and 100 articles a month on the Agency plan',
          'Product Radar and GEO Heatmap (Agency plan)',
          'Weekly performance report by email',
        ],
        cta: 'Start for Agency',
      },
      {
        icon: '📝',
        title: 'Blog & Publishing',
        bullets: [
          'Editorial calendar automation',
          'WordPress REST + Ghost + custom CMS',
          'Affiliate article writing',
          'Topic engine: topics from 4 sources, 3 priority tiers',
        ],
        cta: 'Start for Blog',
      },
      {
        icon: '🏢',
        title: 'Enterprise',
        bullets: [
          '50 sites and 350 articles a month on the Enterprise plan',
          'MCP server, REST API and scoped API keys',
          'Measure with your own provider keys (BYOK)',
        ],
        cta: 'Start for Enterprise',
      },
      {
        icon: '🌐',
        title: 'Hosting / Tech',
        bullets: [
          '"What is X hosting" technical articles',
          'WHMCS Knowledge Base integration',
          'cPanel/SFTP/FTP auto-publish',
          'Measure your AI search visibility on 6 assistants',
        ],
        cta: 'Start for Hosting',
      },
    ],
  },
} as const;

/**
 * Senaryo ikonlari, USE_CASES.items ile AYNI SIRADA (iki dilde sira ayni). Verideki
 * emoji (`icon`) vitrinde cizilmez; yerine duz cizgi ikon gelir.
 */
const ICONS: LucideIcon[] = [ShoppingCart, Cloud, Palette, PenLine, Building2, Globe];

/** Etiketin basindaki emojiyi atar; metin USE_CASES'te oldugu gibi durur */
const afterMark = (s: string) => s.slice(s.indexOf(' ') + 1);

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik + alti senaryo bitisik hucreli izgarada.
 * Sayfa alti cagriyi ortak VitrinCta yapar (marketing-shell); hucre dugmeleri bu yuzden
 * ince cerceveli (sayfada tek dolu turuncu dugme kapanistaki).
 */
export default function UseCasesPage() {
  const { locale } = useT();
  const data = USE_CASES[locale];

  return (
    <>
      <VitrinHero rail={afterMark(data.eyebrow)} a={data.titleA} b={data.titleB} lead={data.subtitle}>
        <PageUpdatedLine path="/use-cases" className="mt-5 font-mono" />
      </VitrinHero>

      <VitrinBand>
        <div className={`${VITRIN_GRID} sm:grid-cols-2 lg:grid-cols-3`}>
          {data.items.map((u, i) => {
            const Icon = ICONS[i];
            return (
              <div key={u.title} className={`${VITRIN_CELL} flex flex-col`}>
                {Icon && <Icon className="h-5 w-5 text-brand-vivid" aria-hidden />}
                <h2 className="mt-6 text-vitrin-3">{u.title}</h2>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                  {u.bullets.map((b, bi) => (
                    <li key={bi} className="grid grid-cols-[0.25rem_1fr] gap-3">
                      <span className="mt-2 h-1 w-1 bg-dim" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/onboarding" className="v-btn-line mt-8 h-9 self-start px-4">
                  {u.cta}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            );
          })}
        </div>
      </VitrinBand>
    </>
  );
}
