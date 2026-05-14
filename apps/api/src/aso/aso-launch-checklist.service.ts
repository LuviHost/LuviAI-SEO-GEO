import { Injectable } from '@nestjs/common';

/**
 * Launch checklist — App Store ve Google Play için prelaunch + update checklist.
 *
 * TypeScript port of claude-code-aso-skill/launch_checklist.py (MIT).
 * Statik checklist data + compliance validation; AI ile genişletilebilir.
 */

export type Platform = 'apple' | 'google' | 'both';

export interface ChecklistItem {
  id: string;
  category: 'metadata' | 'assets' | 'compliance' | 'analytics' | 'support' | 'marketing';
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  platform: 'apple' | 'google' | 'both';
}

export interface ComplianceReport {
  platform: 'apple' | 'google';
  ok: boolean;
  issues: Array<{ field: string; problem: string; how_to_fix: string }>;
}

export interface UpdatePlan {
  version: string;
  major_changes: string[];
  release_notes_draft: string;
  recommended_window: string;  // örn: 'Tuesday-Thursday 10am UTC'
}

@Injectable()
export class AsoLaunchChecklistService {
  /** Prelaunch checklist üret — platform'a göre filtrelenmiş */
  generatePrelaunchChecklist(opts: { platform: Platform; appCategory?: string }): ChecklistItem[] {
    const apple = this.appleChecklist();
    const google = this.googleChecklist();
    const universal = this.universalChecklist();
    if (opts.platform === 'apple')  return [...apple,  ...universal];
    if (opts.platform === 'google') return [...google, ...universal];
    return [...apple, ...google, ...universal];
  }

  /** App Store metadata uyumluluk kontrolü */
  validateAppleCompliance(meta: { title: string; subtitle?: string; description: string; keywordField?: string; iconUrl?: string }): ComplianceReport {
    const issues: ComplianceReport['issues'] = [];
    if (!meta.title) issues.push({ field: 'title', problem: 'boş', how_to_fix: 'Marka + ana keyword (30 karakter max)' });
    if (meta.title && meta.title.length > 30) issues.push({ field: 'title', problem: '30 karakteri aşıyor', how_to_fix: 'Kısalt veya keyword\'ü subtitle\'a taşı' });
    if (meta.subtitle && meta.subtitle.length > 30) issues.push({ field: 'subtitle', problem: '30 karakteri aşıyor', how_to_fix: 'Kısalt' });
    if (!meta.description) issues.push({ field: 'description', problem: 'boş', how_to_fix: 'En az 500 karakter, ideal 1500-2000' });
    if (meta.description && meta.description.length < 500) issues.push({ field: 'description', problem: 'çok kısa', how_to_fix: 'Özellik listesi + sosyal kanıt + CTA ekle' });
    if (meta.keywordField && meta.keywordField.length > 100) issues.push({ field: 'keyword_field', problem: '100 karakteri aşıyor', how_to_fix: 'Title/subtitle\'da geçen kelimeleri çıkar' });
    if (!meta.iconUrl) issues.push({ field: 'icon', problem: 'eksik', how_to_fix: '1024×1024 PNG, alpha kanalsız' });
    return { platform: 'apple', ok: issues.length === 0, issues };
  }

  /** Google Play metadata uyumluluk kontrolü */
  validateGoogleCompliance(meta: { title: string; shortDescription?: string; description: string; iconUrl?: string }): ComplianceReport {
    const issues: ComplianceReport['issues'] = [];
    if (!meta.title) issues.push({ field: 'title', problem: 'boş', how_to_fix: '30 karakter max' });
    if (meta.title && meta.title.length > 30) issues.push({ field: 'title', problem: '30 karakteri aşıyor', how_to_fix: 'Kısalt' });
    if (!meta.shortDescription) issues.push({ field: 'short_description', problem: 'eksik', how_to_fix: '80 karakter, listing\'in en görünür kısmı' });
    if (meta.shortDescription && meta.shortDescription.length > 80) issues.push({ field: 'short_description', problem: '80 karakteri aşıyor', how_to_fix: 'Kısalt' });
    if (!meta.description || meta.description.length < 500) issues.push({ field: 'description', problem: 'çok kısa', how_to_fix: 'Madde madde özellik + CTA' });
    if (!meta.iconUrl) issues.push({ field: 'icon', problem: 'eksik', how_to_fix: '512×512 32-bit PNG' });
    return { platform: 'google', ok: issues.length === 0, issues };
  }

