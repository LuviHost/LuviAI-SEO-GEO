// RanksUp PM2 ecosystem
// Standalone Next.js .env okumadığı için biz manuel yükleyip her process'e geçiriyoruz.
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
const envFromFile = {};
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envFromFile[key] = val;
  }
}

const sharedEnv = {
  NODE_ENV: 'production',
  NODE_OPTIONS: "--dns-result-order=ipv4first",
  // NODE_TLS_REJECT_UNAUTHORIZED kaldirildi — googleapis TLS sertifika dogrulama gerektiriyor
  ...envFromFile,
};

module.exports = {
  apps: [
    {
      name: 'luviai-api',
      cwd: '/var/www/luviai/apps/api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { ...sharedEnv, PORT: 3001 },
      error_file: '/var/log/luviai/api.err.log',
      out_file: '/var/log/luviai/api.out.log',
      max_memory_restart: '800M',
    },
    {
      name: 'luviai-web',
      cwd: '/var/www/luviai/apps/web/.next/standalone/apps/web',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: { ...sharedEnv, PORT: 3000, HOSTNAME: '127.0.0.1' },
      error_file: '/var/log/luviai/web.err.log',
      out_file: '/var/log/luviai/web.out.log',
      max_memory_restart: '600M',
    },
    {
      name: 'luviai-worker',
      cwd: '/var/www/luviai/apps/worker',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: sharedEnv,
      error_file: '/var/log/luviai/worker.err.log',
      out_file: '/var/log/luviai/worker.out.log',
      /**
       * Worker'in bellek tavani — site taramasi yuzunden yukseltildi.
       *
       * OLCULEN: site taramasi 100 sayfa cekiyor; sayfa govdeleri 2 MB'ta
       * kirpilsa bile (bkz. site-crawler.service.ts) hizli tahsis/atma
       * dongusunde V8 RSS'i 800 MB'in uzerine cikariyor. Eski 1 GB tavaninda
       * PM2 tarama ortasinda SIGTERM gonderiyordu: is yarida oluyor, DB'deki
       * kayit PROCESSING'de kaliyor, BullMQ takilan isi yeniden veriyor ve
       * ayni tarama tekrar cokuyordu. Uretimde ayni is 7 kez bastan basladi.
       *
       * IKI AYAR BIRLIKTE CALISIR:
       *  - max_old_space_size=1536: V8'e acik bir tavan verir. Tavan yokken
       *    V8 tembel davranip cop toplamak yerine buyuyor; tavan varken
       *    yaklastikca major GC yapar. Asil frendir.
       *  - max_memory_restart=2G: PM2'nin siniri artik V8'in tavaninin
       *    UZERINDE. Boylece normal calismada once GC devreye girer, PM2
       *    yalnizca gercek bir kacak varsa surece mudahale eder.
       *
       * Makine 16 GB (olculdu: 11.8 GB bos) — 2 GB tek worker icin guvenli.
       */
      node_args: ['--max-old-space-size=1536'],
      max_memory_restart: '2G',
    },
  ],
};
