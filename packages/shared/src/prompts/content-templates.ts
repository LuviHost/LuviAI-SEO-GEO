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

// Kalıplar ASCII'ye indirgenmiş küçük harfli başlıkta aranır.
const COMPARISON_RE: RegExp[] = [
  /(^|\s)(vs\.?|versus)(\s|$)/,
  /\b(mi|mu) yoksa\b/,
  /\bkarsilastirma(si|lari)?\b|\bkiyaslama(si)?\b|\bcomparison\b|\bcompared\b/,
  /\barasindaki fark(lar)?\b|\bfark(i|lari)\b/,
];
/** "Shopify mı WooCommerce mi?" — iki soru eki = iki seçenek */
const TWO_QUESTION_PARTICLES_RE = /\b(mi|mu)\b.*\b(mi|mu)\b/;
const ALTERNATIVES_RE = /\balternatif(i|leri|ler|lerin)?\b|\balternatives?\b|\byerine (ne|hangi)\b|\bbenzeri (uygulama|program|arac|site|platform)/;
const PRICING_RE = /\bfiyat(i|lari|lar)?\b|\bucret(i|leri)\b|\bpricing\b|\bprices?\b|\bkac para\b/;
const BEST_FOR_RE = /\ben iyi\b|\ben uygun\b|\bbest\b|\btop \d{1,2}\b|\bicin en (iyi|uygun)\b/;
const HOWTO_RE = [
  /\bnasil\b(?! (calisir|isler|olur|bir)\b)/,
  /\bhow to\b|\badim adim\b|\bstep by step\b/,
  /\b\d{1,2} adim(da)?\b/,
  /\b(kurulur|yapilir|hesaplanir|olusturulur|alinir|acilir|baglanir|yuklenir)\b/,
];
/**
 * 1-2 haneli sayı + (en çok 2 sıfat/isim) + liste nesnesi: "7 hata", "7 Kritik SEO Hatası",
 * "10 ipucu", "5 neden". Türkçede sayıdan sonra isim tekildir ve iyelik eki alabilir
 * (hatası, ipucu, yolu), bu yüzden kök + ek eşleşir. 4 haneli yıllar sayılmaz.
 */
const LISTICLE_RE = /(^|\s)([2-9]|[1-4]\d|50)\s+(\p{L}+\s+){0,2}(yol|ipuc|oneri|madde|neden|hata|arac|strateji|yontem|ornek|soru|taktik|fikir|kural|way|tip|reason|mistake|tool|idea|thing)\p{L}*/u;

/**
 * Deterministik başlık sınıflandırıcı (Türkçe + İngilizce).
 * Belirsizse null döner (çağıran 'guide'a düşer). Sıra özgülden genele:
 * karşılaştırma > alternatifler > fiyat > en iyi > nasıl > liste.
 */
