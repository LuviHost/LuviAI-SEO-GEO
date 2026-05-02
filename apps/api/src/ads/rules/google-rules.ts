/**
 * Google Ads kuralları — claude-ads/ads/references/google-audit.md (MIT) port'u.
 * Top 25 kural — yüksek etkili + deterministik kontrol mümkün olanlar öncelikli.
 */
import type { AuditRule, GoogleCategory, AccountSnapshot, Industry } from './types.js';

const benchmarks = {
  cpcByIndustry: {
    saas: 4.5, ecommerce: 1.15, b2b: 6.0, local: 3.0, healthcare: 4.5, legal: 8.58,
    finance: 5.0, real_estate: 2.5, education: 2.4, dental: 6.5, restaurant: 1.8, travel: 1.5,
  },
  ctrByIndustry: {
    saas: 2.5, ecommerce: 4.5, b2b: 2.4, local: 4.0, healthcare: 3.3, legal: 2.9,
    finance: 2.9, real_estate: 3.7, education: 3.8, dental: 4.2, restaurant: 5.0, travel: 5.0,
  },
};

export const GOOGLE_RULES: AuditRule<GoogleCategory>[] = [
  // ─── CONVERSION TRACKING (25%) ────────────────────────────────
  {
    id: 'G42', name: 'Conversion actions defined', category: 'conversion', severity: 'critical',
    check: (s) => {
      const actions = s.conversionActions ?? [];
      const primary = actions.filter(a => a.primary && a.status === 'enabled');
      if (primary.length >= 1) return { verdict: 'pass', finding: `${primary.length} primary conversion aktif`, recommendation: 'Tutarlı konfigürasyon — taze kalmasını izle.' };
      return {
        verdict: 'fail',
        finding: 'Hiç primary conversion action tanımlı değil',
        recommendation: 'Google Ads → Goals → Conversions: en az 1 primary conversion (Purchase, Lead) kur. Bidding bu sinyale dayanır.',
      };
    },
  },
  {
    id: 'G43', name: 'Enhanced Conversions enabled', category: 'conversion', severity: 'critical', fixTimeMinutes: 5,
    check: (s) => {
      if (s.enhancedConversionsActive === true) return { verdict: 'pass', finding: 'Enhanced Conversions aktif (~%10 uplift)', recommendation: 'Verification durumunu ayda bir kontrol et.' };
      return {
        verdict: 'fail',
        finding: 'Enhanced Conversions kapalı — ücretsiz %10 uplift kaybediliyor',
        recommendation: 'Google Ads → Conversions → Enhanced Conversions sekmesinden "Turn on" → Google tag/GTM seçeneği. 5 dakikalık iş.',
      };
    },
  },
  {
    id: 'G45', name: 'Consent Mode v2', category: 'conversion', severity: 'critical',
    check: (s) => {
      const cm = s.consentModeV2;
      if (cm === 'advanced') return { verdict: 'pass', finding: 'Advanced Consent Mode v2 yürürlükte', recommendation: 'AB/EEA trafiği için %15-25 conversion recovery sağlanıyor.' };
      if (cm === 'basic') return { verdict: 'warning', finding: 'Basic Consent Mode aktif — sinyal kaybı yüksek', recommendation: 'Advanced Consent Mode\'a geç (gtag/GTM ek parametreler), conversion data kaybını %15-25 azaltır.' };
      return {
        verdict: 'fail',
        finding: 'Consent Mode v2 implement edilmemiş — Temmuz 2025\'ten beri AB/UK\'da zorunlu',
        recommendation: 'GTM Consent Mode v2 template kullan, Advanced ayarla. Yapmazsan AB ad serving durabilir.',
      };
    },
  },
  {
    id: 'G47', name: 'Macro vs micro conversion ayrımı', category: 'conversion', severity: 'high',
    check: (s) => {
      const actions = s.conversionActions ?? [];
      if (actions.length === 0) return { verdict: 'na' };
      // Heuristic: primary olarak işaretlenen action sayısı 3'ten fazla ise muhtemelen mikro da var
      const primaryCount = actions.filter(a => a.primary).length;
      if (primaryCount === 0) return { verdict: 'na' };
      if (primaryCount <= 2) return { verdict: 'pass', finding: `${primaryCount} primary conversion (sade & fokuslu)`, recommendation: 'Bidding sinyalleri net — koru.' };
      if (primaryCount <= 4) return { verdict: 'warning', finding: `${primaryCount} primary conversion — bazı mikro event primary olabilir`, recommendation: 'AddToCart, TimeOnSite gibi mikro event\'leri "secondary"\'ye al; yalnız Purchase/Lead primary kalsın.' };
      return { verdict: 'fail', finding: `${primaryCount} primary conversion — bidding karışıyor`, recommendation: 'Sadece 1-2 macro event primary olsun (Purchase, Lead). Diğerleri secondary.' };
    },
  },
  {
    id: 'G-CT2', name: 'GA4 link & data flow', category: 'conversion', severity: 'high',
    check: (s) => {
      if (s.ga4Linked === true) return { verdict: 'pass', finding: 'GA4 property linked', recommendation: 'Veri akışını ayda bir doğrula (Reports → Realtime).' };
      return { verdict: 'fail', finding: 'GA4 property linked değil', recommendation: 'Google Ads → Tools → Linked accounts → GA4: property\'yi bağla. Audience import + remarketing için kritik.' };
    },
  },

  // ─── WASTED SPEND (20%) ──────────────────────────────────────
  {
    id: 'G13', name: 'Search term audit recency', category: 'waste', severity: 'critical',
    check: (s) => {
      if (!s.searchTermLastReviewedAt) return { verdict: 'fail', finding: 'Search terms hiç incelenmemiş', recommendation: 'Bu hafta search terms raporunu aç → en yüksek harcamalı 50 terimi gözden geçir, irrelevant olanları negative ekle.' };
      const days = (Date.now() - new Date(s.searchTermLastReviewedAt).getTime()) / 86400000;
      if (days <= 14) return { verdict: 'pass', finding: `Son inceleme ${Math.round(days)} gün önce`, recommendation: 'Ritmi koru — 14 günde bir.' };
      if (days <= 30) return { verdict: 'warning', finding: `${Math.round(days)} gün önce incelenmiş`, recommendation: 'Search terms raporunu aç, son 14 günde gelen yeni irrelevant terimleri negative\'e ekle.' };
      return { verdict: 'fail', finding: `${Math.round(days)} gündür incelenmemiş — wasted spend birikiyor`, recommendation: 'En kritik kazanç burada. Bugün search terms aç → en harcamalı 100 terim → irrelevant olanları negative ekle.' };
    },
  },
  {
    id: 'G14', name: 'Negative keyword lists', category: 'waste', severity: 'critical', fixTimeMinutes: 10,
    check: (s) => {
      const lists = s.negativeKeywordLists ?? [];
      if (lists.length === 0) return { verdict: 'fail', finding: 'Hiç negative keyword listesi yok', recommendation: '4 tema bazlı liste kur: Competitor, Jobs, Free, Irrelevant. Tools → Negative keyword lists → New.' };
      if (lists.length >= 3) return { verdict: 'pass', finding: `${lists.length} negative liste aktif`, recommendation: 'Listeleri ayda bir tazele.' };
      return { verdict: 'warning', finding: `${lists.length} negative liste — eksik tema var`, recommendation: 'Eksik temaları ekle: Competitor, Jobs, Free, Irrelevant — toplam 4 liste hedefle.' };
    },
  },
  {
    id: 'G16', name: 'Wasted spend on irrelevant terms', category: 'waste', severity: 'critical',
    check: (s) => {
      const terms = s.searchTerms ?? [];
      if (terms.length === 0) return { verdict: 'na' };
      const totalSpend = terms.reduce((a, t) => a + t.cost, 0);
      const wasted = terms.filter(t => t.cost > 10 && t.conversions === 0).reduce((a, t) => a + t.cost, 0);
      const pct = totalSpend > 0 ? (wasted / totalSpend) * 100 : 0;
      if (pct < 5) return { verdict: 'pass', finding: `${pct.toFixed(1)}% irrelevant harcama`, recommendation: 'Düşük seviyede — sürdür.' };
      if (pct < 15) return { verdict: 'warning', finding: `${pct.toFixed(1)}% irrelevant harcama (~$${wasted.toFixed(0)} son 30g)`, recommendation: 'En kötü 10 terimi listele, hepsini negative ekle. ~%10 bütçe kurtulur.' };
      return { verdict: 'fail', finding: `${pct.toFixed(1)}% irrelevant harcama (~$${wasted.toFixed(0)} son 30g) — kritik`, recommendation: 'ACİL: search terms → cost desc → ilk 50 → conversion 0 olanları toplu negative ekle. Bu hafta yapılırsa CPA %20+ düşer.' };
    },
  },

  // ─── ACCOUNT STRUCTURE (15%) ──────────────────────────────────
  {
    id: 'G05', name: 'Brand vs Non-Brand separation', category: 'structure', severity: 'critical', fixTimeMinutes: 10,
    check: () => null, // LLM kuralı — keyword text analizi gerekiyor
    llm: true,
    llmPrompt: (s) => `Aşağıda Google Ads hesabının kampanya isimleri var. Brand kampanyaları (marka adının kendisi) ile non-brand (jenerik kategori) ayrılmış mı yoksa karışmış mı? Eğer karışmışsa hangileri sorunlu?

Kampanya isimleri:
${(s.campaignNamingSamples ?? []).slice(0, 50).map(n => `- ${n}`).join('\n')}

JSON döndür: {"verdict": "pass|warning|fail", "finding": "...", "recommendation": "..."}`,
  },
  {
    id: 'G01', name: 'Campaign naming convention', category: 'structure', severity: 'medium',
    check: () => null,
    llm: true,
    llmPrompt: (s) => `Aşağıdaki Google Ads kampanya isimleri tutarlı bir naming convention izliyor mu? (Örn: [Brand]_[Type]_[Geo]_[Target] gibi parçalı yapı). Tutarsızsa hangi parça eksik?

${(s.campaignNamingSamples ?? []).slice(0, 30).map(n => `- ${n}`).join('\n')}

JSON döndür: {"verdict": "pass|warning|fail", "finding": "...", "recommendation": "..."}`,
  },
  {
    id: 'G06', name: 'PMax aktivasyonu', category: 'structure', severity: 'medium',
    check: (s) => {
      const pmaxCount = (s.pmaxCampaigns ?? []).length;
      const monthlySpend = s.monthlySpendUsd ?? 0;
      if (monthlySpend < 1000) return { verdict: 'na' };
      if (pmaxCount >= 1) return { verdict: 'pass', finding: `${pmaxCount} PMax kampanya aktif`, recommendation: 'Brand exclusion + customer match list ekle (varsa).' };
      return { verdict: 'fail', finding: 'Aylık $1000+ harcama var ama PMax denenmemiş', recommendation: 'Power Pack stratejisi: Search + PMax + Demand Gen birlikte. PMax 30-50 conv/ay sonrası ölçeklenir.' };
    },
  },

  // ─── KEYWORDS & QS (15%) ──────────────────────────────────────
  {
    id: 'G20', name: 'Average Quality Score', category: 'keywords', severity: 'high',
    check: (s) => {
      const qs = s.campaigns?.[0]?.qualityScore?.weighted;
      if (qs == null) return { verdict: 'na' };
      if (qs >= 7) return { verdict: 'pass', finding: `Hesap QS ortalama ${qs.toFixed(1)}`, recommendation: 'Sağlam — koru. RSA testlerini sürdür.' };
      if (qs >= 5) return { verdict: 'warning', finding: `Hesap QS ${qs.toFixed(1)} — orta`, recommendation: 'En düşük QS\'li 20 keyword\'ü incele: ad relevance + landing page experience\'a bak.' };
      return { verdict: 'fail', finding: `Hesap QS ${qs.toFixed(1)} — kritik`, recommendation: 'CPC %50+ pahalıya geliyor. Keyword-ad-LP üçgenini eşleştir: her ad group tek tema, RSA başlıkları keyword içersin, LP H1 = ad group teması.' };
    },
  },
  {
    id: 'G21', name: 'Critical QS keywords (≤3)', category: 'keywords', severity: 'critical',
    check: (s) => {
      const pct = s.campaigns?.[0]?.qualityScore?.criticalPct;
      if (pct == null) return { verdict: 'na' };
      if (pct < 10) return { verdict: 'pass', finding: `Kritik QS keyword oranı ${pct.toFixed(1)}%`, recommendation: 'Düşük seviyede — sürdür.' };
      if (pct < 25) return { verdict: 'warning', finding: `${pct.toFixed(1)}% keyword QS≤3`, recommendation: 'Bu keyword\'leri ya yeniden grupla ya pause et.' };
      return { verdict: 'fail', finding: `${pct.toFixed(1)}% keyword QS≤4 — para yanıyor`, recommendation: 'Critical: pause/restructure. Ad group tema gevşek, theme drift var. Tek keyword-tek ad group denemesi yap.' };
    },
  },

  // ─── ADS & ASSETS (15%) ──────────────────────────────────────
  {
    id: 'G27', name: 'RSA headline count', category: 'ads', severity: 'high',
    check: (s) => {
      const rsa = s.campaigns?.[0]?.rsa;
      if (!rsa) return { verdict: 'na' };
      if (rsa.headlines >= 8) return { verdict: 'pass', finding: `Ortalama ${rsa.headlines} headline`, recommendation: 'İdeal 12-15 hedefle, A/B testleri sürdür.' };
      if (rsa.headlines >= 3) return { verdict: 'warning', finding: `Sadece ${rsa.headlines} headline`, recommendation: '8+\'a çıkar. RSA AI variants oluşturmak için minimum besine ihtiyaç duyar.' };
      return { verdict: 'fail', finding: `${rsa.headlines} headline — RSA neredeyse boş`, recommendation: '8 farklı headline ekle: brand, ürün özelliği, fayda, CTA, sosyal kanıt çeşitliliği.' };
    },
  },
  {
    id: 'G29', name: 'RSA Ad Strength', category: 'ads', severity: 'high',
    check: (s) => {
      const ads = s.campaigns?.[0]?.rsa?.adStrength;
      if (!ads) return { verdict: 'na' };
      if (ads === 'good' || ads === 'excellent') return { verdict: 'pass', finding: `Ad Strength: ${ads}`, recommendation: 'Sağlam — yeni varyantları test etmeyi sürdür.' };
      if (ads === 'average') return { verdict: 'warning', finding: 'Ad Strength: Average', recommendation: 'Headline çeşitliliği + sitelink + image extension ekle. "Good"a çıkmak %5-7 CTR uplift sağlar.' };
      return { verdict: 'fail', finding: 'Ad Strength: Poor', recommendation: 'Min 8 headline, 4 description, pin politikasını gözden geçir.' };
    },
  },
  {
    id: 'G31', name: 'PMax asset density', category: 'ads', severity: 'critical',
    check: (s) => {
      const pmax = s.pmaxCampaigns ?? [];
      if (pmax.length === 0) return { verdict: 'na' };
      const worst = pmax.reduce((min, p) => Math.min(min, p.images), 999);
      if (worst >= 20 && pmax.every(p => p.logos >= 5 && p.videos >= 5)) {
        return { verdict: 'pass', finding: 'PMax asset density yüksek (max yoğunluk)', recommendation: 'Asset rotasyonunu 90 günde bir yap.' };
      }
      if (worst < 5 || pmax.some(p => p.logos === 0 || p.videos === 0)) {
        return { verdict: 'fail', finding: 'Bir asset group\'ta <5 image VEYA logo/video yok', recommendation: 'PMax algoritması besinsiz çalışıyor. Min 20 image, 5 logo, 5 native video ekle (auto-generated kullanma).' };
      }
      return { verdict: 'warning', finding: 'Asset density yetersiz', recommendation: 'Min hedef: 20 image / 5 logo / 5 native video per asset group. Yetersiz density = düşük CTR.' };
    },
  },
  {
    id: 'G35', name: 'Ad copy keyword relevance', category: 'ads', severity: 'high',
    check: () => null,
    llm: true,
    llmPrompt: (s) => `Aşağıdaki Google Ads RSA başlıkları ve ad group temaları var. Headline'lar primary keyword varyantlarını içeriyor mu?

${(s.adCopySamples ?? []).slice(0, 20).map(a => `Headline: "${a.headline}"`).join('\n')}

JSON: {"verdict": "pass|warning|fail", "finding": "...", "recommendation": "..."}`,
  },

  // ─── SETTINGS & TARGETING (10%) ──────────────────────────────
  {
    id: 'G50', name: 'Sitelink extensions', category: 'settings', severity: 'high', fixTimeMinutes: 10,
    check: (s) => {
      const sl = s.campaigns?.[0]?.sitelinks ?? 0;
      if (sl >= 4) return { verdict: 'pass', finding: `${sl} sitelink aktif`, recommendation: 'CTR booster — koru, 30 günde bir taze metin.' };
      if (sl >= 1) return { verdict: 'warning', finding: `Sadece ${sl} sitelink`, recommendation: '4+\'a çıkar. Sitelink CTR\'ı %10-30 yükseltir, ücretsiz alan kapsama.' };
      return { verdict: 'fail', finding: 'Hiç sitelink yok', recommendation: '10 dk: 4 sitelink ekle (Hakkımızda, Fiyatlar, İletişim, Demo). %20 CTR uplift olağan.' };
    },
  },
  {
    id: 'G11', name: 'Geographic targeting accuracy', category: 'settings', severity: 'high', fixTimeMinutes: 2,
    check: (s) => {
      const geo = s.campaigns?.[0]?.geoTargeting;
      if (!geo) return { verdict: 'na' };
      if (geo === 'people_in') return { verdict: 'pass', finding: '"People in" targeting (lokal için doğru)', recommendation: 'Tutarlı — koru.' };
      return { verdict: 'fail', finding: '"People interested in" targeting — yurt dışı trafik kaçabilir', recommendation: 'Settings → Locations → "Presence: People in your targeted locations". 2 dk iş, %15-30 wasted spend kapanır.' };
    },
  },
  {
    id: 'G12', name: 'Network settings', category: 'settings', severity: 'high', fixTimeMinutes: 2,
    check: (s) => {
      const n = s.campaigns?.[0]?.network;
      if (!n) return { verdict: 'na' };
      if (n.search && !n.display && n.searchPartners) return { verdict: 'pass', finding: 'Search + Search Partners ON, Display OFF', recommendation: 'Optimal Search ayarı.' };
      if (n.display && n.search) return { verdict: 'fail', finding: 'Search kampanyasında Display Network açık', recommendation: '2 dk: Settings → Networks → Display Network UNCHECK. CPA bir gecede iyileşir.' };
      if (!n.searchPartners) return { verdict: 'warning', finding: 'Search Partners kapalı', recommendation: 'Search Partners aç — CPA değişmeden +%10-15 reach.' };
      return { verdict: 'pass', finding: 'Network ayarı uygun', recommendation: '' };
    },
  },
  {
    id: 'G39', name: 'Budget constrained campaigns', category: 'settings', severity: 'high',
    check: (s) => {
      const cs = s.campaigns ?? [];
      if (cs.length === 0) return { verdict: 'na' };
      const limited = cs.filter(c => (c.spendToday ?? 0) >= c.budget * 0.95).length;
      const pct = (limited / cs.length) * 100;
      if (pct < 10) return { verdict: 'pass', finding: `${limited}/${cs.length} kampanya budget-limited`, recommendation: 'Sağlam.' };
      if (pct < 30) return { verdict: 'warning', finding: `${limited} kampanya budget cap'e ulaşıyor`, recommendation: 'En iyi performansa sahip top 3 kampanyanın bütçesini %30-50 artır.' };
      return { verdict: 'fail', finding: `${limited} kampanya budget-limited — büyüme tıkalı`, recommendation: 'Top performer\'ları belirleyip bütçeyi kaydır. Budget cap = AI öğrenme tıkalı.' };
    },
  },

  // ─── LANDING PAGE (Settings/Ads cross) ──────────────────────
  {
    id: 'G60', name: 'Landing page relevance', category: 'settings', severity: 'high',
    check: () => null,
    llm: true,
    llmPrompt: (s) => `Aşağıda ad group teması ile landing page H1 eşleşmeleri var. Tema ve LP başlığı uyumlu mu?

${(s.landingPageThemes ?? []).slice(0, 10).map(t => `Ad group: "${t.adGroupTheme}" → LP H1: "${t.lpH1}"`).join('\n')}

JSON: {"verdict": "pass|warning|fail", "finding": "...", "recommendation": "..."}`,
  },
];
