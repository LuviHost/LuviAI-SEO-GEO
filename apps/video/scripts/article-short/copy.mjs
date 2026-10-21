/**
 * METIN ADIMI — makale -> video metni (ArticleShort props'unun icerik kismi).
 *
 * Cikti semasi (LLM adimi da AYNISINI uretmek zorunda):
 *   {
 *     hook: string,                 // makalenin kendi basligi (gerekirse ilk soru/cumlecik)
 *     hookSub?: string,             // basligin kalani ya da meta aciklamanin ilk cumlesi
 *     kicker?: string,              // breadcrumb ust bolumu / articleSection
 *     points: [{ title, detail? }] x3,
 *     cta: { label, domain, url },
 *     evidence: [...]               // her metnin makaledeki kaynak satiri (denetim icin)
 *   }
 *
 * Bugun: 'extractive' — deterministik; yalniz makalenin kendi basliklarini/cumlelerini SECER,
 * yalniz susleme (emoji, numara rozeti, sondaki parantez) SILER. Kelime eklemez, sayi uretmez.
 *
 * Uretim: 'llm' — sunucuda (apps/worker, BullMQ isi; @anthropic-ai/sdk zaten bagimli) Claude
 * Haiku 5.5 cagrilir; ayni sema structured output ile zorlanir, ardindan validateScript()
 * ayni sayi/olgu korumasini uygular. Basarisizsa extractive'e duser. Prototipte API anahtari
 * olmadigi icin LLM CAGRILMAZ — buildLlmRequest() yalniz istegin seklini ve token tahminini verir.
 */

export const SCRIPT_VERSION = 1;
export const LLM_MODEL = 'claude-haiku-5-5';

const LIMITS = { hook: 110, hookSub: 140, title: 90, detail: 110 };
const SKIP_HEADING = /^(sık(ça)? sorulan|sss|faq|kaynak|ilgili|içindekiler|okumaya devam|paylaş|yorum)/iu;

