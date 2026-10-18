/**
 * Admin LinkedIn ice aktarimi partiler halinde gider (inceleme S17): her parti API'nin
 * GERCEK govde sinirlarina sigar — bayt (request-body.ts DEFAULT_JSON_BODY_LIMIT_BYTES,
 * 100 KB) ve oge butcesi (common/json-body-budget.ts jsonBudgetViolation, 10.000 oge).
 * Eskiden butun satirlar tek istekte gidiyordu; ~575 satirdan sonra 413.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_JSON_BODY_LIMIT_BYTES } from '../../../api/src/request-body';
import { DEFAULT_JSON_BODY_BUDGET, jsonBudgetViolation } from '../../../api/src/common/json-body-budget';
import {
  IMPORT_BATCH_MAX_ROWS, IMPORT_MAX_ROWS_PER_RUN, canonicalProfileUrl, importRunNotice, parseImportText, planImportBatches,
  remainingImportText, runImportBatches,
} from './linkedin-import';
import type { LinkedinImportRow } from './api';

// Gercekci Turk B2B satirlari (7 sutun) — inceleme S17'nin olcum verisiyle ayni bicim
const ADLAR = ['Ayşe', 'Mehmet', 'Zeynep', 'Mustafa', 'Elif', 'Ahmet', 'Şule', 'Gökhan', 'Özge', 'Çağrı', 'İlker', 'Burcu'];
const SOYADLAR = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Öztürk', 'Aydın', 'Arslan', 'Doğan', 'Kılıç'];
const FIRMALAR = ['Türkiye İş Bankası', 'Garanti BBVA', 'Pegasus Hava Yolları', 'Türk Telekom', 'Allianz Sigorta', '"Örnek A.Ş., İstanbul"'];
const UNVANLAR = ['Dijital Pazarlama Direktörü', 'Genel Müdür Yardımcısı', 'Kurumsal İletişim Direktörü', 'Head of Marketing'];

function csv(n: number, uzun = false): string {
  const satirlar = ['ad,soyad,firma,unvan,sektor,kademe,profileUrl'];
  for (let i = 0; i < n; i++) {
    const unvan = uzun ? `${UNVANLAR[i % UNVANLAR.length]} ${'ve Büyüme Stratejisi Sorumlusu '.repeat(4)}`.trim() : UNVANLAR[i % UNVANLAR.length];
    satirlar.push([ADLAR[i % ADLAR.length], SOYADLAR[(i * 7) % SOYADLAR.length], FIRMALAR[(i * 3) % FIRMALAR.length], unvan, 'finans', String(1 + (i % 2)), `https://tr.linkedin.com/in/kisi-${i}-örnek?trk=x`].join(','));
  }
  return satirlar.join('\n');
}

const govde = (rows: LinkedinImportRow[]) => JSON.stringify({ rows });
const bayt = (s: string) => new TextEncoder().encode(s).length;

/** API'nin govde sinirlarini uygulayan sahte gonderim (413 metinleri API'ninkiyle ayni anlamda) */
function sunucu() {
  const alinan: number[] = [];
  return {
    alinan,
    send: async (batch: LinkedinImportRow[]) => {
      const g = govde(batch);
      if (bayt(g) > DEFAULT_JSON_BODY_LIMIT_BYTES) throw new Error('Gönderilen veri çok büyük (en fazla 100 KB).');
      if (jsonBudgetViolation(JSON.parse(g), DEFAULT_JSON_BODY_BUDGET) !== null) throw new Error('Gönderilen veri çok fazla öğe içeriyor (en fazla 10.000).');
      alinan.push(batch.length);
      return { upserted: batch.length, skipped: 0 };
    },
  };
}