  /** Update plan oluştur — release notes draft + zamanlama */
  createUpdatePlan(opts: { previousVersion: string; nextVersion: string; majorChanges: string[]; bugFixes?: string[] }): UpdatePlan {
    const noteLines: string[] = [];
    if (opts.majorChanges.length > 0) {
      noteLines.push('🆕 Yenilikler:');
      for (const c of opts.majorChanges) noteLines.push(`• ${c}`);
    }
    if (opts.bugFixes && opts.bugFixes.length > 0) {
      noteLines.push('');
      noteLines.push('🛠 Hata düzeltmeleri:');
      for (const b of opts.bugFixes) noteLines.push(`• ${b}`);
    }
    return {
      version: opts.nextVersion,
      major_changes: opts.majorChanges,
      release_notes_draft: noteLines.join('\n'),
      recommended_window: this.optimalLaunchWindow(),
    };
  }

  /** Mevsimsel kampanya takvimi */
  planSeasonalCampaigns(opts: { country?: string; appCategory?: string } = {}): Array<{
    event: string; month: string; recommendation: string;
  }> {
    return [
      { event: 'New Year resolutions',         month: 'Ocak',  recommendation: 'Productivity / fitness / education app\'leri için en yüksek install pikinin yaşandığı dönem; metadata\'ya "new year" / "2026 hedefleri" gibi keyword\'leri ekle.' },
      { event: 'Valentine\'s Day',              month: 'Şubat', recommendation: 'Sosyal / dating / hediye app\'lerinde 1-14 Şubat arası özel kampanya.' },
      { event: 'Anneler/Babalar Günü',          month: 'May/Haz', recommendation: 'Aile / fotoğraf / hediye uygulamaları için hedeflenebilir.' },
      { event: 'Yaz tatili',                    month: 'Tem-Ağu', recommendation: 'Seyahat / oyun / kamp app\'leri için pik dönem.' },
      { event: 'Geri okula',                    month: 'Eylül', recommendation: 'Education / productivity / yazılım eğitimi app\'leri için yüksek mevsim.' },
      { event: 'Black Friday / Cyber Monday',   month: 'Kasım', recommendation: 'Subscription discount, in-app promo. Apple/Play\'de paid promo öncesi 1 hafta hazırlık.' },
      { event: 'Yılbaşı (önce)',                month: 'Aralık', recommendation: 'Tatil temalı icon variant + festive screenshot. Apple "Indie of the Year" başvurusu deadline.' },
    ];
  }

  // ─────────────────────────────────
  private appleChecklist(): ChecklistItem[] {
    return [
      { id: 'a-1', category: 'metadata',   title: 'App title (30 char)',                description: 'Marka + ana keyword, 30 karakter limit',                                                                                priority: 'critical', platform: 'apple' },
      { id: 'a-2', category: 'metadata',   title: 'Subtitle (30 char)',                  description: 'Secondary value prop + yan keyword',                                                                                     priority: 'critical', platform: 'apple' },
      { id: 'a-3', category: 'metadata',   title: 'Keyword field (100 char)',            description: 'Title\'da olmayan keyword\'leri virgülle ayır',                                                                          priority: 'critical', platform: 'apple' },
      { id: 'a-4', category: 'metadata',   title: 'Description (1500-2500 char)',        description: 'Hook + özellikler + sosyal kanıt + CTA',                                                                                  priority: 'high',     platform: 'apple' },
      { id: 'a-5', category: 'assets',     title: 'App Icon 1024×1024',                   description: 'PNG, alpha kanalsız, RGB, rounded corner Apple uygular',                                                                priority: 'critical', platform: 'apple' },
      { id: 'a-6', category: 'assets',     title: 'iPhone 6.7" screenshots × 5-10',     description: '1290×2796 / iOS 17+',                                                                                                    priority: 'critical', platform: 'apple' },
      { id: 'a-7', category: 'assets',     title: 'iPad 13" screenshots',                description: '2048×2732 (yalnızca iPad destekliyorsa)',                                                                                priority: 'medium',   platform: 'apple' },
      { id: 'a-8', category: 'assets',     title: 'App preview video (15-30s)',          description: 'M4V/MOV/MP4; iOS 17+ device frame',                                                                                      priority: 'medium',   platform: 'apple' },
      { id: 'a-9', category: 'compliance', title: 'Privacy policy URL',                  description: 'GDPR/KVKK uyumlu; uygulamanın topladığı verilere uygun',                                                                priority: 'critical', platform: 'apple' },
      { id: 'a-10', category: 'compliance',title: 'Privacy Nutrition Labels',            description: 'App Connect → Privacy → tüm 3rd party SDK\'lar dahil',                                                                  priority: 'critical', platform: 'apple' },
      { id: 'a-11', category: 'compliance',title: 'Age rating (Made for Kids?)',         description: 'Yaş kısıtlaması doğru seç; reklam içeriyorsa 4+ uygun değil',                                                          priority: 'high',     platform: 'apple' },
      { id: 'a-12', category: 'compliance',title: 'TestFlight beta + Apple review',      description: 'En az 5 tester, %80 crash-free oturum',                                                                                  priority: 'high',     platform: 'apple' },
      { id: 'a-13', category: 'support',   title: 'Support URL + e-posta',               description: '24-saat içinde cevaplanabilir',                                                                                          priority: 'high',     platform: 'apple' },
    ];
  }