const norm = (s) => s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const sentences = (t) => t.split(/(?<=[.!?…])\s+(?=[\p{Lu}\d"“])/u).map((s) => s.trim()).filter(Boolean);
const startsUpper = (s) => /^[\p{Lu}\d"“]/u.test(s);

function similar(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.includes(s) && s.length / l.length >= 0.7;
}

/** Bolumden tek satirlik destek cumlesi — oncelik: tam cumle > kendi basina anlamli madde > alt baslik */
function sectionDetail(sec) {
  const items = sec.items;
  const firstSub = items.findIndex((b) => b.type === 'heading');
  const direct = firstSub < 0 ? items : items.slice(0, firstSub);

  // 1) tam cumle (liste sonrasi devam cumlesi degil, ':' ile bitmiyor, buyuk harfle basliyor)
  for (let i = 0; i < direct.length; i++) {
    const b = direct[i];
    if (b.type !== 'p') continue;
    if (i > 0 && direct[i - 1].type === 'li' && !b.label) continue;
    const txt = b.label ? b.text.replace(/^[\p{L} ]{2,20}:\s*/u, '') : b.text;
    for (const s of sentences(txt)) {
      if (/:$/.test(s) || !startsUpper(s) || !/[.!]$/.test(s)) continue;
      if (s.length < 25 || s.length > 100) continue;
      return { text: s, kind: 'cumle', source: b.raw };
    }
  }
  // 2) maddeler — liste bir cumlenin parcasiysa (giris ':' ile bitiyor ve ardindan kucuk harfli
  //    ya da cok kisa devam cumlesi geliyor) maddeler tek basina anlamsizdir, atlanir
  for (let i = 0; i < direct.length; i++) {
    if (direct[i].type !== 'li' || (i > 0 && direct[i - 1].type === 'li')) continue;
    let j = i;
    while (j < direct.length && direct[j].type === 'li') j++;
    const lead = i > 0 ? direct[i - 1] : null;
    const next = direct[j] ?? null;
    const continues = next && next.type === 'p' && (!startsUpper(next.text) || words(next.text) <= 6);
    const fragmentary = continues && (!lead || (lead.type === 'p' && /:$/.test(lead.text)));
    if (fragmentary && !direct[i].mark) continue;
    for (const li of direct.slice(i, j)) {
      if (words(li.text) >= 2 && li.text.length >= 12 && li.text.length <= 64) return { text: li.text, kind: 'madde', source: li.raw };
    }
  }
  // 3) ilk alt baslik (adim adim anlatimlar)
  if (firstSub >= 0 && items[firstSub].text.length <= 64) return { text: items[firstSub].text, kind: 'alt-baslik', source: items[firstSub].raw };
  return null;
}

function splitTitle(title) {
  const q = title.indexOf('?');
  if (q > 10 && q < title.length - 4) return [title.slice(0, q + 1).trim(), title.slice(q + 1).replace(/^[\s:–—-]+/, '').trim()];
  const c = title.indexOf(':');
  if (c >= 12 && c < title.length - 4) return [title.slice(0, c).trim(), title.slice(c + 1).trim()];
  return [title.trim(), null];
}

export function extractiveScript(article) {
  const evidence = [];
  const [hook, titleRest] = splitTitle(article.title);
  evidence.push({ field: 'hook', source: article.title, via: 'baslik' });
  let hookSub = titleRest;
  if (hookSub) evidence.push({ field: 'hookSub', source: article.title, via: 'baslik-kalani' });
  else if (article.description) {
    const first = sentences(article.description)[0];
    if (first && first.length <= LIMITS.hookSub) {
      hookSub = first;
      evidence.push({ field: 'hookSub', source: article.description, via: 'meta-aciklama' });
    }
  }

  const candidates = article.sections
    .filter((s) => s.heading && !SKIP_HEADING.test(s.heading) && !similar(s.heading, hook) && !similar(s.heading, article.title) && s.heading.length <= LIMITS.title)
    .map((s, idx) => ({ idx, heading: s.heading, detail: sectionDetail(s) }));

  // detayi olan bolumleri tercih et; makaleye yayilsin (bas, orta, son)
  const spread = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, k) => arr[Math.round((k * (arr.length - 1)) / (n - 1))]));
  const withDetail = candidates.filter((c) => c.detail);
  let chosen = spread(withDetail, 3);
  if (chosen.length < 3) chosen = [...chosen, ...candidates.filter((c) => !chosen.includes(c)).slice(0, 3 - chosen.length)];
  chosen.sort((a, b) => a.idx - b.idx);

  const points = chosen.map((c, i) => {
    evidence.push({ field: `points[${i}].title`, source: c.heading, via: 'bolum-basligi' });
    if (c.detail) evidence.push({ field: `points[${i}].detail`, source: c.detail.source, via: c.detail.kind });
    return c.detail ? { title: c.heading, detail: c.detail.text } : { title: c.heading };
  });

  // yedek: yeterli bolum yoksa giris paragraflarinin kisa cumleleri (yine birebir)
  if (points.length < 3) {
    for (const b of article.blocks) {
      if (points.length >= 3) break;
      if (b.type !== 'p') continue;
      for (const s of sentences(b.text)) {
        if (points.length >= 3) break;
        if (s.length >= 20 && s.length <= LIMITS.title && startsUpper(s) && !points.some((p) => p.title === s)) {
          evidence.push({ field: `points[${points.length}].title`, source: b.raw, via: 'yedek-cumle' });
          points.push({ title: s });
        }
      }
    }
  }

  return {
    version: SCRIPT_VERSION,
    strategy: 'extractive',
    lang: (article.lang ?? 'tr').slice(0, 2),
    hook,
    ...(hookSub ? { hookSub } : {}),
    ...(article.section ? { kicker: article.section } : {}),
    points,
    cta: { label: 'Tamamını oku', domain: article.domain, url: article.url },
    evidence,
  };
}

/**
 * Koruyucu — hem extractive hem LLM ciktisina uygulanir (uretimde LLM sonrasi ZORUNLU kapı):
 *  - sema ve uzunluk sinirlari
 *  - SAYI KORUMASI: metindeki her sayi makalenin kendi metninde birebir gecmeli
 *  - yenilik orani: 4+ harfli kelimelerin makalede gecmeyen orani (LLM uydurmasini yakalar)
 */
export function validateScript(script, article) {
  const errors = [];
  const warnings = [];
  if (!script.hook) errors.push('hook bos');
  if (!Array.isArray(script.points) || script.points.length !== 3) errors.push(`3 madde gerekli, ${script.points?.length ?? 0} var`);
  const texts = [['hook', script.hook], ['hookSub', script.hookSub], ...(script.points ?? []).flatMap((p, i) => [[`points[${i}].title`, p.title], [`points[${i}].detail`, p.detail]])].filter(([, v]) => v);
  for (const [k, v] of texts) {
    const lim = LIMITS[k.replace(/^points\[\d\]\./, '')];
    if (lim && v.length > lim) errors.push(`${k} cok uzun (${v.length} > ${lim})`);
  }
  const src = article.sourceText.replace(/[–—]/g, '-');
  const srcNorm = ` ${norm(article.sourceText)} `;
  for (const [k, v] of texts) {
    for (const n of v.replace(/[–—]/g, '-').match(/\d+(?:[.,]\d+)*/g) ?? []) {
      if (!src.includes(n)) errors.push(`${k}: "${n}" sayisi makalede yok (uydurma sayi)`);
    }
  }
  const all = texts.map(([, v]) => norm(v)).join(' ').split(' ').filter((w) => w.length >= 4);
  const novel = all.filter((w) => !srcNorm.includes(` ${w}`));
  const novelRatio = all.length ? novel.length / all.length : 0;
  if (novelRatio > 0.25) warnings.push(`makalede gecmeyen kelime orani yuksek: %${Math.round(novelRatio * 100)} (${novel.slice(0, 8).join(', ')})`);
  if (script.points?.some((p) => !p.detail)) warnings.push('bazi maddelerin destek satiri yok (makalede kisa, kendi basina anlamli cumle bulunamadi)');
  return { ok: errors.length === 0, errors, warnings, novelRatio: Number(novelRatio.toFixed(3)) };
}

/**
 * Uretimdeki LLM isteginin sekli (CAGRILMAZ). Sunucuda apps/worker icinde, TypeScript SDK ile:
 *
 *   const res = await anthropic.messages.create({
 *     model: 'claude-haiku-5-5', max_tokens: 1024,
 *     output_config: { effort: 'low', format: { type: 'json_schema', schema: SCRIPT_JSON_SCHEMA } },
 *     system: SYSTEM, messages: [{ role: 'user', content: articleText }],
 *   });
 *   // -> JSON.parse(text) -> validateScript() -> hata varsa extractiveScript() yedegi
 *
 * Makale metni kirpilmaz; tipik blog yazisi 1-3 bin token.
 */
export const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'points', 'cta'],
  properties: {
    hook: { type: 'string', maxLength: LIMITS.hook },
    hookSub: { type: 'string', maxLength: LIMITS.hookSub },
    kicker: { type: 'string', maxLength: 40 },
    points: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: LIMITS.title }, detail: { type: 'string', maxLength: LIMITS.detail } } },
    },
    cta: { type: 'object', additionalProperties: false, required: ['label', 'domain'], properties: { label: { type: 'string' }, domain: { type: 'string' }, url: { type: 'string' } } },
  },
};

