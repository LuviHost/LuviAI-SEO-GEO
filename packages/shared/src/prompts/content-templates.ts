/**
 * İçerik tipleri ve tipe göre yazım şablonları.
 *
 * Neden var: AI cevap motorları "X mi Y mi", "en iyi X", "X alternatifleri",
 * "X fiyatları" gibi sorularda belirli bir sayfa iskeletini (hüküm cümlesi,
 * yan yana tablo, kime uygun etiketi, numaralı adım) alıntılıyor. Hat bugüne
 * kadar her konuyu tek bir "rehber" iskeletiyle yazıyordu; konu sıralayıcının
 * ürettiği schema_type (Article | HowTo | Comparison) yazara hiç ulaşmıyordu.
 *
 * GERİYE UYUMLULUK: tip yoksa / belirlenemezse 'guide' seçilir ve 'guide' için
 * şablon bloğu BOŞ dizedir. Yani tipi olmayan konu bugünkü prompt'ların
 * birebir aynısıyla yazılır (bkz. withContentTemplate).
 */

export const CONTENT_TYPES = [
  'guide',
  'howto',
  'comparison',
  'best_for',
  'alternatives',
  'pricing',
  'listicle',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** Tip nereden geldi — öncelik sırasıyla */
export type ContentTypeSource = 'explicit' | 'ranker' | 'classifier' | 'default';

export interface ContentTypeDecision {
  type: ContentType;
  source: ContentTypeSource;
}

/** Panelde rozet / log için kısa Türkçe etiket */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  guide: 'Rehber',
  howto: 'Nasıl yapılır',
  comparison: 'Karşılaştırma',
  best_for: 'En iyi seçenekler',
  alternatives: 'Alternatifler',
  pricing: 'Fiyatlar',
  listicle: 'Liste',
};

/** Ürün/fiyat iddiası taşıyan tipler: uydurma fiyat-özellik riski en yüksek olanlar */
const PRODUCT_FACT_TYPES: ReadonlySet<ContentType> = new Set(['comparison', 'best_for', 'alternatives', 'pricing']);

/** Tip ürün fiyatı / özelliği iddiası taşıyor mu (comparison, best_for, alternatives, pricing) */
export function isProductFactType(type: ContentType): boolean {
  return PRODUCT_FACT_TYPES.has(type);
}

/**
 * Tip kararı kapıda ENGELLEYİCİ kural doğurabilir mi? Yalnız açık seçim ve
 * sıralayıcı kararı. Başlık sınıflandırıcının tahmini (ve varsayılan) yalnız
 * öneri (warn) üretir: bugün geçen makale tahmin yüzünden durmaz.
 */
export function isAuthoritativeSource(source: ContentTypeSource | undefined): boolean {
  return source === 'explicit' || source === 'ranker';
}

/** Bilinmeyen değeri null'a çevirir; "best-for", "Best For" gibi yazımları kabul eder. */
export function normalizeContentType(raw: unknown): ContentType | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (CONTENT_TYPES as readonly string[]).includes(v) ? (v as ContentType) : null;
}

/**
 * Konu sıralayıcının eski çıktısı (schema_type: Article | HowTo | Comparison).
 * Article genel varsayılandır; ayırt edici bir karar değildir (bkz. resolveContentType).
 */
export function contentTypeFromSchemaType(raw: unknown): ContentType | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v === 'howto' || v === 'how-to' || v === 'how_to') return 'howto';
  if (v === 'comparison') return 'comparison';
  if (v === 'article' || v === 'blogposting') return 'guide';
  return null;
}

