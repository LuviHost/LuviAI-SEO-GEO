'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { VitrinHero, VitrinSection, VITRIN_LINK } from '@/components/vitrin/vitrin-page';
import { SeoAnalizAraci } from './seo-analiz-araci';
import { ICERIK } from './icerik';

const GOVDE = 'max-w-2xl space-y-4 text-sm leading-[1.8] text-muted-foreground';

/** /seo-analizi gorunur govdesi: sunucuda TR, EN secilince tarayicida EN (lib/i18n useT) */
export function SeoAnaliziGovde() {
  const { locale } = useT();
  const c = ICERIK[locale === 'en' ? 'en' : 'tr'];
  return (
    <>
      <VitrinHero
        before={<Breadcrumbs items={[{ label: c.breadcrumb }]} />}
        rail={c.rail}
        a={c.a}
        b={c.b}
        lead={<p>{c.lead}</p>}
      >
        <div className="mt-10">
          <SeoAnalizAraci />
        </div>
      </VitrinHero>

      <VitrinSection id="neler-kontrol-ediliyor" title={c.kontrolBaslik} note={c.kontrolNot}>
        <ul className="border-t border-border">
          {c.kontroller.map(([ad, aciklama]) => (
            <li key={ad} className="border-b border-border py-4">
              <strong className="block text-base font-medium text-foreground">{ad}</strong>
              <span className="text-sm leading-[1.8] text-muted-foreground">{aciklama}</span>
            </li>
          ))}
        </ul>
      </VitrinSection>

      <VitrinSection id="site-hizi" title={c.hizBaslik} note={c.hizNot}>
        <div className={GOVDE}>
          <p>{c.hiz[0]}</p>
          <p>{c.hiz[1]}</p>
        </div>
      </VitrinSection>

      <VitrinSection id="yapay-zeka" title={c.aiBaslik} note={c.aiNot}>
        <div className={GOVDE}>
          <p>
            {c.ai.once}
            <Link href="/#test" className={VITRIN_LINK}>{c.ai.test}</Link>
            {c.ai.arada}
            <Link href="/rehber/google-ai-modu" className={VITRIN_LINK}>{c.ai.rehber}</Link>
            {c.ai.son}
          </p>
        </div>
      </VitrinSection>

      <VitrinSection id="sss" title={c.sssBaslik} note={c.sssNot}>
        <dl className="border-t border-border">
          {c.sss.map((s) => (
            <div key={s.q} className="border-b border-border py-5">
              <dt className="text-base font-medium text-foreground">{s.q}</dt>
              <dd className="mt-2 text-sm leading-[1.8] text-muted-foreground">{s.a}</dd>
            </div>
          ))}
        </dl>
      </VitrinSection>
    </>
  );
}
