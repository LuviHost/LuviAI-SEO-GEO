/**
 * Chat Skills — hazir asistan gorevleri (Maya Skills paritesi).
 *
 * Her skill, chat'e onceden yazilmis bir gorev prompt'u enjekte eder;
 * asistan tool'lari kullanarak gercek veriyle cevap uretir.
 * `accesses` yalnizca UI rozetleri icindir (hangi veriye bakar).
 */

export interface ChatSkill {
  key: string;
  name: string;
  tag: string; // AGENT | PROMPTS | REPORT | BRIEFING | TREND | DIAGNOSTIC | CONTENT | YOUTUBE | LINKEDIN | ASO
  description: string;
  accesses: string[];
  prompt: string;
  /** Kullanicidan ek girdi ister (ör. YouTube linki) */
  needsInput?: boolean;
  inputPlaceholder?: string;
  /**
   * Skill'in UZERINE KURULU oldugu tool'lar. Biri kullanicinin planinda
   * kapaliysa kart hic gosterilmez — aksi halde kullanici karta tikliyor,
   * asistan kilitli tool'u goremedigi icin bos/yaris bir cevap donuyordu.
   *
   * Prompt'ta gecen ama skill'i ayakta tutmayan tool'lar buraya YAZILMAZ;
   * onlar prompt icinde "erisimin varsa" diye isaretlendi, boylece ust plan
   * ozelligi yuzunden ise yarar bir skill tumden kaybolmaz.
   */
  requiresTools?: string[];
  /** Kart yalnizca sitede izlenen bir uygulama varken anlamli */
  requiresTrackedApp?: boolean;
}

/**
 * Kullaniciya gosterilecek skill'ler.
 *
 * Saf fonksiyon: plan cozumlemesi (hangi tool acik) ve baglam (izlenen
 * uygulama var mi) disaridan gelir, boylece test edilebilir kalir.
 */
export function visibleSkills(
  allowedTools: Set<string>,
  ctx: { hasTrackedApp: boolean },
): ChatSkill[] {
  return CHAT_SKILLS.filter(
    (s) =>
      (s.requiresTools ?? []).every((t) => allowedTools.has(t)) &&
      (!s.requiresTrackedApp || ctx.hasTrackedApp),
  );
}