/** Türkçe harfleri ASCII'ye indirger, küçültür; başlık kalıpları ASCII üzerinden eşleşir. */
function foldTr(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a')
    .replace(/[îì]/g, 'i')
    .replace(/[ûù]/g, 'u')
    .replace(/[’'`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ────────────────────────────────────────────────────────────
//  Başlık sınıflandırıcı — DAR ve muhafazakâr
// ────────────────────────────────────────────────────────────
//
// Yanlış pozitif pahalı: rehber dışı tip yazara şablon dayatır. Bu yüzden her
// kalıp yalnız "yüksek güvenli" biçimleri tanır; şüphede null (→ guide). Kalıplar
// ASCII'ye indirgenmiş küçük harfli başlıkta aranır. Gerçekçi başlık derlemi:
// content-templates.spec.ts.

/** "kur farkı", "fiyat farkı", "vade farkı" bir kıyas değil, terimdir */
const TERM_FARK_RE = /\b(kur|fiyat|vade|yas|saat|zaman|faiz|maliyet|kambiyo) fark/;
const COMPARISON_RE: RegExp[] = [
  /(^|\s)(vs\.?|versus)(\s|$)/,
  /\b(mi|mu) yoksa\b/,
  /\bkarsilastirma(si|lari)?\b|\bkiyaslama(si)?\b|\bcomparison\b|\bcompared to\b/,
  /\bwhich (one )?is better\b.*\bor\b/,
  /\barasindaki fark(lar)?(i)?\b/,
];
/** "A ile B farkı", "brüt ve net maaş farkı": iki seçenek bağlacı + fark */
const PAIR_FARK_RE = /\b(ile|ve|and)\b.*\bfark(i|lari)\b/;

/** Evet/hayır sorusunun yüklemi: "zorunlu mu", "silinir mi", "yapılandırılır mı" */
const YES_NO_WORDS = new Set([
  'zorunlu', 'var', 'yok', 'gerekli', 'mumkun', 'dogru', 'yasal', 'gecerli', 'sart', 'lazim',
  'olur', 'gerekir', 'yapilir', 'edilir', 'iade', 'dahil', 'muaf', 'guvenli', 'karli', 'mantikli',
]);
function isNounOption(option: string): boolean {
  const words = option.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  const last = words[words.length - 1];
  if (YES_NO_WORDS.has(last)) return false;
  // edilgen / dönüşlü geniş zaman yüklemi: silinir, yapılandırılır, ödenir
  if (/(il|ul|in|un|n)(ir|ur)$/.test(last) && last.length > 4) return false;
  return true;
}
/**
 * "Paraşüt mü Logo İşbaşı mı?", "Online eğitim mi yüz yüze eğitim mi daha verimli?":
 * virgülsüz, iki kısa ad öbeği, iki soru eki. Virgüllü ya da yüklemli evet/hayır
 * soruları ("borcu yapılandırılır mı, faizi silinir mi?") kıyas değildir.
 */
function isTwoOptionQuestion(t: string): boolean {
  const m = t.match(/^([^,?]{1,40}?)\s+m[iu]\s+([^,?]{1,40}?)\s+m[iu](\?|\s|$)/);
  if (!m) return false;
  return isNounOption(m[1]) && isNounOption(m[2]);
}

/** Yalnız "X alternatifleri / alternatifi", "alternatives to X", "X alternatives"; sıfat "alternatif finansman" değil */
const ALTERNATIVES_RE = /\S\s+alternatif(i|leri|lerine|lerini|leri nelerdir)\b|\balternatives? to\b|\S\s+alternatives\b|\byerine (ne|hangi\b)|\bbenzeri (uygulama|program|arac|site|platform)/;

/**
 * Fiyat şablonu yazılım / abonelik planları içindir. Yerel hizmet ücretleri
 * ("kombi bakım ücreti", "diş implantı fiyatları", "kargo ücretleri") rehber kalır.
 */
const PRICE_WORD_RE = /\bfiyat(i|lari|listesi)\b|\bucret(i|leri)\b|\bprices?\b/;
const PLAN_CONTEXT_RE = /\b(plan(i|lari)?|paket(i|leri)?|abonelik|uyelik|lisans|program(i|lari)?|yazilim(i|lari)?|uygulama(si|lari)?|platform(u|lari)?|hosting|sunucu|vps|domain|crm|erp|saas|eklenti(si|leri)?|tema(si|lari)?|software|app|tool)\b/;
const WHY_RE = /\b(neden|nicin|niye|why)\b/;
/** Bilinen abonelik ürünleri: "Notion fiyatları", "Google Workspace ücretleri" (belirsiz adlar — Logo, Paraşüt — bilerek yok) */
const KNOWN_SAAS_RE = /\b(notion|google workspace|slack|shopify|wix|webflow|squarespace|canva|hubspot|mailchimp|zoom|trello|asana|figma|chatgpt|microsoft 365|office 365|semrush|ahrefs|ikas|ticimax|ideasoft|jira|clickup|airtable|zapier|dropbox|github)\b/;
/** Genel fiyatlandırma konusu, bir ürünün planları değil: "pricing strategies", "SaaS pricing models" */
const PRICING_TOPIC_RE = /\bpricing (strateg|model|psycholog|tips|tactic|framework)/;
/** "Webflow pricing": özel ad + pricing (orijinal başlıkta büyük harfle) */
const NAMED_PRICING_RE = /(^|\s)(?!SaaS\b|B2B\b|B2C\b)\p{Lu}[\p{L}\d.]*\s+pricing\b/u;
function isPricingTitle(t: string, original: string): boolean {
  if (WHY_RE.test(t)) return false;
  if (PRICING_TOPIC_RE.test(t)) return false;
  if (/\bpricing (page|plans?)\b|\bplans? (and|&) pric/.test(t)) return true;
  if (/\bpricing\b/.test(t)) return NAMED_PRICING_RE.test(original);
  if (KNOWN_SAAS_RE.test(t) && PRICE_WORD_RE.test(t)) return true;
  // "Notion fiyatlandırması" (X'in fiyatlandırması); yalın "fiyatlandırma stratejisi" değil
  if (/\bfiyatlandirmasi\b/.test(t)) return true;
  return PRICE_WORD_RE.test(t) && PLAN_CONTEXT_RE.test(t);
}

const BEST_FOR_RE = /\ben iyi\b|\ben uygun\b|\bbest\b(?! practices?\b)|\btop \d{1,2}\b/;

/**
 * "nasıl" yalnız iş tarif eden edilgen yüklemle howto: "nasıl kurulur / hesaplanır /
 * alınır". "nasıl etkiler / seçilir / değişir / çalışır / işler / olur" rehberdir.
 */
const HOWTO_VERBS = [
  'yapilir', 'kurulur', 'hesaplanir', 'alinir', 'acilir', 'yazilir', 'eklenir', 'yuklenir', 'kaldirilir',
  'baglanir', 'olusturulur', 'basvurulur', 'odenir', 'kesilir', 'duzenlenir', 'yapilandirilir', 'kapatilir',
  'silinir', 'degistirilir', 'calisilir', 'yukselir', 'yukseltilir', 'temizlenir', 'hazirlanir', 'doldurulur',
  'gonderilir', 'edilir', 'ayarlanir', 'sorgulanir', 'ogrenilir', 'indirilir', 'guncellenir', 'tasinir',
  'aktarilir', 'kaydedilir', 'onaylanir', 'imzalanir', 'artirilir', 'dusurulur', 'tasarlanir', 'yedeklenir',
  'sifrelenir', 'cikarilir', 'kullanilir', 'giderilir', 'onarilir', 'cozulur', 'bulunur',
];
const HOWTO_VERB_RE = new RegExp(`\\b(nasil|nereden)\\b.*\\b(${HOWTO_VERBS.join('|')})\\b`);
const HOWTO_PHRASE_RE = /\bhow to\b|\badim adim\b|\bstep by step\b|\b\d{1,2} adimda\b/;

/**
 * 1-2 haneli sayı + (en çok 2 sıfat/isim) + liste nesnesi: "7 hata", "7 Kritik SEO Hatası",
 * "10 verimli çalışma tekniği". Türkçede sayıdan sonra isim tekildir ve iyelik eki alabilir
 * (hatası, ipucu, avantajı), bu yüzden kök + ek eşleşir. 4 haneli yıllar sayılmaz.
 */
const LISTICLE_RE = /(^|\s)([2-9]|[1-4]\d|50)\s+(\p{L}+\s+){0,2}(yol|ipuc|oneri|madde|neden|hata|arac|strateji|yontem|ornek|soru|taktik|fikir|kural|avantaj|dezavantaj|sey|tekni|ozelli|trend|sir|way|tip|reason|mistake|tool|idea|thing)\p{L}*/u;

/**
 * Deterministik başlık sınıflandırıcı (Türkçe + İngilizce).
 * Belirsizse null döner (çağıran 'guide'a düşer). Sıra özgülden genele:
 * karşılaştırma > alternatifler > fiyat > en iyi > nasıl > liste.
 */
export function classifyTopicTitle(title: unknown): ContentType | null {
  if (typeof title !== 'string' || !title.trim()) return null;
  const t = foldTr(title);
  if (COMPARISON_RE.some((re) => re.test(t))) return 'comparison';
  if (!TERM_FARK_RE.test(t) && PAIR_FARK_RE.test(t)) return 'comparison';
  if (isTwoOptionQuestion(t)) return 'comparison';
  if (ALTERNATIVES_RE.test(t)) return 'alternatives';
  const isHowto = HOWTO_PHRASE_RE.test(t) || HOWTO_VERB_RE.test(t);
  // "ücretleri nasıl iade edilir": iş tarif eden yüklem fiyat sözcüğünden önce gelir
  if (!isHowto && isPricingTitle(t, title)) return 'pricing';
  const isListicle = LISTICLE_RE.test(t);
  // "Top 10 SEO mistakes" liste; "Top 5 hosting providers" en iyi seçenekler
  if (BEST_FOR_RE.test(t) && !(/\btop \d{1,2}\b/.test(t) && !/\b(en iyi|en uygun|best)\b/.test(t) && isListicle)) return 'best_for';
  if (isHowto) return 'howto';
  if (isListicle) return 'listicle';
  return null;
}

export interface ResolveContentTypeInput {
  /** Kullanıcının / API'nin açıkça seçtiği tip */
  explicit?: unknown;
  /** Konu sıralayıcının önerdiği content_type */
  rankerContentType?: unknown;
  /** Konu sıralayıcının eski schema_type alanı (Article | HowTo | Comparison) */
  rankerSchemaType?: unknown;
  /** Konu başlığı (sınıflandırıcı için) */
  title?: unknown;
}

/**
 * Öncelik: açık seçim > sıralayıcı > başlık sınıflandırıcı > 'guide'.
 *
 * Tek istisna: sıralayıcının yalnız schema_type "Article" demesi ayırt edici bir
 * karar değil (prompt'taki varsayılan değer); "X vs Y" başlığını rehbere
 * kilitlememesi için bu durumda sınıflandırıcının tipi geçerli olur.
 * Sıralayıcı content_type alanında açıkça 'guide' derse o geçerlidir.
 */
export function resolveContentType(input: ResolveContentTypeInput): ContentTypeDecision {
  const explicit = normalizeContentType(input.explicit);
  if (explicit) return { type: explicit, source: 'explicit' };

  const rankerType = normalizeContentType(input.rankerContentType);
  if (rankerType) return { type: rankerType, source: 'ranker' };

  const fromSchema = contentTypeFromSchemaType(input.rankerSchemaType);
  const classified = classifyTopicTitle(input.title);
  if (fromSchema && fromSchema !== 'guide') return { type: fromSchema, source: 'ranker' };
  if (classified) return { type: classified, source: 'classifier' };
  if (fromSchema) return { type: fromSchema, source: 'ranker' };
  return { type: 'guide', source: 'default' };
}

// ────────────────────────────────────────────────────────────
//  Şablon blokları
// ────────────────────────────────────────────────────────────

/** Tipe özgü iskelet (yazar + taslak ortak). guide için yok. */
const TEMPLATE_BODY: Record<Exclude<ContentType, 'guide'>, string> = {
  comparison: `İçerik tipi: KARŞILAŞTIRMA (X vs Y)
1. Hüküm ilk cümlede: "> **Hızlı cevap:**" bloğunun İLK cümlesi net bir tercih söyler ("Çoğu küçük işletme için X, ... gerekiyorsa Y daha uygun."). "İkisi de iyi, ihtiyaca bağlı" gibi kaçamak hüküm yazma.
2. "X ile Y arasındaki farklar neler?" H2'si altında yan yana karşılaştırma tablosu (zorunlu): sütunlar seçenekler (X | Y), satırlar Özellikler, Fiyat, Entegrasyon, Destek. Fiyat satırına yalnız kaynağı olan rakamı yaz; yoksa "Ücretsiz plan var / Ücretli" gibi niteliksel değer.
3. "Hangisi kime uygun?" H2'si: 2-3 kullanım senaryosu H3 ya da madde olarak; her senaryo için tek net tercih ve bir cümle gerekçe.
4. "X'ten Y'ye nasıl geçilir?" H2'si: numaralı adımlar ve dikkat noktaları (veri taşıma, kesinti, maliyet).
5. "X ve Y'nin sınırlamaları neler?" H2'si: her seçeneğin zayıf yanı açıkça (kendi markan dahil).
6. Sıkça Sorulan Sorular.`,
  best_for: `İçerik tipi: EN İYİ SEÇENEKLER ("en iyi X" / "Y için en uygun X")
1. Tek cümlelik cevap: "> **Hızlı cevap:**" bloğunun ilk cümlesi en uygun seçeneği ve kime uygun olduğunu söyler.
2. "Hangi seçenek kime uygun?" H2'si altında sıralı tablo (zorunlu): sütunlar Sıra | Ad | Kime uygun | Fiyat | Temel sınırlama; en az 3 seçenek. Fiyat sütununa yalnız kaynağı olan rakamı yaz, yoksa niteliksel değer.
3. Seçenekler H3 olarak (H2 değil; soru H2 oranı korunur): her biri için artılar ve eksiler (madde işaretli) + "İdeal kullanıcı:" satırı.
4. "Seçenekleri nasıl değerlendirdik?" H2'si: ölçütler, neye bakıldı, neye bakılamadı.
5. Sıkça Sorulan Sorular.`,
  alternatives: `İçerik tipi: ALTERNATİFLER ("X alternatifleri")
1. "Kullanıcılar neden X'ten ayrılıyor?" H2'si: somut nedenler (fiyat, eksik özellik, destek, ölçeklenme); X'i karalama, adil ol.
2. "X'in en iyi alternatifleri hangileri?" H2'si altında 5-10 alternatif, her biri H3 (H2 değil); başlığın hemen altında "**Kime uygun:** ..." etiketi, ardından güçlü ve zayıf yanlar.
3. Özet tablo: Alternatif | Kime uygun | Öne çıkan fark.
4. "Geçiş yaparken nelere dikkat edilmeli?" H2'si: veri dışa aktarma, sözleşme/iptal, entegrasyonların yeniden kurulumu.
5. Sıkça Sorulan Sorular.`,
  pricing: `İçerik tipi: FİYATLAR ("X fiyatları / planları")
1. "X planları ne kadar?" H2'si: her plan için ideal müşteri; fiyat ve limit YALNIZ bağlamda kaynağı varsa (kaynakla birlikte), yoksa niteliksel ("ücretsiz plan var", "ekip büyüdükçe artar").
2. Plan karşılaştırma tablosu (zorunlu): Plan | Fiyat | Limitler | Kime uygun. Kaynaksız hücreye rakam yazma.
3. "Yıllık indirim, iade ve deneme koşulları neler?" H2'si: bağlamda kaynağı olan koşulları düz metinde (tablo dışında, tam cümleyle) yaz; bilgisi olmayan koşulu uydurma, hiç yazma.
4. "Hangi plan kime uygun?" H2'si ve dürüst sınırlamalar (gizli maliyet, limit aşımı).
5. Sıkça Sorulan Sorular.`,
  howto: `İçerik tipi: NASIL YAPILIR (adım adım)
1. İstenen sonuç ilk cümlede: "> **Hızlı cevap:**" bloğu işin sonunda okurun neye sahip olacağını ve kaç adım sürdüğünü söyler.
2. "Başlamadan önce neler gerekli?" H2'si: araçlar, tahmini süre ve maliyet (kaynaklanamayan rakam yazma; "birkaç dakika", "ücretsiz araçlarla" gibi niteliksel yaz).
3. "Adım adım nasıl yapılır?" H2'si altında NUMARALI liste (zorunlu, en az 3 adım): her adım tek eylemle başlar; gerekiyorsa adımın altında araç / süre notu.
4. "En sık yapılan hatalar neler?" H2'si: hata + nasıl önlenir.
5. Sıkça Sorulan Sorular.`,
  listicle: `İçerik tipi: LİSTE
Mevcut yapı aynen geçerlidir. Tek ek kural: başlıktaki sayı ile yazdığın madde sayısı birebir aynı olsun; maddeler sıra önemliyse numaralı, değilse madde işaretli.`,
};

/** Fiyat/özellik iddiası taşıyan tiplerde ortak doğruluk kuralları */
const PRODUCT_FACT_RULES = `Ürün bilgisi doğruluğu (bu tipte en ağır kural):
- Adı geçen ürünlerin fiyatını, plan limitini, özelliğini UYDURMA. Sana verilen bağlamda (marka beyni, rakip listesi, önceki ajan çıktısı) kaynağıyla bulunmayan rakamı yazma.
- Doğrulayamadığın ayrıntıyı atla ve genel ifade kullan ("ücretli planları kullanıcı sayısına göre artar, güncel fiyat resmî sayfasında"). "[doğrulanacak]", "XX TL", "?" gibi yer tutucu YAZMA: yer tutucu yayını engeller.
- Fiyat yazıyorsan (₺, TL, $, €) aynı paragrafta ya da tablonun hemen altında kaynak olmalı (resmî fiyat sayfasının bilinen adresi ya da "Kaynak: ..." satırı). Adresi bilmiyorsan uydurma; fiyat hücresine "Ücretsiz plan var" / "Ücretli" gibi niteliksel değer yaz. Kaynaksız fiyat deterministik kapıda UNSOURCED_NUMERIC_CLAIM olarak geri döner.
- Her seçenek için "en uygun kime" cümlesi ve dürüst bir "Sınırlamalar" bölümü yaz; kendi markanı kayırma.`;

/** Editör turunda kısa hatırlatma: şablonun zorunlu öğeleri */
const EDITOR_CHECKLIST: Record<Exclude<ContentType, 'guide'>, string> = {
  comparison: 'Hızlı cevabın ilk cümlesi net hüküm; yan yana tablo (Özellikler, Fiyat, Entegrasyon, Destek — Fiyat satırında kaynaksız rakam yok); "Hangisi kime uygun?" (2-3 senaryo); "X\'ten Y\'ye nasıl geçilir?"; dürüst sınırlamalar; SSS.',
  best_for: 'Tek cümlelik cevap; sıralı tablo (Ad, Kime uygun, Fiyat, Temel sınırlama — en az 3 satır); seçenekler H3, her birinde artı/eksi + ideal kullanıcı; "Seçenekleri nasıl değerlendirdik?"; SSS.',
  alternatives: '"Kullanıcılar neden X\'ten ayrılıyor?"; 5-10 alternatif H3, her birinde "Kime uygun" etiketi; özet tablo; geçiş dikkat noktaları; SSS.',
  pricing: 'Her plan için ideal müşteri; plan karşılaştırma tablosu; fiyat, limit, yıllık indirim, iade ve deneme koşulları YALNIZ kaynaklıysa; SSS.',
  howto: 'Hızlı cevapta istenen sonuç; araç/süre/maliyet; numaralı adımlar (en az 3); sık yapılan hatalar; SSS.',
  listicle: 'Başlıktaki sayı ile madde sayısı aynı.',
};

export type TemplateStage = 'outline' | 'writer' | 'editor';

const STAGE_HEADER: Record<TemplateStage, string> = {
  outline: '## İÇERİK ŞABLONU (taslağı bu iskelete göre kur)',
  writer: '## İÇERİK ŞABLONU (zorunlu — makaleyi bu iskelete göre yaz)',
  editor: '## İÇERİK ŞABLONU KONTROLÜ',
};

/**
 * Tipe göre prompt bloğu. 'guide' için BOŞ dize (bugünkü davranış).
 * Genel kurallar (Hızlı cevap, soru H2, Kısa cevap, SSS, Son güncelleme,
 * kaynaklı sayı) şablonun üstünde geçerli kalır; şablon yalnız H2 iskeletini
 * ve tipe özgü zorunlu öğeleri belirler.
 */
export function contentTemplateBlock(type: ContentType, stage: TemplateStage): string {
  if (type === 'guide') return '';
  const lines: string[] = [STAGE_HEADER[stage], ''];
  if (stage === 'editor') {
    lines.push(
      `İçerik tipi: ${CONTENT_TYPE_LABELS[type]}. Kontrol listesi: ${EDITOR_CHECKLIST[type]}`,
      'Yapısal öğe (başlık, tablo, liste, "Kime uygun" etiketi) eksikse ekle; var olan bölümü silme. ' +
        'Fiyat, plan limiti, yıllık indirim, iade, deneme gibi OLGULARI yalnız bağlamda kaynağı varsa ekle; ' +
        'kaynak yoksa niteliksel bırak — eksik olgu için rakam UYDURMA. Şablon H2\'leri soru biçiminde kalsın.',
    );
    if (PRODUCT_FACT_TYPES.has(type)) {
      lines.push('Kaynaksız ürün fiyatı / özelliği varsa sil veya niteliksel ifadeye çevir; yer tutucu bırakma.');
    }
  } else {
    lines.push(
      'Genel kurallar (Hızlı cevap, soru formatlı H2, Kısa cevap satırları, SSS, Son güncelleme, kaynaklı sayı) aynen geçerli; bu şablon H2 iskeletini ve tipe özgü zorunlu öğeleri belirler. Şablondaki H2 adları soru biçimindedir (soru H2 oranı %50 kuralı), her birinin altında "> **Kısa cevap:**" olur; seçenekler / adımlar H3 ya da liste olarak yazılır.',
      '',
      TEMPLATE_BODY[type],
    );
    if (PRODUCT_FACT_TYPES.has(type)) lines.push('', PRODUCT_FACT_RULES);
  }
  return lines.join('\n');
}

/**
 * Ajan girdisinin başına şablon bloğunu ekler. 'guide'de girdi AYNEN döner
 * (geriye uyumluluk: tipi olmayan konunun prompt'u bugünküyle birebir aynı).
 */
export function withContentTemplate(input: string, type: ContentType, stage: TemplateStage): string {
  const block = contentTemplateBlock(type, stage);
  return block ? `${block}\n\n---\n\n${input}` : input;
}
