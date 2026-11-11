/**
 * /ranksup.md urun ozeti plan verisinden uretilir; sayilar plans.ts ile ayni, plan verisi
 * yoksa fiyat uydurulmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// plans.ts'in importu yok — API'nin tek kaynagi dogrudan okunur
import {
  BASE_ENGINES, BASE_PLANS, CONDITIONAL_ENGINES, ENGINE_LABELS, ENGINES_BULLET, STANDARD_ENGINES,
  enginesBullet, planEngines, publicPlans, type BasePlan,
} from '../../../api/src/billing/plans';
import { ENGINE_NAMES, RANKSUP_MD_UPDATED, buildRanksupMd, type SummaryPlan } from './ranksup-md';
import { formatPageDate, pageUpdated } from './page-updated';

/**
 * /billing/plans?locale=tr yanitinin bu ozetin kullandigi alanlari (api billing.service
 * getPlans → toDefinition): YALNIZ satistaki planlar (publicPlans; Ajans satistan kalkti),
 * asistan maddesi o an olculen listeden uretilmis (planFeatures → enginesBullet), `engines`
 * plan kapsami ∩ olculenler. `olculen`: kurulumda o an olculen asistanlar.
 */
const yanit = (olculen: readonly string[]): SummaryPlan[] => publicPlans().map((p: BasePlan) => ({
  id: p.id,
  name: p.name_tr,
  monthly: p.monthly_usd,
  annual: p.annual_usd,
  articlesPerMonth: p.articlesPerMonth,
  sites: p.sites,
  aiRunsPerMonth: p.aiRunsPerMonth,
  aiProviders: p.aiProviders,
  support: p.support_tr,
  features: p.features_tr.map((f) => (f === ENGINES_BULLET ? enginesBullet(p.id, 'tr', olculen) : f)),
  engines: planEngines(p.id).filter((e) => olculen.includes(e)),
  inheritsLabel: p.inheritsFrom ? `${BASE_PLANS.find((x) => x.id === p.inheritsFrom)!.name_tr}'deki her şey, artı:` : undefined,
  popular: p.popular,
  contactSales: p.contactSales,
}));

/** Muse olculmuyor: her kurulumda olculen alti asistan */
const MUSE_YOK: readonly string[] = [...BASE_ENGINES];
const MUSE_VAR: readonly string[] = [...BASE_ENGINES, ...CONDITIONAL_ENGINES];
const PLANS = yanit(MUSE_YOK);

const tl = (n: number) => n.toLocaleString('tr-TR');
const ALINDI = new Date('2026-10-24T18:30:12Z');
const md = buildRanksupMd(PLANS, ALINDI);
const ucretli = publicPlans().filter((p) => p.id !== 'trial');