describe('parseImportText (sayfadan tasindi — davranis ayni)', () => {
  it('basligi atlar, tirnakli alani boler, profili kanonik yapar, kopyayi ve eksik satiri raporlar; ham satiri tutar', () => {
    const p = parseImportText('ad;soyad;firma;unvan;sektor;kademe;profileUrl\nAyşe;Yılmaz;"Örnek; A.Ş.";CMO;finans;2;linkedin.com/in/Ayse-Y\n\nEksik;;Firma;;;;https://linkedin.com/in/x\nAyşe;Yılmaz;X;;;;https://www.linkedin.com/in/ayse-y/');
    expect(p.rows).toEqual([{ ad: 'Ayşe', soyad: 'Yılmaz', firma: 'Örnek; A.Ş.', unvan: 'CMO', sektor: 'finans', kademe: 2, profileUrl: 'https://www.linkedin.com/in/ayse-y/' }]);
    expect(p.kaynak).toEqual(['Ayşe;Yılmaz;"Örnek; A.Ş.";CMO;finans;2;linkedin.com/in/Ayse-Y']);
    expect(p.hatalar).toEqual(['Satır 4: ad, soyad, firma ve profileUrl zorunlu', 'Satır 5: aynı profil tekrar ediyor, atlandı']);
    expect(canonicalProfileUrl('https://example.com/in/x')).toBeNull();
  });
});

