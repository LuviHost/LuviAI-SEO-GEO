import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http, { type RequestListener } from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeSafeTextFetch } from './safe-fetch.js';
import { tlsChainCompletedFor } from './tls-chain.js';

/**
 * Eksik sertifika zinciri — gercek TLS baglantisiyla uctan uca.
 *
 * NEDEN VAR: labenko.com (12.11.2026) yalniz kendi sertifikasini gonderiyordu.
 * Tarayici aciyor, tarayicimiz "Siteye baglanti kurulamadi" diyor, kurulum
 * ilerlemiyordu. Bu testler yerel bir HTTPS sunucusuyla ayni durumu kurar:
 *  - zincir tamamlanip baglanilir (ve ikinci istekte yeniden indirilmez),
 *  - ust sertifika URETIMDEKI yoldan (sertifikadaki adresten, SSRF korumali)
 *    indirilir; adres ic aga cikiyorsa indirilmez,
 *  - zincir guvenilen bir koke baglanmiyorsa BAGLANILMAZ (dogrulama kapatilmadi),
 *  - tamamlama istegin suresini asamaz.
 *
 * Sunucunun ozel anahtari gerektigi icin sertifikalar testte openssl ile
 * uretilir (depoda ozel anahtar tutulmaz); openssl yoksa testler atlanir.
 */
function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const AIA_INJECTED = 'http://aia.ranksup-test.invalid/ara.der';

function config(cn: string, aia: string): string {
  return [
    '[req]', 'distinguished_name = dn', 'prompt = no', '[dn]', `CN = ${cn}`,
    '[v3_ca]', 'basicConstraints = critical, CA:TRUE', 'keyUsage = critical, keyCertSign, cRLSign', 'subjectKeyIdentifier = hash',
    '[v3_int]', 'basicConstraints = critical, CA:TRUE, pathlen:0', 'keyUsage = critical, keyCertSign, cRLSign', 'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid',
    '[v3_leaf]', 'basicConstraints = critical, CA:FALSE', 'keyUsage = critical, digitalSignature', 'extendedKeyUsage = serverAuth',
    'subjectAltName = DNS:localhost, IP:127.0.0.1', `authorityInfoAccess = caIssuers;URI:${aia}`, 'authorityKeyIdentifier = keyid',
    '',
  ].join('\n');
}

/**
 * kok → ara → yaprak (localhost) ve ilgisiz ikinci bir kok uretir. Yaprak, ust
 * sertifika adresi (AIA) farkli uc kopya olarak imzalanir: testin kendi verdigi
 * adres, yerel HTTP sunucusu, ic ag adresi.
 */
function makePki(dir: string, aiaLocal: string) {
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  const key = (name: string) => run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`);
  const cnf = (name: string, cn: string, aia = AIA_INJECTED) => writeFileSync(join(dir, `${name}.cnf`), config(cn, aia));
  for (const [root, cn] of [['kok', 'RanksUp Test Koku'], ['baska', 'Baska Test Koku']]) {
    cnf(root, cn);
    key(root);
    run('req', '-new', '-x509', '-sha256', '-key', `${root}.key`, '-out', `${root}.pem`, '-days', '2', '-config', `${root}.cnf`, '-extensions', 'v3_ca');
  }
  cnf('ara', 'RanksUp Test Ara Sertifika');
  key('ara');
  run('req', '-new', '-sha256', '-key', 'ara.key', '-out', 'ara.csr', '-config', 'ara.cnf');
  run('x509', '-req', '-sha256', '-in', 'ara.csr', '-CA', 'kok.pem', '-CAkey', 'kok.key', '-CAcreateserial', '-out', 'ara.pem', '-days', '2', '-extfile', 'ara.cnf', '-extensions', 'v3_int');
  key('yaprak');
  const leaf = (name: string, aia: string) => {
    cnf(name, 'localhost', aia);
    run('req', '-new', '-sha256', '-key', 'yaprak.key', '-out', `${name}.csr`, '-config', `${name}.cnf`);
    run('x509', '-req', '-sha256', '-in', `${name}.csr`, '-CA', 'ara.pem', '-CAkey', 'ara.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.cnf`, '-extensions', 'v3_leaf');
  };
  leaf('yaprak', AIA_INJECTED);
  leaf('yaprak-yerel', aiaLocal);
  leaf('yaprak-icag', 'http://10.0.0.1/ara.der');
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  return {
    kok: read('kok.pem'), baska: read('baska.pem'), ara: read('ara.pem'), yaprakKey: read('yaprak.key'),
    yaprak: read('yaprak.pem'), yaprakYerel: read('yaprak-yerel.pem'), yaprakIcAg: read('yaprak-icag.pem'),
  };
}

