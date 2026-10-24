/**
 * /ranksup.md urun ozeti plan verisinden uretilir; sayilar plans.ts ile ayni, plan verisi
 * yoksa fiyat uydurulmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// plans.ts'in importu yok — API'nin tek kaynagi dogrudan okunur
import { BASE_PLANS } from '../../../api/src/billing/plans';
import { RANKSUP_MD_UPDATED, buildRanksupMd, type SummaryPlan } from './ranksup-md';
import { formatPageDate, pageUpdated } from './page-updated';

/** /billing/plans?locale=tr yanitinin bu ozetin kullandigi alanlari (billing.service toDefinition) */
const PLANS: SummaryPlan[] = BASE_PLANS.map((p) => ({
  id: p.id,
  name: p.name_tr,
  monthly: p.monthly_usd,
  annual: p.annual_usd,
  articlesPerMonth: p.articlesPerMonth,
  sites: p.sites,
  aiRunsPerMonth: p.aiRunsPerMonth,
  aiProviders: p.aiProviders,
  support: p.support_tr,
  features: p.features_tr,
  inheritsLabel: p.inheritsFrom ? `${BASE_PLANS.find((x) => x.id === p.inheritsFrom)!.name_tr}'deki her şey, artı:` : undefined,
  popular: p.popular,
  contactSales: p.contactSales,
}));

const tl = (n: number) => n.toLocaleString('tr-TR');
const ALINDI = new Date('2026-10-24T18:30:12Z');
const md = buildRanksupMd(PLANS, ALINDI);

describe('/ranksup.md', () => {
  it('her ucretli plan tabloda: ad, aylik/yillik fiyat, makale, site, calistirma tavani plans.ts ile ayni', () => {
    for (const p of BASE_PLANS.filter((x) => x.id !== 'trial')) {
      const satir = `| ${p.name_tr} | $${tl(p.monthly_usd)} | $${tl(p.annual_usd)} | ${p.articlesPerMonth} | ${p.sites} | ${tl(p.aiRunsPerMonth)} |`;
      expect(md, p.id).toContain(satir);
      for (const f of p.features_tr) expect(md, `${p.id}: ${f}`).toContain(f);
    }
    expect(md).not.toContain('| Ücretsiz Deneme |');
  });

  it('deneme maddeleri plans.ts ile ayni (14 gun, 2 makale, kart istemez)', () => {
    const trial = BASE_PLANS.find((p) => p.id === 'trial')!;
    for (const f of trial.features_tr) expect(md).toContain(`- ${f}`);
    expect(md).toMatch(/14 gün · 2 AI makale/);
    expect(md).toContain('Kredi kartı istemez');
  });

  it('olculen asistanlar plan maddesindeki listeyle ve aiProviders sayisiyla ayni', () => {
    const liste = BASE_PLANS.flatMap((p) => p.features_tr).find((f) => f.startsWith('ChatGPT · '))!.split(' · ');
    expect(liste.length).toBe(BASE_PLANS[1].aiProviders);
    expect(md).toContain(`${liste.join(', ')} (${liste.length} asistan).`);
    expect(md).not.toMatch(/llama/i);
  });

  it('aylik calistirma her yerde "en fazla" ile; haftalik olcum kurali yazili', () => {
    expect(md).not.toMatch(/(?<!en fazla )(?<![\d.,])\d[\d.]*\s+(?:AI\s+)?görünürlük çalıştırması\s*\/\s*ay\b/);
    expect(md).toContain('hesap başına 7 günde 1 AI görünürlük ölçümü');
  });

  it('gorunur tarih ozetin kendi metin tarihi ile /pricing tarihinin yenisi; plan verisinin alindigi an ayrica', () => {
    const fiyat = pageUpdated('/pricing');
    const beklenen = RANKSUP_MD_UPDATED > fiyat ? RANKSUP_MD_UPDATED : fiyat;
    expect(md).toContain(`Son güncelleme: ${formatPageDate(beklenen, 'tr')} · RanksUp Ekibi`);
    expect(md).toContain('Plan verisinin alındığı an: 2026-10-24 18:30 UTC.');
    expect(md).toContain('en geç 10 dakikada bir yenilenir');
    expect(md).not.toContain('istendiğinde');
  });

  it('"Ne yapar" bolumu elle sayi yazmiyor (kesin sayilar plan maddelerinde)', () => {
    const bolum = md.slice(md.indexOf('## Ne yapar'), md.indexOf('## Kimler için'));
    expect(bolum).not.toMatch(/\d/);
  });

  it('baslangic adimlari ve baglantilar var', () => {
    expect(md).toContain('https://ranksup.ai/signin?signup=1');
    expect(md).toContain('## Nasıl başlanır');
    expect(md).toContain('https://ranksup.ai/llms.txt');
  });

  it('plan verisi alinamazsa fiyat ve sinir uydurmaz, /pricing e yonlendirir', () => {
    const bos = buildRanksupMd([]);
    expect(bos).not.toMatch(/\$\d/);
    expect(bos).toContain('Güncel plan ve fiyatlar: https://ranksup.ai/pricing');
    expect(bos).toContain('Deneme koşulları: https://ranksup.ai/pricing');
    expect(bos).not.toContain('## Ölçülen AI asistanları');
    expect(bos).not.toContain('Plan verisinin alındığı an');
  });

  it('route ayni yolu kullaniyor (landing-data fetchPlans, ISR) ve Markdown icerik turuyle donuyor', () => {
    const route = readFileSync(fileURLToPath(new URL('../app/ranksup.md/route.ts', import.meta.url)), 'utf8');
    expect(route).toContain("fetchPlans('tr')");
    expect(route).toContain('export const revalidate = 600');
    expect(route).toContain("'text/markdown; charset=utf-8'");
  });

  it('llms.txt ve llms-full.txt ozete baglanti veriyor', () => {
    for (const f of ['llms.txt', 'llms-full.txt']) {
      const doc = readFileSync(fileURLToPath(new URL(`../../public/${f}`, import.meta.url)), 'utf8');
      expect(doc, f).toContain('https://ranksup.ai/ranksup.md');
    }
  });
});
