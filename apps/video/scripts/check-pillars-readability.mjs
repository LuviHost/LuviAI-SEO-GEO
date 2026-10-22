#!/usr/bin/env node
/**
 * Sutun tanitim videolarinin (src/pillars; 5 sutun + Canli Tarayici) okunurluk denetimi — her video × dikey /
 * yatay (iki bicim AYNI zaman planini kullanir, her biri ayri raporlanir).
 *
 *   metin   ≥ max(2,0 sn; 0,3 sn × kelime + 1,0 sn) tam gorunur
 *   not     ≥ 3,0 sn ("Örnek …" etiketleri, plan kosulu, "Kart gerekmez")
 *   liste   son oge tam gorundukten sonra tum liste ≥ 2,5 sn ekranda
 *   giris   ayni karede birden fazla YENI oge girmez (panel basligi + ipucu + etiket gibi tek
 *           blok olarak gelen eslikciler haric)
 *   sure    ≤ 60 sn (Reels), hedef 30-45 sn (uyari)
 *   gizli   ekrandaki hicbir metinde gercek bicimli ingest anahtari yok (luvi_ing_ + onaltilik; yalniz
 *           maskeli 'luvi_ing_••••••••' gecerli) — script.json ve sahne kaynaklari (src/pillars/*.tsx) taranir
 *
 * "Tam gorunur" BAGIMSIZ hesaplanir: giris yayi Remotion spring() ile kare kare yeniden calistirilir
 * (yay %95 ve opaklik 1), cikis sahne sonundan EXIT_FRAMES once baslar (son sahnede video sonu).
 * schedule.mjs'in ayni degerleri bulmasi da dogrulanir (settle esitligi).
 *
 *   node scripts/check-pillars-readability.mjs                  # tablo + ozet; ihlalde cikis kodu 1
 *   node scripts/check-pillars-readability.mjs --brief          # yalniz ozet
 *   node scripts/check-pillars-readability.mjs --videos out/ranksup-5   # + mp4 sureleri plana esit mi
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spring } from 'remotion';
import { countWords } from '../src/tempo/plan.mjs';
import { ENTER, EXIT_FRAMES, FPS, LEAD, RULES, planVideo } from '../src/pillars/schedule.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, 'src', 'pillars', 'script.json'), 'utf8'));
const args = process.argv.slice(2);
const brief = args.includes('--brief');
const videosDir = args.includes('--videos') ? join(ROOT, args[args.indexOf('--videos') + 1]) : null;

/** panel / gorselle ayni anda gelen eslikci ogeler (tek blok) */
const COMPANIONS = new Set(['hint', 'tag', 'chip', 'plan', 's1', 'sample']);

// yay: p ≥ 0.95 VE opaklik (p × 1,4) = 1 olan ilk kare
let settle = -1;
for (let f = 0; f < 200; f++) {
  const p = spring({ frame: f, fps: FPS, config: ENTER.config });
  if (p >= 0.95 && p * 1.4 >= 1) {
    settle = f;
    break;
  }
}
if (settle !== ENTER.settle) {
  console.error(`schedule.mjs ENTER.settle (${ENTER.settle}) spring() ile uyusmuyor (${settle})`);
  process.exit(1);
}

const need = (it) => {
  if (it.kind === 'ui') return 0;
  const base = Math.max(RULES.minSec, RULES.perWordSec * countWords(it.text) + RULES.baseSec);
  return it.kind === 'note' ? Math.max(RULES.noteMinSec, base) : base;
};
const sec = (f) => (f / FPS).toFixed(2);
const short = (t, n = 44) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

let failures = 0;
const summary = [];

