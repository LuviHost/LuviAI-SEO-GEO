/**
 * Meta Ads kuralları — claude-ads/ads/references/meta-audit.md (MIT) port'u.
 * Top 18 kural — Pixel/CAPI + Creative odaklı.
 */
import type { AuditRule, MetaCategory, AccountSnapshot } from './types.js';

export const META_RULES: AuditRule<MetaCategory>[] = [
  // ─── PIXEL / CAPI HEALTH (30%) ─────────────────────────────
  {
    id: 'M01', name: 'Meta Pixel installed', category: 'pixel', severity: 'critical',
    check: (s) => {
      const p = s.pixel;
      if (!p) return { verdict: 'na' };
      if (p.installed && p.coverage >= 0.95) return { verdict: 'pass', finding: `Pixel %${(p.coverage * 100).toFixed(0)} sayfada aktif`, recommendation: 'Sürdür — yeni sayfalarda da otomatik fire ettiğini izle.' };
      if (p.installed && p.coverage >= 0.9) return { verdict: 'warning', finding: `Pixel %${(p.coverage * 100).toFixed(0)} sayfada (eksik kapsam)`, recommendation: 'Eksik sayfa(lar)ı bul (Events Manager → Test Events). Tüm ürün/checkout sayfalarında fire etmeli.' };
      return { verdict: 'fail', finding: 'Pixel kurulu değil veya çoğu sayfada fire etmiyor', recommendation: 'Acil: Events Manager → Pixel → Setup. WordPress\'te Pixel plugin, custom siteta GTM tag.' };
    },
  },
  {
    id: 'M02', name: 'Conversions API (CAPI) active', category: 'pixel', severity: 'critical',
    check: (s) => {
      if (s.capi?.active) return { verdict: 'pass', finding: 'CAPI server-side aktif', recommendation: 'iOS 14.5 sonrası %30-40 data kaybını telafi ediyor — koru.' };
      return { verdict: 'fail', finding: 'CAPI yok — iOS 14.5 sonrası %30-40 data kaybı', recommendation: 'CAPI Gateway (en kolay) ya da direct API integration kur. WordPress: PixelYourSite Pro / Stape. Custom: server endpoint + Meta CAPI lib.' };
    },
  },
  {
    id: 'M03', name: 'Event deduplication', category: 'pixel', severity: 'critical',
    check: (s) => {
      const dedup = s.capi?.deduplicationRate;
      if (dedup == null) return { verdict: 'na' };
      if (dedup >= 0.9) return { verdict: 'pass', finding: `Dedup oranı %${(dedup * 100).toFixed(0)}`, recommendation: 'Sağlam — event_id\'leri tutarlı tutmaya devam.' };
      if (dedup >= 0.5) return { verdict: 'warning', finding: `Dedup oranı %${(dedup * 100).toFixed(0)} (düşük)`, recommendation: 'event_id eşleşmesi zayıf — pixel ve CAPI aynı event_id\'yi gönderdiğinden emin ol.' };
      return { verdict: 'fail', finding: `Dedup oranı %${(dedup * 100).toFixed(0)} — double-counting riski`, recommendation: 'event_id parametresi pixel + CAPI\'da identik olmalı. UUID/timestamp tabanlı deterministik ID üret.' };
    },
  },
  {
    id: 'M04', name: 'Event Match Quality (EMQ)', category: 'pixel', severity: 'critical',
    check: (s) => {
      const e = s.emq;
      if (!e) return { verdict: 'na' };
      const purchase = e.purchase ?? 0;
      if (purchase >= 8.5) return { verdict: 'pass', finding: `Purchase EMQ ${purchase.toFixed(1)}`, recommendation: 'Yüksek match quality — ROAS ve learning kalitesi maksimize.' };
      if (purchase >= 6) return { verdict: 'warning', finding: `Purchase EMQ ${purchase.toFixed(1)} (orta)`, recommendation: 'Email + phone hash + external_id parametreleri ekle. EMQ 8.6→9.3 = ROAS +%22 (case study).' };
      return { verdict: 'fail', finding: `Purchase EMQ ${purchase.toFixed(1)} — kritik düşük`, recommendation: 'CAPI payload\'a customer_email_hash, customer_phone_hash, customer_external_id ekle. EMQ\'yu 6→8.5 çıkarmak CPA\'yı %18 düşürür.' };
    },
  },
  {
    id: 'M05', name: 'Domain verification', category: 'pixel', severity: 'high', fixTimeMinutes: 5,
    check: (s) => {
      if (s.domainVerified === true) return { verdict: 'pass', finding: 'Domain Business Manager\'da verified', recommendation: 'Sürdür — yeni domain eklerken aynı işlem.' };
      return { verdict: 'fail', finding: 'Domain verified değil — AEM event önceliği yapılamıyor', recommendation: 'Business Manager → Brand Safety → Domains → Verify (DNS TXT veya meta-tag, 5 dk).' };
    },
  },
  {
    id: 'M06', name: 'Aggregated Event Measurement (AEM)', category: 'pixel', severity: 'high',
    check: (s) => {
      const a = s.aem;
      if (!a) return { verdict: 'na' };
      if (a.configured && a.topEvents >= 8) return { verdict: 'pass', finding: `${a.topEvents} top event AEM\'de yapılandırılmış`, recommendation: 'Optimal — 8 event slot kullanılıyor.' };
      if (a.configured) return { verdict: 'warning', finding: `${a.topEvents} event AEM\'de`, recommendation: '8 slota tamamla — Purchase, AddToCart, Lead, ViewContent, IC, Subscribe + custom 2 event.' };
      return { verdict: 'fail', finding: 'AEM yapılandırılmamış', recommendation: 'Events Manager → Aggregated Event Measurement → 8 event prioritize. iOS web kampanyaları için zorunlu.' };
    },
  },
  {
    id: 'M09', name: 'iOS attribution window', category: 'pixel', severity: 'high', fixTimeMinutes: 2,
    check: (s) => {
      const w = s.attributionWindow;
      if (!w) return { verdict: 'na' };
      if (w === '7d_click_1d_view') return { verdict: 'pass', finding: '7-day click / 1-day view aktif', recommendation: 'Optimal post-iOS attribution ayarı.' };
      if (w === '1d_click') return { verdict: 'warning', finding: '1-day click only — short window', recommendation: '7d click / 1d view\'a geç. Ad set settings → Attribution. 2 dk iş.' };
      return { verdict: 'fail', finding: 'Attribution window yapılandırılmamış', recommendation: 'Ad set seviyesinde 7-day click / 1-day view set et.' };
    },
  },

  // ─── CREATIVE (30%) ─────────────────────────────────────────
  {
    id: 'M25', name: 'Creative format diversity', category: 'creative', severity: 'critical', fixTimeMinutes: 15,
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      if (adSets.length === 0) return { verdict: 'na' };
      const formats = new Set(adSets.flatMap(a => a.creatives.map(cr => cr.format)));
      if (formats.size >= 3) return { verdict: 'pass', finding: `${formats.size} format aktif (image+video+carousel)`, recommendation: 'Andromeda\'nın istediği creative diversity sağlanıyor.' };
      if (formats.size === 2) return { verdict: 'warning', finding: `${formats.size} format`, recommendation: '3. format\'ı ekle — image-only kampanyaya video, video-only\'a carousel test et.' };
      return { verdict: 'fail', finding: 'Sadece 1 creative format', recommendation: 'Andromeda %60+ similar creative\'leri suppress ediyor. 3 format hedefle: static image + video + carousel.' };
    },
  },
  {
    id: 'M26', name: 'Creative volume per ad set', category: 'creative', severity: 'high',
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      if (adSets.length === 0) return { verdict: 'na' };
      const minCount = Math.min(...adSets.map(a => a.creatives.length));
      if (minCount >= 10) return { verdict: 'pass', finding: `Min ${minCount} creative/ad set`, recommendation: 'Advantage+ için ideal seviye.' };
      if (minCount >= 5) return { verdict: 'warning', finding: `Min ${minCount} creative/ad set`, recommendation: 'Standart için yeterli ama Advantage+ Sales 10+ ister. 25 diverse creative %17 daha fazla conversion (case).' };
      return { verdict: 'fail', finding: `${minCount} creative/ad set — yetersiz`, recommendation: '5+ creative ekle. Düşük creative pool = hızlı fatigue + Andromeda suppression.' };
    },
  },
  {
    id: 'M28', name: 'Creative fatigue', category: 'creative', severity: 'critical',
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      const creatives = adSets.flatMap(a => a.creatives);
      if (creatives.length === 0) return { verdict: 'na' };
      const stale = creatives.filter(c => c.ageDays > 28).length;
      const pct = (stale / creatives.length) * 100;
      if (pct < 20) return { verdict: 'pass', finding: `Yeni creative ratio sağlıklı (%${(100 - pct).toFixed(0)} <28g)`, recommendation: 'Andromeda 2-4 hafta lifespan — sürdür.' };
      if (pct < 50) return { verdict: 'warning', finding: `${pct.toFixed(0)}% creative >28 gün eski`, recommendation: 'Bu hafta 5 yeni creative çıkar. Andromeda eski creative\'i suppress ediyor.' };
      return { verdict: 'fail', finding: `${pct.toFixed(0)}% creative >28 gün eski — fatigue`, recommendation: 'Acil creative refresh: minimum 10 yeni asset bu hafta. Frequency >3 olan ad set\'leri pause.' };
    },
  },
  {
    id: 'M-CR1', name: 'Creative freshness', category: 'creative', severity: 'high',
    check: (s) => {
      const all = s.metaCampaigns?.flatMap(c => c.adSets.flatMap(a => a.creatives)) ?? [];
      if (all.length === 0) return { verdict: 'na' };
      const newest = Math.min(...all.map(c => c.ageDays));
      if (newest <= 21) return { verdict: 'pass', finding: `Son creative ${newest} gün önce`, recommendation: '14-21g ritmini sürdür.' };
      if (newest <= 45) return { verdict: 'warning', finding: `Son yeni creative ${newest} gün önce`, recommendation: 'Bu hafta yeni creative çıkar — Andromeda compressed lifespan istiyor.' };
      return { verdict: 'fail', finding: `Son creative ${newest} gün önce — uzun süredir refresh yok`, recommendation: '14-21 günlük cycle başlat. Refresh olmadan ad set CTR doğrusal düşer.' };
    },
  },
  {
    id: 'M-CR2', name: 'Frequency: Prospecting', category: 'creative', severity: 'high',
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      const freqs = adSets.map(a => a.frequency7d).filter((f): f is number => f != null);
      if (freqs.length === 0) return { verdict: 'na' };
      const max = Math.max(...freqs);
      if (max < 3) return { verdict: 'pass', finding: `Max frequency ${max.toFixed(1)} (7g)`, recommendation: 'Optimal — koru.' };
      if (max < 5) return { verdict: 'warning', finding: `Max frequency ${max.toFixed(1)}`, recommendation: 'Audience exhaustion başlıyor. Audience\'ı genişlet veya creative refresh.' };
      return { verdict: 'fail', finding: `Max frequency ${max.toFixed(1)} — audience exhausted`, recommendation: 'Audience size 10x büyüt veya 2-3 hafta soğut. Kullanıcı reklamı 5+ gördü, banner blindness var.' };
    },
  },
  {
    id: 'M-CR4', name: 'CTR benchmark', category: 'creative', severity: 'high',
    check: (s) => {
      const all = s.metaCampaigns?.flatMap(c => c.adSets.flatMap(a => a.creatives)) ?? [];
      const ctrs = all.map(c => c.ctr).filter((c): c is number => c != null);
      if (ctrs.length === 0) return { verdict: 'na' };
      const avg = ctrs.reduce((a, b) => a + b, 0) / ctrs.length;
      if (avg >= 1.0) return { verdict: 'pass', finding: `Ortalama CTR ${avg.toFixed(2)}%`, recommendation: 'Sağlıklı — sürdür.' };
      if (avg >= 0.5) return { verdict: 'warning', finding: `Ortalama CTR ${avg.toFixed(2)}%`, recommendation: 'Hook\'u güçlendir: ilk 3 saniye, daha agresif promise. 1.0%+ hedef.' };
      return { verdict: 'fail', finding: `Ortalama CTR ${avg.toFixed(2)}% — kritik düşük`, recommendation: 'Creative concept ölü. Yeni hook formatı dene: UGC, problem-agitation-solution, before-after.' };
    },
  },
  {
    id: 'M31', name: 'UGC / social-native content', category: 'creative', severity: 'high',
    check: (s) => {
      const all = s.metaCampaigns?.flatMap(c => c.adSets.flatMap(a => a.creatives)) ?? [];
      if (all.length === 0) return { verdict: 'na' };
      const ugcPct = (all.filter(c => c.isUgc).length / all.length) * 100;
      if (ugcPct >= 30) return { verdict: 'pass', finding: `%${ugcPct.toFixed(0)} UGC creative`, recommendation: 'Sağlam mix — koru.' };
      if (ugcPct >= 10) return { verdict: 'warning', finding: `%${ugcPct.toFixed(0)} UGC`, recommendation: 'UGC oranını %30+\'a çıkar. UGC genelde 2-3x daha düşük CPA.' };
      return { verdict: 'fail', finding: `%${ugcPct.toFixed(0)} UGC — neredeyse hep polished/corporate`, recommendation: 'UGC creator partnership\'i dene. Müşteri testimonial videoları bile başlangıç olur.' };
    },
  },

  // ─── STRUCTURE (20%) ────────────────────────────────────────
  {
    id: 'M11', name: 'Campaign count', category: 'structure', severity: 'high',
    check: (s) => {
      const count = s.metaCampaigns?.length ?? 0;
      if (count === 0) return { verdict: 'na' };
      if (count <= 3) return { verdict: 'pass', finding: `${count} kampanya — odaklı`, recommendation: 'Jon Loomer kuralı: kampanya başına 1 hedef. Sürdür.' };
      if (count <= 5) return { verdict: 'warning', finding: `${count} kampanya`, recommendation: 'Aynı objective\'i tekrarlayan kampanyaları birleştir.' };
      return { verdict: 'fail', finding: `${count} kampanya — fragmented`, recommendation: 'Konsolide et: Prospecting + Retargeting + Brand olmak üzere 3 kampanya hedefle.' };
    },
  },
  {
    id: 'M13', name: 'Learning phase status', category: 'structure', severity: 'critical',
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      if (adSets.length === 0) return { verdict: 'na' };
      const learning = adSets.filter(a => a.learningStatus === 'learning_limited').length;
      const pct = (learning / adSets.length) * 100;
      if (pct < 30) return { verdict: 'pass', finding: `${pct.toFixed(0)}% Learning Limited`, recommendation: 'Sağlam.' };
      if (pct < 50) return { verdict: 'warning', finding: `${pct.toFixed(0)}% Learning Limited`, recommendation: 'Düşük volumlu ad set\'leri konsolide et — 50 conv/hafta hedef.' };
      return { verdict: 'fail', finding: `${pct.toFixed(0)}% Learning Limited — ölçeklenemiyor`, recommendation: 'Çok fazla küçük ad set var. Birleştir, bütçeyi yükselt. Learning Limited = optimization ölü.' };
    },
  },
  {
    id: 'M16', name: 'Audience overlap', category: 'audience', severity: 'high',
    check: (s) => {
      const adSets = s.metaCampaigns?.flatMap(c => c.adSets) ?? [];
      const overlaps = adSets.map(a => a.audienceOverlap).filter((o): o is number => o != null);
      if (overlaps.length === 0) return { verdict: 'na' };
      const max = Math.max(...overlaps);
      if (max < 20) return { verdict: 'pass', finding: `Max overlap %${max.toFixed(0)}`, recommendation: 'Tutarlı — sürdür.' };
      if (max < 40) return { verdict: 'warning', finding: `%${max.toFixed(0)} overlap`, recommendation: 'Overlap yüksek — kendini ihale ediyorsun. Ad set\'leri birleştir veya audience\'ları daralt.' };
      return { verdict: 'fail', finding: `%${max.toFixed(0)} overlap — agresif self-cannibalization`, recommendation: 'Aynı kişiye 2 ad set\'ten reklam çıkıyor. Tools → Audience Overlap, çakışan ad set\'leri konsolide et.' };
    },
  },
  {
    id: 'M23', name: 'Exclusion audiences', category: 'audience', severity: 'high', fixTimeMinutes: 10,
    check: () => null,
    llm: true,
    llmPrompt: () => `Meta Ads hesabında prospecting kampanyalarından mevcut müşteriler exclude ediliyor mu? Custom Audience exclusion var mı? (Bu bilgi snapshot'ta yoksa "warning" döndür)

JSON: {"verdict": "warning", "finding": "Exclusion audience kontrolü API üzerinden doğrulanamadı", "recommendation": "Prospecting kampanyalarına Custom Audience (Purchase last 90d) exclusion ekle."}`,
  },
  {
    id: 'M35', name: 'Attribution post-Jan 2026', category: 'structure', severity: 'high', fixTimeMinutes: 2,
    check: (s) => {
      const w = s.attributionWindow;
      if (w === '7d_click_1d_view') return { verdict: 'pass', finding: '7d click / 1d view (post-Jan 2026 uyumlu)', recommendation: 'Optimal.' };
      if (w === '1d_click') return { verdict: 'warning', finding: '1d click only', recommendation: '7d click / 1d view\'a geç (Jan 2026 sonrası 7d view kaldırıldı).' };
      return { verdict: 'fail', finding: 'Attribution yapılandırılmamış', recommendation: '7d click / 1d view set et — Jan 2026 sonrası standart.' };
    },
  },
];