const SYSTEM = [
  'Bir blog makalesinden 15 saniyelik dikey video metni cikariyorsun. Dil: makalenin dili.',
  'Yalniz makalede yazanlari kullan. Makalede olmayan sayi, oran, tarih, vaat ya da iddia ekleme.',
  'hook: makalenin basligi ya da ilk sorusu (en fazla 60 karakter tercih edilir).',
  'points: makalenin uc ana bolumu; title en fazla 60, detail en fazla 80 karakter, her biri kendi basina anlasilir olsun.',
  'cta.label "Tamamını oku", cta.domain makalenin alan adi.',
].join('\n');

export function buildLlmRequest(article) {
  const body = article.blocks.map((b) => (b.type === 'heading' ? `${'#'.repeat(b.level)} ${b.text}` : b.type === 'li' ? `- ${b.text}` : b.text)).join('\n');
  const user = `Baslik: ${article.title}\nAciklama: ${article.description}\nAlan adi: ${article.domain}\n\n${body}`;
  const request = { model: LLM_MODEL, max_tokens: 1024, output_config: { effort: 'low', format: { type: 'json_schema', schema: SCRIPT_JSON_SCHEMA } }, system: SYSTEM, messages: [{ role: 'user', content: user }] };
  // Turkce metinde ~2.6-3.2 karakter/token (kaba tahmin; uretimde messages.countTokens ile olculur)
  const inChars = SYSTEM.length + user.length + JSON.stringify(SCRIPT_JSON_SCHEMA).length;
  return { request, estimate: { inputChars: inChars, inputTokensLow: Math.round(inChars / 3.2), inputTokensHigh: Math.round(inChars / 2.6) } };
}

export async function buildScript(article, { strategy = 'extractive' } = {}) {
  if (strategy === 'llm') {
    // Uretimde burada worker'daki LLM servisi cagrilir (yukaridaki istek). Prototipte kapali.
    throw new Error('LLM adimi prototipte devre disi (API anahtari yok); --strategy=extractive kullan');
  }
  const script = extractiveScript(article);
  return { script, check: validateScript(script, article) };
}