describe('S17 — partiler API govde sinirlarina sigar', () => {
  it('1.000 satir tek istekte 100 KB sinirini asardi (eski davranis); partiler halinde hepsi aktarilir', async () => {
    const { rows } = parseImportText(csv(1000));
    expect(rows).toHaveLength(1000);
    expect(bayt(govde(rows))).toBeGreaterThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
    const s = sunucu();
    const r = await runImportBatches({ rows, send: s.send });
    expect(r).toMatchObject({ upserted: 1000, skipped: 0, sentRows: 1000, error: null });
    expect(s.alinan.every((n) => n <= IMPORT_BATCH_MAX_ROWS)).toBe(true);
    expect(s.alinan.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('5.000 satir (tek seferlik sinir) ve uzun alanli satirlar da sigar: her parti bayt ve oge butcesinin altinda', async () => {
    for (const uzun of [false, true]) {
      const { rows } = parseImportText(csv(IMPORT_MAX_ROWS_PER_RUN, uzun));
      for (const parti of planImportBatches(rows)) {
        expect(bayt(govde(parti))).toBeLessThanOrEqual(DEFAULT_JSON_BODY_LIMIT_BYTES);
        expect(jsonBudgetViolation(JSON.parse(govde(parti)), DEFAULT_JSON_BODY_BUDGET)).toBeNull();
      }
      const s = sunucu();
      expect((await runImportBatches({ rows, send: s.send })).sentRows).toBe(IMPORT_MAX_ROWS_PER_RUN);
    }
  });

  it('siralama korunur; tek basina siniri asan satir kendi partisinde gider (sunucu karar verir)', () => {
    const satir = (i: number, n = 10) => ({ ad: `a${i}`, soyad: 's', firma: 'f'.repeat(n), profileUrl: `https://www.linkedin.com/in/k${i}/` });
    const rows = [satir(0), satir(1, 200_000), satir(2), satir(3)];
    const partiler = planImportBatches(rows);
    expect(partiler.map((p) => p.map((r) => r.ad))).toEqual([['a0'], ['a1'], ['a2', 'a3']]);
    expect(planImportBatches(Array.from({ length: 801 }, (_, i) => satir(i))).map((p) => p.length)).toEqual([400, 400, 1]);
  });

  it('bir parti hata verirse durulur: gonderilen satirlar ilk N satirdir, kalanlar metinde kalir; bildirim bunu soyler', async () => {
    const { rows, kaynak } = parseImportText(csv(1000));
    let n = 0;
    const r = await runImportBatches({
      rows,
      send: async (batch) => {
        n++;
        if (n === 2) throw new Error('Çok fazla istek attın. Birkaç saniye bekleyip tekrar dene.');
        return { upserted: batch.length, skipped: 0 };
      },
    });
    expect(r).toMatchObject({ upserted: 400, sentRows: 400, batches: 3, doneBatches: 1, error: 'Çok fazla istek attın. Birkaç saniye bekleyip tekrar dene.' });
    expect(kaynak.slice(r.sentRows)).toHaveLength(600);
    const bildirim = importRunNotice(r, { leftover: 0, unsent: 600 });
    expect(bildirim.tone).toBe('error');
    expect(bildirim.title).toBe('İçe aktarma 2/3. partide durdu: Çok fazla istek attın. Birkaç saniye bekleyip tekrar dene.');
    expect(bildirim.description).toContain('400 satır aktarıldı');
    expect(bildirim.description).toContain('Gönderilmeyen 600 satır metin kutusunda');
    expect(bildirim.description).toContain('tekrar denemek güvenli');
  });

  it('basari bildirimi toplam sayilari ve parti sayisini; tek seferlik sinir ustunu soyler', async () => {
    const s = sunucu();
    const { rows } = parseImportText(csv(900));
    const r = await runImportBatches({ rows, send: s.send });
    expect(importRunNotice(r, { leftover: 0, unsent: 0 })).toEqual({ tone: 'success', title: '900 kayıt eklendi/güncellendi', description: '3 partide sırayla gönderildi.' });
    expect(importRunNotice(r, { leftover: 12, unsent: 0 })).toMatchObject({ tone: 'warning', description: expect.stringContaining('Tek seferde en fazla 5.000 satır aktarılır; kalan 12 satır metin kutusunda') });
    // Eski API (skipped yok, upserted yok): partinin tamami sayilir
    const eski = await runImportBatches({ rows: rows.slice(0, 3), send: async () => null });
    expect(eski).toMatchObject({ upserted: 3, skipped: 0, sentRows: 3 });
  });

  it('ilerleme her partiden once ve sonda bildirilir', async () => {
    const s = sunucu();
    const adimlar: string[] = [];
    await runImportBatches({ rows: parseImportText(csv(850)).rows, send: s.send, onProgress: (d, t) => adimlar.push(`${d}/${t}`) });
    expect(adimlar).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });
});

describe('S17 yan etkisi — hata sonrasi metin kutusundan YALNIZ aktarilan satirlar cikar', () => {
  /** rv15 s17b: 1.000 gecerli satir + baslik + iki sorunlu satir (11. satir bozuk adres, 501. satir soyadsiz) */
  function yapistirma(): string {
    const satirlar = ['ad,soyad,firma,unvan,sektor,kademe,profileUrl'];
    for (let i = 0; i < 1000; i++) satirlar.push(`Ad${i},Soyad${i},Firma ${i},Müdür,finans,1,https://www.linkedin.com/in/kisi-${i}`);
    satirlar.splice(10, 0, 'Bozuk,Satir,Firma,,,,https://example.com/in/x');
    satirlar.splice(500, 0, 'Eksik,,Firma,,,,https://www.linkedin.com/in/eksik');
    return satirlar.join('\n');
  }

  it('2. parti 401 ile durunca baslik ve sorunlu satirlar kutuda kalir, yalniz aktarilan 400 satir cikar; bildirim ne kaldigini soyler', async () => {
    const metin = yapistirma();
    const p = parseImportText(metin);
    expect(p.rows).toHaveLength(1000);
    expect(p.hatalar).toHaveLength(2);
    let n = 0;
    const r = await runImportBatches({
      rows: p.rows,
      send: async (b) => {
        if (++n === 2) throw new Error('Oturumun süresi dolmuş, lütfen tekrar giriş yap.');
        return { upserted: b.length, skipped: 0 };
      },
    });
    expect(r).toMatchObject({ sentRows: 400, error: 'Oturumun süresi dolmuş, lütfen tekrar giriş yap.' });
    const kalan = remainingImportText(metin, p, r.sentRows);
    const satirlar = kalan.text.split('\n');
    // Eski davranis: kutu yalniz gonderilmeyen 600 gecerli satirla yeniden yaziliyordu (baslik ve sorunlular silinirdi)
    expect(satirlar[0]).toBe('ad,soyad,firma,unvan,sektor,kademe,profileUrl');
    expect(satirlar).toContain('Bozuk,Satir,Firma,,,,https://example.com/in/x');
    expect(satirlar).toContain('Eksik,,Firma,,,,https://www.linkedin.com/in/eksik');
    expect(satirlar).toHaveLength(1 + 2 + 600);
    expect(kalan).toMatchObject({ invalidLines: 2, unsentRows: 600 });
    // Aktarilan satirlar cikti; kalanlar ozgun sirasiyla (sorunlu satirlar eski yerinde)
    expect(satirlar).not.toContain('Ad0,Soyad0,Firma 0,Müdür,finans,1,https://www.linkedin.com/in/kisi-0');
    expect(satirlar.filter((l, i) => i > 0 && !l.startsWith('Bozuk') && !l.startsWith('Eksik'))).toEqual(p.kaynak.slice(400));
    expect(metin.split('\n').filter((l) => satirlar.includes(l))).toEqual(satirlar);
    // Kutuda kalan metin yeniden ayristirilinca ayni sorunlu satirlar ve gonderilmeyen satirlar
    const yeniden = parseImportText(kalan.text);
    expect(yeniden.rows.map((x) => x.profileUrl)).toEqual(p.rows.slice(400).map((x) => x.profileUrl));
    expect(yeniden.hatalar).toHaveLength(2);
    const bildirim = importRunNotice(r, { leftover: 0, unsent: 600, invalid: kalan.invalidLines });
    expect(bildirim.description).toBe(
      '400 satır aktarıldı (400 kayıt eklendi/güncellendi) ve metin kutusundan çıkarıldı. Gönderilmeyen 600 satır ve 2 sorunlu satır metin kutusunda kaldı; tekrar denemek güvenli: aynı profil ikinci kez eklenmez, güncellenir.',
    );
  });

  it('ilk parti durursa metin hic degismez; tamami aktarilirsa yalniz baslik ve sorunlular kalir, hic sorunlu yoksa kutu bosalir', async () => {
    const metin = yapistirma();
    const p = parseImportText(metin);
    const hic = await runImportBatches({ rows: p.rows, send: async () => { throw new Error('Çok fazla istek attın.'); } });
    expect(remainingImportText(metin, p, hic.sentRows).text).toBe(metin);
    expect(importRunNotice(hic, { leftover: 0, unsent: 1000, invalid: 2 }).description).toBe(
      'Hiçbir satır aktarılmadı. Gönderilmeyen 1000 satır ve 2 sorunlu satır metin kutusunda kaldı; tekrar denemek güvenli: aynı profil ikinci kez eklenmez, güncellenir.',
    );
    const tam = await runImportBatches({ rows: p.rows, send: async (b) => ({ upserted: b.length, skipped: 0 }) });
    const kalan = remainingImportText(metin, p, tam.sentRows);
    expect(kalan.text.split('\n')).toEqual([
      'ad,soyad,firma,unvan,sektor,kademe,profileUrl',
      'Bozuk,Satir,Firma,,,,https://example.com/in/x',
      'Eksik,,Firma,,,,https://www.linkedin.com/in/eksik',
    ]);
    expect(importRunNotice(tam, { leftover: 0, unsent: 0, invalid: kalan.invalidLines })).toEqual({
      tone: 'success',
      title: '1000 kayıt eklendi/güncellendi',
      description: '3 partide sırayla gönderildi. 2 sorunlu satır aktarılmadı; düzeltebilmen için metin kutusunda duruyor.',
    });
    // Sorunlu satir yoksa geriye yalniz baslik kalir: kutu bosalir (eski basari davranisi)
    const temiz = csv(5);
    const tp = parseImportText(temiz);
    expect(remainingImportText(temiz, tp, 5)).toEqual({ text: '', invalidLines: 0, unsentRows: 0 });
  });

  it('tek seferlik sinirin ustundeki satirlar ve bos satirlar yerinde kalir', () => {
    const metin = ['ad;soyad;firma;unvan;sektor;kademe;profileUrl', 'A;B;C;;;;linkedin.com/in/a', '', 'Eksik;;C;;;;linkedin.com/in/x', 'D;E;F;;;;linkedin.com/in/d', 'G;H;I;;;;linkedin.com/in/g'].join('\n');
    const p = parseImportText(metin);
    expect(p.kaynakSatir).toEqual([1, 4, 5]);
    expect(p.baslikSatiri).toBe(0);
    // Ilk 2 satir aktarildi (or. sinir 2 olsaydi), G kaldi
    const kalan = remainingImportText(metin, p, 2);
    expect(kalan.text).toBe(['ad;soyad;firma;unvan;sektor;kademe;profileUrl', '', 'Eksik;;C;;;;linkedin.com/in/x', 'G;H;I;;;;linkedin.com/in/g'].join('\n'));
    expect(kalan).toMatchObject({ invalidLines: 1, unsentRows: 1 });
    // Basliksiz metin: ilk satir veridir, cikarilir
    const bassiz = 'A,B,C,,,,linkedin.com/in/a\nX,Y,Z,,,,linkedin.com/in/z';
    expect(remainingImportText(bassiz, parseImportText(bassiz), 1).text).toBe('X,Y,Z,,,,linkedin.com/in/z');
  });
});