// gizli anahtar korumasi: Canli Tarayici videosu kurulum kodunu gosterir; anahtar YALNIZ maskeli olabilir
const SECRET_RE = /luvi_ing_[0-9a-f]{6,}/i;
const leakSources = [['script.json', JSON.stringify(SCRIPT)], ...readdirSync(join(ROOT, 'src', 'pillars')).filter((f) => f.endsWith('.tsx')).map((f) => [f, readFileSync(join(ROOT, 'src', 'pillars', f), 'utf8')])];
for (const [name, text] of leakSources) {
  if (SECRET_RE.test(text)) {
    console.error(`GIZLI ANAHTAR: ${name} gercek bicimli bir ingest anahtari iceriyor (yalniz maskeli 'luvi_ing_••••••••' kullan)`);
    failures++;
  }
}
for (const v of SCRIPT.videos) {
  const plan = planVideo(SCRIPT, v.id);
  for (const fmt of ['dikey', 'yatay']) {
    const rows = [];
    const listRows = [];
    let minMargin = Infinity;
    let worst = '';
    let bad = 0;
    let simul = 0;
    for (const s of plan.scenes) {
      const byAppear = new Map();
      const lists = {};
      for (const it of Object.values(s.items)) {
        const from = it.appear - LEAD + settle;
        const outFrame = it.out !== undefined ? s.start + Math.round(it.out * plan.fpb) : s.end;
        const to = s.last && it.out === undefined ? plan.durationInFrames : outFrame - EXIT_FRAMES;
        const vis = (to - from) / FPS;
        const req = need(it);
        const ok = vis + 1e-9 >= req;
        if (!ok) bad++;
        if (it.kind !== 'ui' && vis - req < minMargin) {
          minMargin = vis - req;
          worst = it.text;
        }
        rows.push({ sahne: s.id, metin: short(it.text), tur: it.kind ?? 'text', kelime: it.kind === 'ui' ? '-' : countWords(it.text), 'tam gorunur': `${sec(from)}–${sec(to)}`, 'sure(sn)': vis.toFixed(2), 'gerekli(sn)': it.kind === 'ui' ? '-' : req.toFixed(2), sonuc: ok ? 'OK' : 'KISA' });
        if (it.list) (lists[it.list] ??= []).push({ from, to });
        if (!COMPANIONS.has(it.id)) byAppear.set(it.appear, [...(byAppear.get(it.appear) ?? []), it.id]);
      }
      for (const [name, its] of Object.entries(lists)) {
        const last = Math.max(...its.map((x) => x.from));
        const until = Math.min(...its.map((x) => x.to));
        const hold = (until - last) / FPS;
        const ok = hold + 1e-9 >= RULES.listHoldSec;
        if (!ok) bad++;
        listRows.push({ sahne: s.id, liste: name, oge: its.length, 'son oge tam': sec(last), 'tum liste(sn)': hold.toFixed(2), gerekli: RULES.listHoldSec.toFixed(2), sonuc: ok ? 'OK' : 'KISA' });
      }
      for (const [f, ids] of byAppear) {
        if (ids.length > 1) {
          simul++;
          bad++;
          rows.push({ sahne: s.id, metin: `AYNI ANDA GIRIS: ${ids.join(', ')}`, tur: '-', kelime: '-', 'tam gorunur': sec(f), 'sure(sn)': '-', 'gerekli(sn)': '-', sonuc: 'IHLAL' });
        }
      }
    }
    const dur = plan.durationInFrames / FPS;
    if (dur > 60) bad++;
    let fileDur = '-';
    if (videosDir) {
      const file = join(videosDir, `${plan.slug}-${fmt}.mp4`);
      if (!existsSync(file)) {
        fileDur = 'YOK';
        bad++;
      } else {
        const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], { encoding: 'utf8' });
        const frames = Number.parseInt(r.stdout.trim(), 10);
        fileDur = frames === plan.durationInFrames ? `${frames} kare = plan` : `${frames} kare ≠ ${plan.durationInFrames}`;
        if (frames !== plan.durationInFrames) bad++;
      }
    }
    failures += bad;
    if (!brief) {
      console.log(`\n══ ${plan.slug}-${fmt} · ${dur.toFixed(2)} sn · ${plan.style} ${plan.bpm} BPM ══`);
      console.table(rows);
      if (listRows.length) console.table(listRows);
    }
    summary.push({
      video: `${plan.slug}-${fmt}`,
      'sure(sn)': dur.toFixed(2) + (dur > 45 || dur < 30 ? ' (hedef 30-45)' : ''),
      muzik: `${plan.style} ${plan.bpm}`,
      metin: rows.filter((r) => r.tur !== 'ui' && r.tur !== '-').length,
      liste: listRows.length,
      'es giris': simul,
      ihlal: bad,
      'en dar pay(sn)': minMargin.toFixed(2),
      'en dar metin': short(worst, 36),
      ...(videosDir ? { dosya: fileDur } : {}),
    });
  }
}

console.log(`\nGiris yayi: vurustan ${LEAD} kare once baslar, ${settle}. karede %95 + tam opak (spring ile dogrulandi); cikis ${EXIT_FRAMES} kare.`);
console.log(`Kural: metin ≥ max(${RULES.minSec}; ${RULES.perWordSec}×kelime + ${RULES.baseSec}) sn · not ≥ ${RULES.noteMinSec} sn · liste son ogeden sonra ≥ ${RULES.listHoldSec} sn · ≤ 60 sn`);
console.table(summary);
if (failures) {
  console.error(`\n${failures} okunurluk ihlali`);
  process.exit(1);
}
console.log(`\nTum metinler okunurluk kuralini sagliyor (${summary.length} render); gizli anahtar taramasi temiz.`);
