#!/usr/bin/env node
/**
 * RanksUp — LinkedIn "Claude ile gönder" Mac ajanı (26.11.2026).
 *
 * Kurucunun Mac'inde launchd ile sürekli çalışır (kurulum: scripts/linkedin-claude-ajan-kur.sh).
 * Dakikada bir sunucuya "bekleyen iş var mı?" diye sorar. Panelde "Claude ile gönder"e basılınca
 * işi alır; her kişi için Claude Code'u Chrome bağlantısıyla (`claude -p --chrome`) çalıştırır,
 * sonucu kişi kişi sunucuya yazar.
 *
 * - Bağlantıyı Mac başlatır: sunucudan Mac'e tünel gerekmez.
 * - Claude Code aboneliğin oturumuyla çalışır (API anahtarı yok → ayrıca fatura yok, kotadan düşer).
 * - Claude'a yalnız Chrome araçları açıktır; dosya, komut, web araçları kapalı.
 * - Komut metni sunucudan gelir (LinkedIn değişince ajanı güncellemek gerekmez).
 *
 * Ayarlar (ortam değişkeni, hepsi isteğe bağlı):
 *   RANKSUP_AJAN_URL   (varsayılan https://ranksup.ai/api/internal/linkedin-claude)
 *   RANKSUP_AJAN_KEY_DOSYASI (varsayılan ~/.ranksup/linkedin-claude.key)
 *   CLAUDE_BIN (varsayılan claude), CLAUDE_MODEL (varsayılan sonnet)
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const EV = homedir();
const API = (process.env.RANKSUP_AJAN_URL || 'https://ranksup.ai/api/internal/linkedin-claude').replace(/\/+$/, '');
const KEY_DOSYASI = process.env.RANKSUP_AJAN_KEY_DOSYASI || join(EV, '.ranksup', 'linkedin-claude.key');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const CALISMA_DIZINI = join(EV, '.ranksup', 'claude-calisma');
const LOG_DIZINI = join(EV, 'Library', 'Logs', 'ranksup');
const SORMA_ARALIGI_MS = 60_000;
const KISI_ZAMAN_ASIMI_MS = 8 * 60_000;
const SONUCLAR = ['GONDERILDI', 'KURU_TAMAM', 'ZATEN_BAGLI', 'BEKLIYOR', 'BULUNAMADI', 'ENGEL', 'HATA'];

mkdirSync(CALISMA_DIZINI, { recursive: true });
mkdirSync(LOG_DIZINI, { recursive: true });

function log(m) {
  const satir = `${new Date().toISOString()} ${m}\n`;
  process.stdout.write(satir);
  try { appendFileSync(join(LOG_DIZINI, 'linkedin-claude.log'), satir); } catch { /* yoksay */ }
}

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));
const rastgele = (a, b) => a + Math.round(Math.random() * (b - a));

function anahtar() {
  try { return readFileSync(KEY_DOSYASI, 'utf8').trim(); } catch { return ''; }
}