describe('/ranksup.md', () => {
  it('satistaki her ucretli plan tabloda: ad, fiyat (teklifle satilan planda "teklifle"), makale (yoksa "yok"), site, calistirma tavani plans.ts ile ayni', () => {
    expect(ucretli.map((p) => p.id)).toEqual(['starter', 'pro', 'enterprise']);
    for (const p of ucretli) {
      const aylik = p.contactSales ? 'teklifle' : `$${tl(p.monthly_usd)}`;
      const yillik = p.contactSales ? 'teklifle' : `$${tl(p.annual_usd)}`;
      const makale = p.articlesPerMonth > 0 ? String(p.articlesPerMonth) : 'yok';
      const satir = `| ${p.name_tr} | ${aylik} | ${yillik} | ${makale} | ${p.sites} | ${tl(p.aiRunsPerMonth)} |`;
      expect(md, p.id).toContain(satir);
      for (const f of PLANS.find((x) => x.id === p.id)!.features) expect(md, `${p.id}: ${f}`).toContain(f);
      // Plan blogu: fiyat ve makale siniri ayni kuralla
      expect(md, p.id).toContain(p.contactSales ? '- **Fiyat**: teklifle' : `- **Fiyat**: $${tl(p.monthly_usd)}/ay, yıllık $${tl(p.annual_usd)}`);
      expect(md, p.id).toContain(`- **Sınırlar**: ${p.articlesPerMonth > 0 ? `${p.articlesPerMonth} AI makale/ay` : 'makale üretimi yok'} · ${p.sites} site`);
    }
    expect(md).not.toContain(ENGINES_BULLET);
    expect(md).not.toContain('| Ücretsiz Deneme |');
  });

  // 11.11.2026 paket yapisi: Kurumsal'in liste fiyati ve satistan kalkan Ajans musteriye gosterilmez
  it('teklifle satilan planin fiyati ve satistan kalkan plan ozette yok', () => {
    const gizli = BASE_PLANS.filter((p) => p.monthly_usd > 0 && (p.contactSales || p.legacy));
    expect(gizli.map((p) => p.id).sort()).toEqual(['agency', 'enterprise']);
    for (const p of gizli) {
      for (const n of [p.monthly_usd, p.annual_usd]) {
        for (const y of new Set([String(n), n.toLocaleString('tr-TR'), n.toLocaleString('en-US')])) {
          expect(md, `${p.id}: $${y}`).not.toContain(`$${y}`);
        }
      }
    }
    for (const p of BASE_PLANS.filter((x) => x.legacy)) expect(md, p.id).not.toContain(p.name_tr);
    // Makale uretimi olmayan plan "0 AI makale" diye yazilmaz ("makale üretimi yok")
    expect(md).not.toMatch(/(?<!\d)0 AI makale/);
  });

  it('deneme maddeleri plans.ts ile ayni (14 gun, 2 makale, kart istemez)', () => {
    const trial = BASE_PLANS.find((p) => p.id === 'trial')!;
    for (const f of trial.features_tr) expect(md).toContain(`- ${f}`);
    expect(md).toMatch(/14 gün · 2 AI makale/);
    expect(md).toContain('Kredi kartı istemez');
  });

  // Eski kural: tek liste ("ChatGPT, … (6 asistan).") her plan icin. 11.11.2026 paket yapisi:
  // kapsam plana bagli (plans.ts planEngines) — deneme ve Baslangic dort, Profesyonel ve ustu alti;
  // Muse yalniz olculuyorsa. Ozet ayni listeyi olcen planlari tek satirda toplar.
  it('olculen asistanlar plana gore: deneme ve Baslangic dort, Profesyonel ve ustu alti (Muse yalniz olculuyorsa); adlar plans.ts ile ayni', () => {
    expect({ ...ENGINE_NAMES }).toEqual({ ...ENGINE_LABELS });
    const ad = (e: string) => ENGINE_LABELS[e as keyof typeof ENGINE_LABELS];
    const planAdi = (id: string) => BASE_PLANS.find((p) => p.id === id)!.name_tr;
    const dort = STANDARD_ENGINES.map(ad);
    const alti = BASE_ENGINES.map(ad);
    expect(dort).toHaveLength(4);
    expect(alti).toHaveLength(6);
    expect(planEngines('trial')).toEqual(planEngines('starter'));
    expect(planEngines('pro')).toEqual(planEngines('enterprise'));
    const altSatir = `- ${planAdi('trial')}, ${planAdi('starter')}: ${dort.join(', ')} (${dort.length} asistan)`;
    expect(md).toContain('Ölçülen asistanlar plana bağlıdır:');
    expect(md).toContain(altSatir);
    expect(md).toContain(`- ${planAdi('pro')}, ${planAdi('enterprise')}: ${alti.join(', ')} (${alti.length} asistan)`);
    expect(md).not.toMatch(/llama|muse/i);
    // Plan basina sayi, planin API'deki aiProviders alaniyla ayni (kosullu asistan haric)
    for (const p of publicPlans()) expect(planEngines(p.id).filter((e) => !CONDITIONAL_ENGINES.includes(e)).length, p.id).toBe(p.aiProviders);

    // Muse olculuyorsa yalniz ust kapsamin satirina girer; Baslangic satiri degismez
    const museli = buildRanksupMd(yanit(MUSE_VAR), ALINDI);
    const yedi = [...alti, ...CONDITIONAL_ENGINES.map(ad)];
    expect(museli).toContain(altSatir);
    expect(museli).toContain(`- ${planAdi('pro')}, ${planAdi('enterprise')}: ${yedi.join(', ')} (${yedi.length} asistan)`);

    // Eski API yaniti (engines alani yok): liste uydurulmaz, bolum yazilmaz
    const eski = buildRanksupMd(PLANS.map(({ engines: _e, ...p }) => p), ALINDI);
    expect(eski).not.toContain('## Ölçülen AI asistanları');
  });

  it('"Nasıl başlanır": makale uretimine hangi planla devam edildigi plan verisinden adiyla yazili ("plan seç" tek basina degil)', () => {
    const makalePlani = ucretli.find((p) => p.articlesPerMonth > 0)!;
    expect(makalePlani.id).toBe('pro');
    expect(ucretli.find((p) => p.id === 'starter')!.articlesPerMonth).toBe(0);
    expect(md).toContain(`4. Devam etmek için plan seç (makale üretimi ${makalePlani.name_tr} ve üstü planlardadır): https://ranksup.ai/pricing`);
    expect(md).not.toMatch(/^4\. Devam etmek için plan seç: /m);
    // Plan verisi yoksa plan adi uydurulmaz ama "herhangi bir plan" da denmez
    expect(buildRanksupMd([])).toContain('4. Devam etmek için plan seç; makale üretiminin hangi planlarda olduğu fiyatlandırma sayfasında: https://ranksup.ai/pricing');
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