export function classifyTopicTitle(title: unknown): ContentType | null {
  if (typeof title !== 'string' || !title.trim()) return null;
  const t = foldTr(title);
  if (COMPARISON_RE.some((re) => re.test(t))) return 'comparison';
  if (ALTERNATIVES_RE.test(t)) return 'alternatives';
  if (TWO_QUESTION_PARTICLES_RE.test(t)) return 'comparison';
  if (PRICING_RE.test(t)) return 'pricing';
  if (BEST_FOR_RE.test(t)) return 'best_for';
  if (HOWTO_RE.some((re) => re.test(t))) return 'howto';
  if (LISTICLE_RE.test(t)) return 'listicle';
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
2. Yan yana karşılaştırma tablosu (zorunlu): sütunlar seçenekler (X | Y), satırlar en az şu başlıklar: Özellikler, Fiyat, Entegrasyon, Destek.
3. "Hangisi kime uygun?" H2'si: 2-3 kullanım senaryosu; her senaryo için tek net tercih ve bir cümle gerekçe.
4. Geçiş rehberi H2'si: birinden diğerine geçerken numaralı adımlar ve dikkat noktaları (veri taşıma, kesinti, maliyet).
5. Dürüst sınırlamalar: her seçeneğin zayıf yanını açıkça yaz (kendi markan dahil).
6. Sıkça Sorulan Sorular.`,
  best_for: `İçerik tipi: EN İYİ SEÇENEKLER ("en iyi X" / "Y için en uygun X")
1. Tek cümlelik cevap: "> **Hızlı cevap:**" bloğunun ilk cümlesi en uygun seçeneği ve kime uygun olduğunu söyler.
2. Sıralı tablo (zorunlu): sütunlar Sıra | Ad | Kime uygun | Fiyat | Temel sınırlama; en az 3 seçenek.
3. Her seçenek için ayrı bölüm: artılar ve eksiler (madde işaretli) + "İdeal kullanıcı:" satırı.
4. Yöntem notu H2'si: seçenekler nasıl değerlendirildi (ölçütler, neye bakıldı, neye bakılamadı).
5. Sıkça Sorulan Sorular.`,
  alternatives: `İçerik tipi: ALTERNATİFLER ("X alternatifleri")
1. "Kullanıcılar neden X'ten ayrılıyor?" H2'si: somut nedenler (fiyat, eksik özellik, destek, ölçeklenme); X'i karalama, adil ol.
2. 5-10 alternatif: her biri ayrı H3, başlığın hemen altında "**Kime uygun:** ..." etiketi, ardından güçlü ve zayıf yanlar.
3. Özet tablo: Alternatif | Kime uygun | Öne çıkan fark.
4. Geçiş dikkat noktaları H2'si: veri dışa aktarma, sözleşme/iptal, entegrasyonların yeniden kurulumu.
5. Sıkça Sorulan Sorular.`,
  pricing: `İçerik tipi: FİYATLAR ("X fiyatları / planları")
1. Tüm planlar: her plan için fiyat + temel limit + ideal müşteri.
2. Plan karşılaştırma tablosu (zorunlu): Plan | Fiyat | Limitler | Kime uygun.
3. Yıllık indirim, iade ve deneme koşullarını düz metinde (tablo dışında, tam cümleyle) yaz; bağlamda bilgisi olmayan koşulu uydurma, hiç yazma.
4. "Hangi plan kime uygun?" bölümü ve dürüst sınırlamalar (gizli maliyet, limit aşımı).
5. Sıkça Sorulan Sorular.`,
  howto: `İçerik tipi: NASIL YAPILIR (adım adım)
1. İstenen sonuç ilk cümlede: "> **Hızlı cevap:**" bloğu işin sonunda okurun neye sahip olacağını ve kaç adım sürdüğünü söyler.
2. Başlamadan önce: gereken araçlar, tahmini süre ve maliyet (kaynaklanamayan rakam yazma; "birkaç dakika", "ücretsiz araçlarla" gibi niteliksel yaz).
3. Adımlar NUMARALI liste (zorunlu, en az 3 adım): her adım tek eylemle başlar; gerekiyorsa adımın altında araç / süre notu.
4. "Sık yapılan hatalar" H2'si: hata + nasıl önlenir.
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
  comparison: 'Hızlı cevabın ilk cümlesi net hüküm; yan yana tablo (Özellikler, Fiyat, Entegrasyon, Destek); "Hangisi kime uygun?" (2-3 senaryo); geçiş rehberi; dürüst sınırlamalar; SSS.',
  best_for: 'Tek cümlelik cevap; sıralı tablo (Ad, Kime uygun, Fiyat, Temel sınırlama — en az 3 satır); her seçenekte artı/eksi + ideal kullanıcı; yöntem notu; SSS.',
  alternatives: '"Neden X\'ten ayrılıyorlar?" bölümü; 5-10 alternatif, her birinde "Kime uygun" etiketi; özet tablo; geçiş dikkat noktaları; SSS.',
  pricing: 'Her plan için fiyat + limit + ideal müşteri; plan karşılaştırma tablosu; yıllık indirim / iade / deneme koşulları düz metinde; SSS.',
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
      `İçerik tipi: ${CONTENT_TYPE_LABELS[type]}. Şu öğeler metinde yoksa ekle ya da düzelt (silme): ${EDITOR_CHECKLIST[type]}`,
    );
    if (PRODUCT_FACT_TYPES.has(type)) {
      lines.push('Kaynaksız ürün fiyatı / özelliği varsa sil veya niteliksel ifadeye çevir; yer tutucu bırakma.');
    }
  } else {
    lines.push(
      'Genel kurallar (Hızlı cevap, soru formatlı H2, Kısa cevap satırları, SSS, Son güncelleme, kaynaklı sayı) aynen geçerli; bu şablon H2 iskeletini ve tipe özgü zorunlu öğeleri belirler.',
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