describe.skipIf(!hasOpenssl())('eksik sertifika zinciri — gercek TLS baglantisi', () => {
  let dir = '';
  let pki: ReturnType<typeof makePki>;
  let araDer: Buffer;
  let baskaDer: Buffer;
  const servers: Array<http.Server | https.Server> = [];
  let aiaHits = 0;
  let urlYaprak = '';   // labenko.com durumu: sunucu yalniz kendi sertifikasini gonderir
  let urlAra = '';      // yaprak + ara gonderir; kok Node'un deposunda yok
  let urlYerel = '';    // yalniz yaprak; ust sertifika adresi yerel HTTP sunucusu
  let urlIcAg = '';     // yalniz yaprak; ust sertifika adresi ic ag (10.0.0.1)

  const listen = (server: http.Server | https.Server) => new Promise<number>((resolve) => {
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ranksup-tls-'));
    // Ust sertifikayi sunan HTTP sunucusu once acilir: adresi yapraga yazilacak
    const aiaPort = await listen(http.createServer((_req, res) => {
      aiaHits++;
      res.setHeader('content-type', 'application/pkix-cert');
      res.end(araDer);
    }));
    pki = makePki(dir, `http://127.0.0.1:${aiaPort}/ara.der`);
    araDer = Buffer.from(new X509Certificate(pki.ara).raw);
    baskaDer = Buffer.from(new X509Certificate(pki.baska).raw);
    const handler: RequestListener = (_req, res) => { res.setHeader('content-type', 'text/plain'); res.end('tamam'); };
    const serve = (cert: string) => listen(https.createServer({ key: pki.yaprakKey, cert }, handler));
    urlYaprak = `https://localhost:${await serve(pki.yaprak)}/`;
    urlAra = `https://localhost:${await serve(pki.yaprak + pki.ara)}/`;
    urlYerel = `https://localhost:${await serve(pki.yaprakYerel)}/`;
    urlIcAg = `https://localhost:${await serve(pki.yaprakIcAg)}/`;
  });

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => { s.closeAllConnections?.(); s.close(() => resolve(null)); })));
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const policy = { isBlocked: () => false, allowAnyPort: true, ipv4Only: true } as const;

  it('yalniz yaprak gonderen sunucuya zinciri tamamlayarak baglanir; ikinci istekte yeniden indirmez', async () => {
    const fetchIssuer = vi.fn(async () => araDer);
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok], fetchIssuer });
    const first = await fetchText(urlYaprak);
    expect(first).toMatchObject({ status: 200, text: 'tamam' });
    const second = await fetchText(`${urlYaprak}baska-sayfa`);
    expect(second.status).toBe(200);
    expect(fetchIssuer).toHaveBeenCalledTimes(1);
    expect(fetchIssuer).toHaveBeenCalledWith(AIA_INJECTED);
    // Site bize acik ama zinciri eksik: denetimde bulgu olarak gosterilir
    expect(tlsChainCompletedFor('localhost')).toBe(true);
  });

  it('URETIM YOLU: ust sertifikayi sertifikadaki adresten kendisi indirir', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok] });
    const before = aiaHits;
    expect(await fetchText(urlYerel)).toMatchObject({ status: 200, text: 'tamam' });
    expect(aiaHits).toBe(before + 1);
  });

  it('URETIM YOLU: ust sertifika adresi ic aga cikiyorsa indirilmez, baglanti kurulmaz', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, isBlocked: (ip) => ip === '10.0.0.1', trustedRoots: [pki.kok] });
    await expect(fetchText(urlIcAg)).rejects.toMatchObject({ code: 'tls', detail: 'chain' });
  });

  it('zincir guvenilen bir koke baglanmiyorsa BAGLANMAZ (dogrulama kapatilmadi)', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.baska], fetchIssuer: async () => araDer });
    await expect(fetchText(urlYaprak)).rejects.toMatchObject({ code: 'tls', detail: 'chain' });
  });

  it('yapragi imzalamayan bir sertifika sunulursa baglanmaz', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok, pki.baska], fetchIssuer: async () => baskaDer });
    await expect(fetchText(urlYaprak)).rejects.toMatchObject({ code: 'tls', detail: 'chain' });
  });

  it('ust sertifika indirilemezse sertifika hatasi doner, "ag hatasi" degil', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok], fetchIssuer: async () => { throw new Error('indirilemedi'); } });
    await expect(fetchText(urlYaprak)).rejects.toMatchObject({ code: 'tls', detail: 'chain' });
  });

  it('ara sertifikayi gonderen sunucuda indirme yapmadan, guvenilen koke baglanarak baglanir', async () => {
    const fetchIssuer = vi.fn(async () => { throw new Error('cagrilmamali'); });
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok], fetchIssuer });
    expect(await fetchText(urlAra)).toMatchObject({ status: 200, text: 'tamam' });
    expect(fetchIssuer).not.toHaveBeenCalled();
  });

  it('tamamlama istegin suresini asamaz: sure dolunca zaman asimi doner', async () => {
    const fetchText = makeSafeTextFetch({ ...policy, trustedRoots: [pki.kok], fetchIssuer: () => new Promise<Buffer>(() => { /* hic donmez */ }) });
    const started = Date.now();
    await expect(fetchText(urlYaprak, { timeoutMs: 400 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('DAYANAK: Node, guven deposuna eklenen ara sertifikayi tek basina guven capasi saymaz', async () => {
    // Yeniden denemede ara sertifikalar `ca` listesine eklenir. Bu guvenlidir cunku
    // Node zinciri yine kendinden imzali, guvenilen bir koke kadar kurmak ister:
    // yalniz ara sertifika verilirse baglanti reddedilir. Bu davranis degisirse
    // (kismi zincir kabul edilirse) bu test kirilir ve tasarim yeniden dusunulmeli.
    const code = await new Promise<string>((resolve) => {
      const req = https.get(urlYaprak, { ca: [pki.ara] }, (res) => { res.resume(); resolve('BAGLANDI'); });
      req.on('error', (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    });
    expect(code).toBe('UNABLE_TO_GET_ISSUER_CERT');
  });
});
