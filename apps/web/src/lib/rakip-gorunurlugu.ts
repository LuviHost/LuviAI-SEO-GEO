/**
 * AI cevaplarinda rakip gorunurlugu — panel tipleri ve metin yardimcilari.
 * Sunucu: GET /sites/:id/audit/competitor-visibility (apps/api/src/audit/competitor-visibility.ts).
 */

export interface RakipDegisim {
  /** Karsilastirilabilir (soru, asistan) cifti sayisi */
  pairs: number;
  before: number;
  now: number;
}

export interface RakipSatiri {
  name: string;
  isBrand: boolean;
  listed: boolean;
  answers: number;
  questions: number;
  providers: string[];
  /** Sitesinin kaynak gosterildigi cevap sayisi; adres tanimli degilse null */
  citedAnswers: number | null;
  /** Adinin gectigi cevaplardan kacinda takip edilen adlar arasinda ILK anildi (eski sunucuda yok) */
  firstAnswers?: number;
  /** Adinin gectigi ama siranin kayitli olmadigi cevap sayisi (eski olcum; paydaya girmez) */
  firstUnknown?: number;
  change: RakipDegisim | null;
  byQuestion: Array<{ promptId: string; text: string; providers: string[] }>;
}

export interface RakipOnerisi {
  domain: string;
  answers: number;
  questions: number;
  providers: string[];
}

export interface RakipGorunurlugu {
  days: number;
  totals: {
    answers: number;
    questions: number;
    providers: string[];
    firstMeasuredAt: string | null;
    lastMeasuredAt: string | null;
    comparablePairs: number;
  };
  rows: RakipSatiri[];
  suggestions: RakipOnerisi[];
  truncated?: boolean;
}

/** Olculmus cevap var mi (yoksa tablo yerine "once sorularini olc" gosterilir) */
export function olcumVar(r: Pick<RakipGorunurlugu, 'totals'> | null | undefined): boolean {
  return !!r && r.totals.answers > 0;
}

/** "13 Kasım" — sunucudan YYYY-MM-DD gelir, saat dilimi kaymasin diye UTC */
export function gunMetni(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Ozet satiri: "120 cevap · 20 soru · 6 asistan · son ölçüm 11 Kasım" */
export function ozetMetni(t: RakipGorunurlugu['totals']): string {
  const parts = [`${t.answers} cevap`, `${t.questions} soru`, `${t.providers.length} asistan`];
  const son = gunMetni(t.lastMeasuredAt);
  if (son) parts.push(`son ölçüm ${son}`);
  return parts.join(' · ');
}

/** Cevap payi (0–100, tam sayi); toplam yoksa 0 */
export function payYuzdesi(answers: number, total: number): number {
  return total > 0 ? Math.round((answers / total) * 100) : 0;
}

/**
 * "İlk anılan" hucresi: adinin gectigi ve sirasi KAYITLI cevaplardan kacinda ilk bu ad gecti.
 * Payda, sirasi bilinmeyen cevaplari (marka ile rakibin birlikte gectigi eski olcumler)
 * icermez: bilinmeyeni "ilk degildi" saymak rakibi oldugundan geride gosterirdi.
 * `payda` null ise hucrede yalniz cizgi basilir.
 *
 * `bilinmeyen` hucrede GORUNUR basilir (14.11.2026 bagimsiz inceleme): yayin gunu butun
 * kayitlar eskidir; markanin sirasi bilinen cevaplari yalniz tek basina gectigi cevaplardir,
 * yani marka satiri "4 / 4" cikar. Yanindaki "6 bilinmiyor" olmadan bu "hep ilk" diye okunur.
 * Yalniz `title`'a yazmak yetmez — telefonda gorunmez.
 */
export function ilkAnilanMetni(row: Pick<RakipSatiri, 'answers' | 'firstAnswers' | 'firstUnknown'>): { text: string; payda: number | null; bilinmeyen: number; title: string } {
  if (typeof row.firstAnswers !== 'number') return { text: '—', payda: null, bilinmeyen: 0, title: '' };
  if (row.answers <= 0) return { text: '—', payda: null, bilinmeyen: 0, title: 'Adı hiçbir cevapta geçmedi.' };
  const bilinmeyen = Math.min(row.answers, Math.max(0, row.firstUnknown ?? 0));
  const bilinen = row.answers - bilinmeyen;
  if (bilinen <= 0) {
    return { text: '—', payda: null, bilinmeyen, title: `Adının geçtiği ${row.answers} cevapta sıra kayıtlı değil (eski ölçüm).` };
  }
  const ek = bilinmeyen > 0 ? ` ${bilinmeyen} cevapta sıra kayıtlı değil (eski ölçüm); bunlar sayılmadı.` : '';
  return {
    text: String(row.firstAnswers),
    payda: bilinen,
    bilinmeyen,
    title: `Sırası kayıtlı ${bilinen} cevaptan ${row.firstAnswers} tanesinde, markan ve rakiplerin arasında ilk bu ad geçti (tek başına geçtiği cevaplar dahil).${ek}`,
  };
}

/**
 * Onceki olcume gore degisim metni. Karsilastirma yoksa "—"; fark yoksa "aynı".
 * Isaret gercek eksi (−): tire ile karismasin.
 */
export function degisimMetni(c: RakipDegisim | null): { text: string; title: string; yon: 'artti' | 'azaldi' | 'ayni' | 'yok' } {
  if (!c || c.pairs === 0) return { text: '—', title: 'Bu sorular için önceki bir ölçüm yok.', yon: 'yok' };
  const fark = c.now - c.before;
  const title = `Önceki ölçümde ${c.before}, şimdi ${c.now} cevapta geçiyor (${c.pairs} karşılaştırılabilir cevapta).`;
  if (fark === 0) return { text: 'aynı', title, yon: 'ayni' };
  return { text: `${fark > 0 ? '+' : '−'}${Math.abs(fark)}`, title, yon: fark > 0 ? 'artti' : 'azaldi' };
}

/** Kaynak sutunu: adres tanimli degilse "adres yok" */
export function kaynakMetni(citedAnswers: number | null): string {
  return citedAnswers === null ? 'adres yok' : String(citedAnswers);
}

/**
 * Onerilen siteden rakip adi: "www.influencerman.com.tr" → "Influencerman".
 * Yalniz baslangic degeri; kullanici listede duzeltebilir. Bas harf yerelden BAGIMSIZ
 * buyutulur: alan adlari ASCII'dir, Turkce kuralla "influencerman" → "İnfluencerman" olurdu.
 */
export function alanAdindanAd(domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^www\./, '');
  const label = host.split('.')[0] ?? host;
  if (!label) return domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Oneriyi rakip listesine eklenecek kayda cevirir */
export function oneridenRakip(domain: string): { name: string; url: string } {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return { name: alanAdindanAd(host), url: `https://${host}` };
}

/** Listede ayni adres ya da ayni ad varsa yeniden eklenmez */
export function listedeVar(list: ReadonlyArray<{ name: string; url?: string | null }>, aday: { name: string; url: string }): boolean {
  const host = (u: string | null | undefined) => (u ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const ad = aday.name.toLocaleLowerCase('tr-TR');
  return list.some((c) => (c.url && host(c.url) === host(aday.url)) || c.name.trim().toLocaleLowerCase('tr-TR') === ad);
}