export const CHAT_SKILLS: ChatSkill[] = [
  {
    key: 'weekly-plan',
    name: 'Bu haftanın planı',
    tag: 'AGENT',
    description: 'Önceliklendirilmiş, kanıta dayalı haftalık yapılacaklar listesi — Aksiyon Planına eklemeye hazır.',
    accesses: ['Fırsatlar', 'Rakipler', 'Citations', 'Aksiyon Planı'],
    // Plan "kanita dayali" oldugu iddiasini icerik firsatlarindan aliyor;
    // o tool kapaliyken skill sadece genel tavsiye uretir, o yuzden gizlenir.
    requiresTools: ['list_content_opportunities', 'get_agent_readiness'],
    prompt: [
      'Bu site için bu haftanın çalışma planını çıkar. Sırasıyla:',
      '1) get_site_overview + get_ai_kpis + get_agent_readiness ile durumu topla.',
      '2) list_content_opportunities ile açık fırsatları al; get_prompt_coverage ile hangi dallarda kaybettiğimizi gör.',
      '3) En yüksek etkili 5-7 maddelik önceliklendirilmiş plan yaz — her maddede NEDEN (kanıt: hangi metrik/fırsat) ve tahmini etki.',
      '4) Kullanıcıya planı Aksiyon Planına eklemeyi öner; onaylarsa add_action_plan_item ile ekle.',
    ].join('\n'),
  },
  {
    key: 'generate-prompts',
    name: 'Prompt üret',
    tag: 'PROMPTS',
    description: 'Dengeli, kanıta dayalı görünürlük prompt seti — çoğunlukla marka-dışı.',
    accesses: ['Personalar', 'Fanout', 'Rakipler', 'Promptlar'],
    prompt: [
      'Bu site için Prompt Lab\'e eklenecek 10 yeni izleme sorusu öner.',
      'Önce list_prompts ile mevcut soruları al (tekrar önermemek için) ve get_site_overview ile nişi öğren.',
      'Kurallar: çoğunluk marka-dışı (kategori sorgusu), 2-3 karşılaştırma ("X vs Y", "en iyi ..."), 2 güven sorgusu ("güvenilir mi").',
      'Her soru için tek satır gerekçe yaz. Kullanıcı onaylarsa soruları listeleyip Prompt Lab\'e manuel eklemesini söyle (toplu ekleme UI\'da).',
    ].join('\n'),
  },
  {
    key: 'visibility-report',
    name: 'Görünürlük raporu',
    tag: 'REPORT',
    description: 'Paylaşıma hazır tam rapor — sağlayıcı kırılımı ve etiketlerle.',
    accesses: ['Görünürlük', 'Citations', 'KPI'],
    prompt: [
      'Bu site için yönetici seviyesinde bir AI görünürlük raporu hazırla:',
      '1) get_ai_kpis — başlık metrikleri ve deltalar.',
      '2) list_prompts — en iyi ve en kötü 5 prompt.',
      '3) get_prompt_coverage — dal bazında zayıflıklar.',
      '4) get_product_radar (erişimin varsa) — kategori önerilerinde durum.',
      'Rapor: Özet (3 cümle) → Metrikler tablosu → Kazanımlar → Riskler → Önerilen 3 aksiyon. Markdown formatında, paylaşılabilir netlikte yaz.',
    ].join('\n'),
  },
  {
    key: 'geo-briefing',
    name: '7 günlük GEO brifingi',
    tag: 'BRIEFING',
    description: 'Yönetici nabzı: skor, kazanımlar, riskler ve yapılacak TEK hamle.',
    accesses: ['Görünürlük', 'Kazanım/Kayıp'],
    prompt: [
      'Son 7 günün GEO brifingini çıkar: get_ai_kpis + get_geo_score_card (+ erişimin varsa list_content_opportunities).',
      'Format: SKOR (tek sayı + trend) → 3 KAZANIM → 3 RİSK → "BU HAFTANIN TEK HAMLESİ" (en yüksek kaldıraçlı iş, gerekçesiyle).',
      'Kısa tut — yönetici 60 saniyede okuyabilmeli.',
    ].join('\n'),
  },
  {
    key: 'two-week-movement',
    name: '2 haftalık değişim',
    tag: 'TREND',
    description: 'Son 14 günde ne değişti — etikete göre, yükselen ve düşen.',
    accesses: ['Görünürlük', 'KPI'],
    prompt: [
      'Son 14 günün değişim analizini yap: get_ai_kpis serilerini kullan (series alanları 14 günlük).',
      'Yükselen ve düşen metrikleri ayır; her önemli değişim için olası nedeni yaz (yeni içerik? robots değişimi? rakip hamlesi?).',
      'get_analytics_summary ile GSC trendini de karşılaştır — AI görünürlüğü ile organik trafik ayrışıyor mu?',
    ].join('\n'),
  },
  {
    key: 'diagnose-visibility',
    name: 'Görünürlük teşhisi',
    tag: 'DIAGNOSTIC',
    description: 'Nerede kaybediyorsun — prompt, rakip ve çözüm.',
    accesses: ['Promptlar', 'Rakipler'],
    prompt: [
      'Görünürlük kaybı teşhisi yap:',
      '1) list_prompts — skoru en düşük 5 prompt.',
      '2) get_prompt_coverage — hangi dal türlerinde (reviews/trust/comparison) zayıfız.',
      '3) get_product_radar (erişimin varsa) — bizim yerimize kimler öneriliyor.',
      '4) Her kayıp için: neden kaybediyoruz (hipotez) + hangi içerik/teknik iş düzeltir + (erişimin varsa) list_content_opportunities\'te karşılığı var mı.',
      'Sonunda en kritik tek düzeltmeyi öner ve kullanıcı isterse add_action_plan_item ile plana ekle.',
    ].join('\n'),
  },
  {
    key: 'newsjacking',
    name: 'Newsjacking',
    tag: 'CONTENT',
    description: 'Bu hafta yayınlayıp alıntı alabileceğin taze açılar.',
    accesses: ['Promptlar', 'Fırsatlar'],
    prompt: [
      'Bu sitenin nişinde bu hafta yayınlanabilecek 5 güncel içerik açısı öner.',
      'get_site_overview ile nişi al; get_prompt_coverage (ve erişimin varsa list_content_opportunities) ile hangi sorgu boşluklarının açık olduğunu gör.',
      'Her açı için: başlık + neden şimdi (güncellik kancası) + hedef sorgu + tahmini zorluk.',
      'Kullanıcı birini seçerse create_article ile üretimi başlatmayı öner (onay almadan başlatma).',
    ].join('\n'),
  },
  {
    key: 'youtube-optimizer',
    name: 'YouTube Optimizer',
    tag: 'YOUTUBE',
    description: 'Video başlığı/açıklaması + fanout sorgularına hizalı bölüm zaman çizelgesi.',
    accesses: ['Fanout', 'Promptlar'],
    needsInput: true,
    inputPlaceholder: 'Video konusu veya mevcut başlık/açıklama yapıştır',
    prompt: [
      'Kullanıcının verdiği YouTube videosu için AI-arama-uyumlu optimizasyon üret:',
      '1) get_prompt_coverage + list_prompts ile sitenin hedef sorgularını al.',
      '2) Yeni başlık (60 karakter), açıklama (ilk 2 satır kanca + sorgu hizalı), 8-12 bölümlük timestamp planı — bölüm adları fanout sorgularına hizalı.',
      '3) 10 etiket + sabitlenecek yorum önerisi.',
    ].join('\n'),
  },
  {
    key: 'linkedin-generate',
    name: 'LinkedIn içerik üret',
    tag: 'LINKEDIN',
    description: 'Makaleden veya konudan LinkedIn gönderisi — kanca + yapı + CTA.',
    accesses: ['Makaleler'],
    needsInput: true,
    inputPlaceholder: 'Konu yaz veya makale seç (list_articles)',
    prompt: [
      'LinkedIn gönderisi üret. Kullanıcı konu vermediyse list_articles ile son yayınlanan makaleyi al ve onu temel al.',
      'Format: güçlü kanca (ilk 2 satır) → 3-5 kısa paragraf (her biri tek fikir) → madde işaretli çıkarımlar → CTA.',
      'İki varyant ver: (A) hikaye anlatımı, (B) veri/liste odaklı. Emoji az, jargon yok.',
    ].join('\n'),
  },
  {
    key: 'aso-pulse',
    name: 'ASO nabzı',
    tag: 'ASO',
    description: 'Uygulama sıralamaları + yorum sentimenti + mağaza fırsatları (rakipte yok).',
    accesses: ['ASO', 'Keywords', 'Reviews'],
    // Izlenen uygulama yokken kart "uygulama bulunamadi" cevabi uretiyordu
    requiresTrackedApp: true,
    prompt: [
      'Mobil uygulama ASO durumunu çıkar:',
      '1) list_tracked_apps — izlenen uygulamalar.',
      '2) get_app_keywords — yükselen/düşen sıralamalar (previousRank vs currentRank).',
      '3) get_app_reviews_summary — sentiment + son negatif temalar.',
      'Çıktı: sıralama hareketleri → yorumlardan çıkan 3 tema → her tema için aksiyon (What\'s New metni? FAQ? blog konusu?) → tek kritik hamle.',
    ].join('\n'),
  },
];