  private googleChecklist(): ChecklistItem[] {
    return [
      { id: 'g-1', category: 'metadata',   title: 'App title (30 char)',                 description: 'Brand + ana keyword',                                                                                                    priority: 'critical', platform: 'google' },
      { id: 'g-2', category: 'metadata',   title: 'Short description (80 char)',         description: 'Listing\'in en görünür kısmı',                                                                                          priority: 'critical', platform: 'google' },
      { id: 'g-3', category: 'metadata',   title: 'Long description (4000 char)',        description: 'Madde işaretli özellikler + keyword\'ler doğal dağılmış',                                                              priority: 'high',     platform: 'google' },
      { id: 'g-4', category: 'assets',     title: 'Icon 512×512 PNG',                    description: '32-bit PNG, alpha şeffaf değil',                                                                                         priority: 'critical', platform: 'google' },
      { id: 'g-5', category: 'assets',     title: 'Feature graphic 1024×500',            description: 'Featured spot ve search results\'ta görünür',                                                                            priority: 'critical', platform: 'google' },
      { id: 'g-6', category: 'assets',     title: 'Phone screenshots × 2-8',             description: '1080×1920 ideal',                                                                                                        priority: 'critical', platform: 'google' },
      { id: 'g-7', category: 'assets',     title: 'Tablet screenshots',                  description: '7" + 10" tablet (varsa)',                                                                                                priority: 'medium',   platform: 'google' },
      { id: 'g-8', category: 'compliance', title: 'Privacy policy URL',                  description: 'Aynı zamanda Data Safety formu doldurulmalı',                                                                            priority: 'critical', platform: 'google' },
      { id: 'g-9', category: 'compliance', title: 'Data Safety formu',                   description: 'Hangi veriler toplanıyor + 3rd party SDK\'lar',                                                                          priority: 'critical', platform: 'google' },
      { id: 'g-10', category: 'compliance',title: 'Target API level',                    description: 'Google\'ın son istediği API level',                                                                                       priority: 'high',     platform: 'google' },
      { id: 'g-11', category: 'compliance',title: 'Internal testing → Closed → Open',    description: 'Production öncesi 3 aşamalı rollout',                                                                                    priority: 'high',     platform: 'google' },
    ];
  }

  private universalChecklist(): ChecklistItem[] {
    return [
      { id: 'u-1', category: 'analytics', title: 'Analytics SDK entegre',                description: 'Firebase / Amplitude / Mixpanel — install + retention + funnel',                                                          priority: 'high',     platform: 'both' },
      { id: 'u-2', category: 'analytics', title: 'Crash reporting',                       description: 'Crashlytics / Sentry',                                                                                                  priority: 'high',     platform: 'both' },
      { id: 'u-3', category: 'marketing', title: 'Landing page',                          description: 'App Store + Play Store linkleri, "Get the app" CTA',                                                                   priority: 'medium',   platform: 'both' },
      { id: 'u-4', category: 'marketing', title: 'Press kit + media outreach',            description: 'TechCrunch, ProductHunt, indie press; embargo bitiş tarihi',                                                            priority: 'medium',   platform: 'both' },
      { id: 'u-5', category: 'marketing', title: 'Social media teaser',                   description: 'Twitter/X, LinkedIn, TikTok 30s reveal video',                                                                          priority: 'low',      platform: 'both' },
      { id: 'u-6', category: 'support',   title: 'FAQ + help docs',                       description: 'Önemli onboarding sorularına cevap; in-app deeplink',                                                                  priority: 'medium',   platform: 'both' },
    ];
  }

  private optimalLaunchWindow(): string {
    return 'Salı-Perşembe 10:00 UTC (App Store): editöryal ekibin gözden geçirme şansı yüksek, hafta sonu trafik yığılması yok';
  }
}