async function istek(yol, govde) {
  const key = anahtar();
  if (!key) throw new Error(`anahtar dosyası yok: ${KEY_DOSYASI}`);
  const r = await fetch(`${API}/${yol}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ajan-key': key, 'user-agent': `ranksup-linkedin-ajan/1 (${hostname()})` },
    body: JSON.stringify(govde ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const metin = await r.text();
  if (!r.ok) throw new Error(`${yol} ${r.status}: ${metin.slice(0, 200)}`);
  return metin ? JSON.parse(metin) : {};
}

/** Çıktıdaki son geçerli {"durum": ...} */
function sonucuAyikla(metin) {
  const adaylar = String(metin ?? '').match(/\{[^{}]*"durum"[^{}]*\}/g) || [];
  for (let i = adaylar.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(adaylar[i]);
      if (SONUCLAR.includes(j?.durum)) return { durum: j.durum, aciklama: String(j.aciklama ?? '').slice(0, 300) };
    } catch { /* sonraki */ }
  }
  return null;
}

/** Tek kişi: Claude Code'u Chrome ile çalıştır. Mac uykuya geçmesin diye caffeinate ile sarılır. */
function claudeCalistir(komut) {
  return new Promise((resolve) => {
    const args = [
      '-i', CLAUDE_BIN, '-p', komut,
      '--chrome', '--model', MODEL, '--output-format', 'json',
      '--allowedTools', 'mcp__claude-in-chrome', 'ToolSearch',
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent',
    ];
    const p = spawn('/usr/bin/caffeinate', args, { cwd: CALISMA_DIZINI, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const zaman = setTimeout(() => { p.kill('SIGKILL'); }, KISI_ZAMAN_ASIMI_MS);
    p.stdout.on('data', (c) => { if (out.length < 2_000_000) out += c; });
    p.stderr.on('data', (c) => { if (err.length < 20_000) err += c; });
    p.on('error', (e) => { clearTimeout(zaman); resolve({ durum: 'HATA', aciklama: `claude çalıştırılamadı: ${e.message}` }); });
    p.on('close', (kod, sinyal) => {
      clearTimeout(zaman);
      if (sinyal === 'SIGKILL') return resolve({ durum: 'HATA', aciklama: 'zaman aşımı (8 dk)' });
      let sonucMetni = out;
      try {
        const j = JSON.parse(out);
        sonucMetni = String(j.result ?? '');
        if (j.is_error) return resolve({ durum: 'HATA', aciklama: `Claude hatası: ${sonucMetni.slice(0, 200)}` });
      } catch { /* düz metin */ }
      const s = sonucuAyikla(sonucMetni);
      if (s) return resolve(s);
      resolve({ durum: 'HATA', aciklama: `sonuç okunamadı (çıkış ${kod}): ${(sonucMetni || err).replace(/\s+/g, ' ').slice(0, 160)}` });
    });
  });
}

async function isiYurut(is) {
  log(`iş ${is.id} alındı: ${is.kisiler.length} kişi${is.kuru ? ' (kuru)' : ''}`);
  for (let i = 0; i < is.kisiler.length; i++) {
    const k = is.kisiler[i];
    if (i > 0) {
      // Eski botun freni: gerçek gönderimde kişiler arası 2–6 dk
      const bekle = is.kuru ? 5_000 : rastgele(120_000, 360_000);
      log(`  ${Math.round(bekle / 1000)} sn bekleniyor`);
      await uyu(bekle);
    }
    log(`  kişi ${k.id} başladı`);
    const s = await claudeCalistir(k.komut);
    log(`  kişi ${k.id}: ${s.durum} — ${s.aciklama}`);
    let devam = true;
    try {
      const r = await istek('sonuc', { isId: is.id, kisiId: k.id, durum: s.durum, aciklama: s.aciklama });
      devam = r?.devam !== false;
    } catch (e) {
      // Sonuç yazılamazsa durmak en güvenlisi: aynı kişiye tekrar istek gitmesin
      log(`  sonuç yazılamadı: ${e.message}`);
      await istek('bitti', { isId: is.id, hata: `Sonuç sunucuya yazılamadı: ${e.message}` }).catch(() => undefined);
      return;
    }
    if (!devam) { log(`  iş durduruldu (iptal ya da LinkedIn engeli)`); break; }
  }
  await istek('bitti', { isId: is.id }).catch((e) => log(`bitti yazılamadı: ${e.message}`));
  log(`iş ${is.id} bitti`);
}

async function dongu() {
  log(`ajan başladı → ${API} (model ${MODEL})`);
  let sonHata = '';
  for (;;) {
    try {
      const r = await istek('al', {});
      sonHata = '';
      if (r?.is) await isiYurut(r.is);
    } catch (e) {
      // Aynı hatayı dakikada bir log'a basma
      if (e.message !== sonHata) log(`sunucuya sorulamadı: ${e.message}`);
      sonHata = e.message;
    }
    await uyu(SORMA_ARALIGI_MS);
  }
}

dongu();
