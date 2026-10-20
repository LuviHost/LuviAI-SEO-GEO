import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Makale uretim / yayin akisini anlatan musteri metinleri = kod.
 *
 * NEDEN: metinler kodun yapmadigini vaat ediyordu — "Auto-Pilot ON ise her
 * hafta otomatik duzeltilir" (Yari otomatikte duzeltilmez), editor skoru
 * "/100" (olcek 90), ilerleme adimi "Yazar AI (Claude Sonnet 4.5) · 1800-2500
 * kelime" (model platformda yonetilir, uzunluk sabit degil), "30 gun sonra
 * performansa gore guncelleme" kosulsuz (yalniz Search Console verisiyle).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../../web');
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');

describe('icerik yenileme (content-pivot) iddialari Search Console kosuluyla', () => {
  const faq = read('src/app/(marketing)/faq/page.tsx');
  const compare = read('src/app/(marketing)/compare/page.tsx');
  const about = read('src/app/(marketing)/about/page.tsx');

  it('SSS madde 5 (TR + EN): kosulsuz "30 gun sonra performansi dusuk" vaadi yok, Search Console kosulu var', () => {
    expect(faq).not.toContain('yayından 30 gün sonra performansı düşük kalan makaleler');
    expect(faq).not.toContain('articles that still perform poorly 30 days after publishing');
    // Ucretli plan kosulu: deneme hesabinin sitesi pivot taramasina girmez (content-pivot scanAllSites, 20.10.2026)
    expect(faq).toContain('(5) ücretli planlarda ve Search Console bağlıysa, yayından en az 30 gün geçmiş makaleler');
    expect(faq).toContain('(5) on paid plans, if Search Console is connected, articles published at least 30 days ago');
    // Yari otomatikte yeniden yazilan yazi onay bekler (content-pivot autoPublishEnabled)
    expect(faq).toContain('Yarı otomatikte yeni hali onayını bekler');
  });

  it('/compare playbook adim 11: "auto" degil "partial"; Search Console ve elle kopru acikca yaziyor', () => {
    const step = compare.split('\n').find((l) => l.includes("step: '11'"));
    expect(step, 'adim 11').toBeDefined();
    expect(step!).toContain("status: 'partial'");
    expect(step!).toContain('Search Console bağlıysa');
    expect(step!).toContain('Search Console connected');
    expect(step!).not.toMatch(/30 gün sonra performansa göre pivot|Performance-based pivot after 30 days/);
  });

  it('/about otomatik akis karti kosulsuz "performansa gore guncelleme" demiyor', () => {
    expect(about).not.toContain('yayından 30 gün sonra performansa göre güncelleme');
    expect(about).toContain('Search Console verisinde zayıf kalan yazıyı');
  });
});

describe('yayin onayi modu — llms-full.txt', () => {
  const llmsFull = read('public/llms-full.txt');

  it('takvim satiri onay modunu dogru anlatiyor (varsayilan Yari otomatik onay bekler)', () => {
    expect(llmsFull).not.toContain('İçerik takvimi, zamanlanmış üretim ve otomatik yayın.');
    expect(llmsFull).toContain('Yarı otomatik modda (varsayılan) her yazı yayınlanmadan önce onayını bekler');
    expect(llmsFull).toContain('Tam otomatik modda takvimdeki yazılar editör ve QA kontrollerinden geçince varsayılan yayın hedefine kendiliğinden yayınlanır');
  });

  it('varsayilan mod gercekten manual_approve (schema.prisma)', () => {
    const schema = fs.readFileSync(path.resolve(HERE, '../../prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/publishApprovalMode\s+String\s+@default\("manual_approve"\)/);
  });
});

describe('panel metinleri', () => {
  it('Takili Sayfalar: otomatik duzeltme yalniz akis acik + Tam otomatikte; RanksUp disi oneri "basarisiz" degil', () => {
    const stuck = read('src/app/(dashboard)/sites/[id]/stuck-pages/page.tsx');
    expect(stuck).not.toContain('Auto-Pilot ON ise her hafta otomatik düzeltilir');
    expect(stuck).toContain('Otomatik akış açık ve Tam otomatik moddaysa RanksUp ile yazılmış sayfalar her hafta otomatik düzeltilip yeniden yayınlanır');
    expect(stuck).toContain('Yarı otomatikte "AI Düzelt" ile sen başlatırsın');
    expect(stuck).toMatch(/\} else if \(r\.manual\) \{[\s\S]*?toast\.message\('Öneri kaydedildi; elle uygula'/);
    // Site basina haftalik ust sinir kodla ayni
    const autopilot = fs.readFileSync(path.resolve(HERE, '../audit/stuck-page-autopilot.ts'), 'utf8');
    expect(autopilot).toContain('export const STUCK_AUTO_RECOVER_PER_SITE = 5;');
    expect(stuck).toContain('site başına en fazla 5 sayfa');
  });

  it('statik yazim "elle uygula" nedeni notr gosteriliyor (kirmizi hata degil)', () => {
    const stepper = read('src/components/site-flow-stepper.tsx');
    expect(stepper).toMatch(/else if \(res\.manual\) toast\.message\(/);
    expect(stepper).toMatch(/writeResult\.manual \? \([\s\S]*?bg-muted\/50 text-muted-foreground/);
  });

  it('editor skoru paydasi /100 degil; olcek pipeline EDITOR_MAX_SCORE ile ayni (90)', () => {
    const page = read('src/app/(dashboard)/sites/[id]/articles/[articleId]/page.tsx');
    expect(page).not.toMatch(/editorScore\}\/100/);
    expect(page).toContain('{article.editorScore}/{editorScoreMax(article)}');
    const pipeline = fs.readFileSync(path.resolve(HERE, './pipeline.service.ts'), 'utf8');
    expect(pipeline).toContain('private static readonly EDITOR_MAX_SCORE = 90;');
    expect(page).toMatch(/if \(outputs\.geoGate\) return 90;/);
  });

  it('makale ilerleme adimlari model adi ve sabit uzunluk vaat etmiyor; gorsel yayinda uretilir', () => {
    const progress = read('src/components/pipeline-progress.tsx');
    const article = progress.slice(progress.indexOf('article: ['), progress.indexOf('] as PipelineStep[]', progress.indexOf('article: [')));
    expect(article).not.toMatch(/Claude|Sonnet|Gemini|GPT|1[.,]?800\s*[-–]\s*2[.,]?500/);
    expect(article).toContain("label: 'Yazar ajan'");
    expect(article).toContain('kapak görseli yayında üretilir');
    // Kapak gorseli gercekten yayin aninda uretiliyor (publisher.service)
    const publisher = fs.readFileSync(path.resolve(HERE, './publisher.service.ts'), 'utf8');
    expect(publisher).toContain('this.imageGen.generate(');
  });
});
