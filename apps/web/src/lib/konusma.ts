/**
 * Takip kaydinin metninden SOHBET balonlari — saf (23.11.2026).
 *
 * Kaynaklar (api intel/elle-kayit.ts blok bicimi ile ayni):
 *  - noteText  → botun baglanti istegi notu (giden, tarih requestedAt)
 *  - messageText:
 *      a) Elle kayit bloklari: "── 21.11.2026 20:08 · LinkedIn · Gelen · Konu: X ──\nmetin"
 *         (saat ve "Gelen" isteğe bagli; eski kayitlarda saat yok)
 *      b) Botun tek mesaji (baslik yok); InMail ise "[InMail] konu\n\nmetin"
 *  - "· Yazan: Talat" (28.11.2026, iki yonetici): giden mesaji hangi yonetici yazdi
 *  - repliedAt dolu ama hic "Gelen" blok yoksa: "cevap verdi (metin kaydedilmedi)" balonu,
 *    boylece sohbet "cevapsiz" gorunmez.
 */

export type Yon = 'giden' | 'gelen';

export interface Balon {
  yon: Yon;
  /** "21.11.2026" ya da null */
  tarih: string | null;
  /** "20:08" ya da null */
  saat: string | null;
  kanal: 'LinkedIn' | 'E-posta' | null;
  /** Balonun ustundeki kucuk etiket: konu / "Bağlantı notu" / "InMail: konu" */
  baslik: string | null;
  metin: string;
  /** Metni kaydedilmemis cevap isareti */
  yerTutucu?: boolean;
  /** Giden mesaji yazan yonetici ("Talat"); eski kayitlarda yok */
  yazan?: string | null;
}

export interface KonusmaKaydi {
  noteText?: string | null;
  messageText?: string | null;
  requestedAt?: string | null;
  messagedAt?: string | null;
  repliedAt?: string | null;
  kanal?: 'LINKEDIN' | 'EPOSTA';
}

const BASLIK_RE = /^── (\d{2}\.\d{2}\.\d{4})(?: (\d{2}:\d{2}))? · (LinkedIn|E-posta)( · Gelen)?(?: · Yazan: ([^·]+?))?(?: · Konu: (.*))? ──$/;

/** ISO ani → { tarih: "dd.mm.yyyy", saat: "HH:MM" } (Istanbul) */
export function isoTarihSaat(iso: string | null | undefined): { tarih: string | null; saat: string | null } {
  if (!iso) return { tarih: null, saat: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { tarih: null, saat: null };
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { tarih: `${p.day}.${p.month}.${p.year}`, saat: `${p.hour}:${p.minute}` };
}

/** Elle kayit bloklarini ayir; baslik yoksa null */
function bloklar(metin: string): Balon[] | null {
  const satirlar = metin.split('\n');
  if (!satirlar.some((s) => BASLIK_RE.test(s.trim()))) return null;
  const out: Balon[] = [];
  let cur: Balon | null = null;
  const govde: string[] = [];
  const kapat = () => {
    if (cur) out.push({ ...cur, metin: govde.join('\n').trim() });
    govde.length = 0;
  };
  for (const satir of satirlar) {
    const m = BASLIK_RE.exec(satir.trim());
    if (m) {
      kapat();
      cur = {
        yon: m[4] ? 'gelen' : 'giden',
        tarih: m[1],
        saat: m[2] ?? null,
        kanal: m[3] as Balon['kanal'],
        baslik: m[6]?.trim() || null,
        yazan: m[5]?.trim() || null,
        metin: '',
      };
    } else if (cur) {
      govde.push(satir);
    }
    // Ilk basliktan onceki metin (olmamali) yok sayilmaz: tek giden balon olarak eklenir
    else if (satir.trim()) govde.push(satir);
  }
  if (!cur && govde.length) out.push({ yon: 'giden', tarih: null, saat: null, kanal: null, baslik: null, metin: govde.join('\n').trim() });
  kapat();
  return out.filter((b) => b.metin || b.baslik);
}

export function konusmaBalonlari(k: KonusmaKaydi): Balon[] {
  const kanal = k.kanal === 'EPOSTA' ? 'E-posta' : 'LinkedIn';
  const out: Balon[] = [];
  if (k.noteText?.trim()) {
    out.push({ yon: 'giden', ...isoTarihSaat(k.requestedAt), kanal, baslik: 'Bağlantı notu', metin: k.noteText.trim() });
  }
  const mt = (k.messageText ?? '').trim();
  if (mt) {
    const b = bloklar(mt);
    if (b) out.push(...b);
    else {
      // Botun tek mesaji; InMail ise ilk satir konu
      const inmail = /^\[InMail\]\s*(.*)\n\n([\s\S]*)$/.exec(mt);
      out.push({
        yon: 'giden',
        ...isoTarihSaat(k.messagedAt),
        kanal,
        baslik: inmail ? `InMail: ${inmail[1].trim()}` : null,
        metin: (inmail ? inmail[2] : mt).trim(),
      });
    }
  }
  if (k.repliedAt && !out.some((b) => b.yon === 'gelen')) {
    out.push({ yon: 'gelen', ...isoTarihSaat(k.repliedAt), kanal, baslik: null, metin: 'Cevap verdi — metni kaydedilmedi. Aşağıdan ekleyebilirsin.', yerTutucu: true });
  }
  return out;
}

/** Tablodaki ozet: "3 mesaj · 1 cevap" */
export function konusmaOzeti(b: Balon[]): string {
  const giden = b.filter((x) => x.yon === 'giden').length;
  const gelen = b.filter((x) => x.yon === 'gelen').length;
  if (!giden && !gelen) return '—';
  return gelen ? `${giden} mesaj · ${gelen} cevap` : `${giden} mesaj`;
}
