import { X509Certificate } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { caIssuersUrl, completeChain, isChainError, parseCertificate, tlsChainCompletedFor, tlsChainNotNeeded, tlsErrorDetail } from './tls-chain.js';

/**
 * Eksik sertifika zincirini tamamlama — guvenlik kurallari.
 *
 * NEDEN VAR: labenko.com (12.11.2026) yalniz kendi sertifikasini gonderiyordu;
 * tarayicida aciliyor, bizim tarayicimiz "Siteye baglanti kurulamadi" diyordu.
 * Cozum dogrulamayi kapatmak DEGIL: eksik halka indirilir, imzasi denetlenir ve
 * zincir guvenilen bir koke baglanmadikca kullanilmaz.
 *
 * Her olumsuz test TEK bir denetimi sinar (denetim kaldirilirsa o test kirilir):
 *  - SAHTE_ARA: gercek ara sertifikayla AYNI ad ve anahtar kimligi, baska
 *    anahtar → yalniz imza dogrulamasi yakalar.
 *  - CA_OLMAYAN: yapragi gercekten imzalamis ama sertifika otoritesi degil.
 *  - ARA 2036'da biter, KOK 2126'da → "ara sertifika suresi dolmus, kok gecerli".
 *  - KOK_KISA 2036'da biter, ARA_B 2126'da → "kok suresi dolmus, ara gecerli".
 *
 * Sertifikalar bu test icin uretildi; depoda yalniz ACIK sertifikalar var,
 * ozel anahtar yok.
 */
const KOK = `-----BEGIN CERTIFICATE-----
MIIBdDCCARmgAwIBAgIJAJBBjxOIkxCOMAoGCCqGSM49BAMCMBwxGjAYBgNVBAMM
EVJhbmtzVXAgVGVzdCBLb2t1MCAXDTI2MTExMjEzMDI0NloYDzIxMjYxMDE5MTMw
MjQ2WjAcMRowGAYDVQQDDBFSYW5rc1VwIFRlc3QgS29rdTBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABFSoFEl0hUg68sDG3JWfS944JnIKD/KugoWqL+k2bBVP8Q2r
Z/N0eZpuEBzbK1wOrop5aBk3KKhrZaj4HII5LsGjQjBAMA8GA1UdEwEB/wQFMAMB
Af8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBSvbIFR4FWA1Urx5KtMYQixzvFd
2zAKBggqhkjOPQQDAgNJADBGAiEAyx6bc4bnU23PILUZU2yIyHb2rOi4Tz3IZoIT
MN1B9YkCIQDY+Mm/Fc3rE8oJ686h2fhBuvZHHAgeZ1hcqe+3d4cvMg==
-----END CERTIFICATE-----
`;
const BASKA = `-----BEGIN CERTIFICATE-----
MIIBbzCCARWgAwIBAgIJAOuDD/2lmenOMAoGCCqGSM49BAMCMBoxGDAWBgNVBAMM
D0Jhc2thIFRlc3QgS29rdTAgFw0yNjExMTIxMzAyNDZaGA8yMTI2MTAxOTEzMDI0
NlowGjEYMBYGA1UEAwwPQmFza2EgVGVzdCBLb2t1MFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAEW6uAiXCDKIf3v6Pklj3ANWpZfHyfzUD5i/1j3it/KP3nolUUpELQ
WDe0VM4mQt7dBhLuMlbm09Vok7jSjrQBkKNCMEAwDwYDVR0TAQH/BAUwAwEB/zAO
BgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKWTfoIx81roToPDvH330e91bDAFMAoG
CCqGSM49BAMCA0gAMEUCIA8vsKkptDyts7XBF+qw0zBI7PC2WsC3E8sfYsBw5SUX
AiEAvg3BxygFRcVhBLZygRaSLgIfGxG94k2o7pA41Op8C4s=
-----END CERTIFICATE-----
`;
const ARA = `-----BEGIN CERTIFICATE-----
MIIBnjCCAUSgAwIBAgIJAJXy7pdhz83IMAoGCCqGSM49BAMCMBwxGjAYBgNVBAMM
EVJhbmtzVXAgVGVzdCBLb2t1MB4XDTI2MTExMjEzMDI0N1oXDTM2MTEwOTEzMDI0
N1owJTEjMCEGA1UEAwwaUmFua3NVcCBUZXN0IEFyYSBTZXJ0aWZpa2EwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAQL2lz8XtC+LVdCr/B8yrY3KKSFkdG4wb9gzKhR
VmMZqhvYAu6aPf49IVytQVvwtaxbYkzevRkk4VH0s4+B6m8lo2YwZDASBgNVHRMB
Af8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUszPu8WkAP0hj
W5zJ//gAeU/WR4UwHwYDVR0jBBgwFoAUr2yBUeBVgNVK8eSrTGEIsc7xXdswCgYI
KoZIzj0EAwIDSAAwRQIhAKUKpJiBUPPr3CsW7R/BSyS2iaf6qndvfQbakYNn3DEO
AiBXfvlN+Aexai/rCmQb/l414mq4vP929/PD47tHgwgJiw==
-----END CERTIFICATE-----
`;
const YAPRAK = `-----BEGIN CERTIFICATE-----
MIIB7DCCAZGgAwIBAgIJAJwNfiI4b+roMAoGCCqGSM49BAMCMCUxIzAhBgNVBAMM
GlJhbmtzVXAgVGVzdCBBcmEgU2VydGlmaWthMCAXDTI2MTExMjEzMDI0N1oYDzIx
MjYxMDE5MTMwMjQ3WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATdz3nYiBgM8nmowqSy3Z5H7R+70ityGxnd7osrbYSiNsF4
sJq0wPq5XxBkhBQyGsf7IHXsZcHoxQ16cQn7vCA6o4G4MIG1MAwGA1UdEwEB/wQC
MAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQT
MBGCCWxvY2FsaG9zdIcEfwAAATBDBggrBgEFBQcBAQQ3MDUwMwYIKwYBBQUHMAKG
J2h0dHA6Ly9haWEucmFua3N1cC10ZXN0LmludmFsaWQvYXJhLmRlcjAfBgNVHSME
GDAWgBSzM+7xaQA/SGNbnMn/+AB5T9ZHhTAKBggqhkjOPQQDAgNJADBGAiEAr3/m
1qu46MKdEdyqzdtw8ejUIa+R5HTYhour/991ea8CIQCgG4rDIFqyOt+v6x7qVjd5
bIINmGVXgfIJR3hg4US2MQ==
-----END CERTIFICATE-----
`;
const SAHTE_ARA = `-----BEGIN CERTIFICATE-----
MIIBnjCCAUSgAwIBAgIJAL/JP+Uqw1Z4MAoGCCqGSM49BAMCMBoxGDAWBgNVBAMM
D0Jhc2thIFRlc3QgS29rdTAgFw0yNjExMTIxMzAyNDdaGA8yMTI2MTAxOTEzMDI0
N1owJTEjMCEGA1UEAwwaUmFua3NVcCBUZXN0IEFyYSBTZXJ0aWZpa2EwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAASu4s9DI5zFf07QXEBKHX3+NodMdIgVns2M8gYS
T8RY5oMLAlEOHXtUhSs+L3Uyau82gwv8gJ0BizygtrF5DNZLo2YwZDASBgNVHRMB
Af8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUszPu8WkAP0hj
W5zJ//gAeU/WR4UwHwYDVR0jBBgwFoAUpZN+gjHzWuhOg8O8fffR73VsMAUwCgYI
KoZIzj0EAwIDSAAwRQIhAPKr1vbWC/oQ3cvOvc3LhxpcnpkhX1m+YU7gBNhnu1x1
AiBhlO3sqr5om1h5KQkr6k8+BfQQP/qg/IhrT28iirmxBQ==
-----END CERTIFICATE-----
`;
const CA_OLMAYAN = `-----BEGIN CERTIFICATE-----
MIIBiDCCAS2gAwIBAgIJAJXy7pdhz83JMAoGCCqGSM49BAMCMBwxGjAYBgNVBAMM
EVJhbmtzVXAgVGVzdCBLb2t1MCAXDTI2MTExMjEzMDI0N1oYDzIxMjYxMDE5MTMw
MjQ3WjAiMSAwHgYDVQQDDBdSYW5rc1VwIFRlc3QgQ0EgT2xtYXlhbjBZMBMGByqG
SM49AgEGCCqGSM49AwEHA0IABFstVf2nPD89NM9rbzl6UYPLhYs6jsx0TdrpUxcz
3Bgcg1/EvHURv9u6yS3ckO1Pv3ocQOp9mxEKNWmP1FpVN+KjUDBOMAwGA1UdEwEB
/wQCMAAwHQYDVR0OBBYEFDHjKCb+VzJTTWI0hKZho+NjfHaNMB8GA1UdIwQYMBaA
FK9sgVHgVYDVSvHkq0xhCLHO8V3bMAoGCCqGSM49BAMCA0kAMEYCIQDua7mq1vzm
iWJNhaSlUnf5SoUJeZEeUe0hIbzlCBOodQIhANomQ2hICrwHZ069qT69+ox82sf4
VtyVX9ypY3Zk7O/E
-----END CERTIFICATE-----
`;
const YAPRAK_C = `-----BEGIN CERTIFICATE-----
MIIB6TCCAY6gAwIBAgIJAJeuVQiH4RjOMAoGCCqGSM49BAMCMCIxIDAeBgNVBAMM
F1JhbmtzVXAgVGVzdCBDQSBPbG1heWFuMCAXDTI2MTExMjEzMDI0N1oYDzIxMjYx
MDE5MTMwMjQ3WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggq
hkjOPQMBBwNCAASRT+ueQRe7Kxru9QUj6p+kN6z7VoKM4mSU91yKho0xBm3mB/7p
F2BNnZWI2WXI+lLBxzZq76Ts5xMpBT7ft95Io4G4MIG1MAwGA1UdEwEB/wQCMAAw
DgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGC
CWxvY2FsaG9zdIcEfwAAATBDBggrBgEFBQcBAQQ3MDUwMwYIKwYBBQUHMAKGJ2h0
dHA6Ly9haWEucmFua3N1cC10ZXN0LmludmFsaWQvYXJhLmRlcjAfBgNVHSMEGDAW
gBQx4ygm/lcyU01iNISmYaPjY3x2jTAKBggqhkjOPQQDAgNJADBGAiEAvNUQNnuv
vTUC/nVfHKE+0qbXYT1hbpkjSZOK+Lxl5dMCIQC/IjixmbAuvh3H0FWXKhfWO2U8
GnZ38y8rGResl556jw==
-----END CERTIFICATE-----
`;
const KOK_KISA = `-----BEGIN CERTIFICATE-----
MIIBeTCCAR+gAwIBAgIJANS4yG0B/oU+MAoGCCqGSM49BAMCMCAxHjAcBgNVBAMM
FUtpc2EgT211cmx1IFRlc3QgS29rdTAeFw0yNjExMTIxMzAyNDdaFw0zNjExMDkx
MzAyNDdaMCAxHjAcBgNVBAMMFUtpc2EgT211cmx1IFRlc3QgS29rdTBZMBMGByqG
SM49AgEGCCqGSM49AwEHA0IABJZovUjkMb11Y47lraifEiiqVNse15/MOI0qELMZ
dR2/ph+aroT+vU6NlJFEUGdvd2IMWJNsLWHB/dmZepaaNvajQjBAMA8GA1UdEwEB
/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTIgGyyQ94Q5QfmU2It
HDFp5uO16DAKBggqhkjOPQQDAgNIADBFAiEAgbFKBTIy79qetC4iKX+FWh5eN7SI
Li3X2kMUKOd91ocCIBbKXlYCxdetcMrjXFB3FfIwcaSjwyHA2gZS6DFeRQ77
-----END CERTIFICATE-----
`;
const ARA_B = `-----BEGIN CERTIFICATE-----
MIIBozCCAUmgAwIBAgIJAJMvS3VTVV4cMAoGCCqGSM49BAMCMCAxHjAcBgNVBAMM
FUtpc2EgT211cmx1IFRlc3QgS29rdTAgFw0yNjExMTIxMzAyNDdaGA8yMTI2MTAx
OTEzMDI0N1owJDEiMCAGA1UEAwwZVXp1biBPbXVybHUgQXJhIFNlcnRpZmlrYTBZ
MBMGByqGSM49AgEGCCqGSM49AwEHA0IABDzjN66B9hi3lri2k8V/REfrjGcS6GbI
IvNZWDypoonAWOQNX+limJH7ZKWLtaanjXVF+MkqUKRQ5xC8O1eEMPmjZjBkMBIG
A1UdEwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBRqCH6m
PHnZHwX3ZvZ4QBJ0NR/HhzAfBgNVHSMEGDAWgBTIgGyyQ94Q5QfmU2ItHDFp5uO1
6DAKBggqhkjOPQQDAgNIADBFAiEAkSAw2iG9i9idg0YR09SQVKcK5ytvihmrpujV
EQv949kCIDCN7x9zs/k1D8beMudWv2FL+zQgbKiu03zm4lVnfhFM
-----END CERTIFICATE-----
`;
const YAPRAK_B = `-----BEGIN CERTIFICATE-----
MIIB6zCCAZCgAwIBAgIJAOgOsZoJl59JMAoGCCqGSM49BAMCMCQxIjAgBgNVBAMM
GVV6dW4gT211cmx1IEFyYSBTZXJ0aWZpa2EwIBcNMjYxMTEyMTMwMjQ3WhgPMjEy
NjEwMTkxMzAyNDdaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABOzlkAVlbuRF6j6jpaSBicy4B7dLDZghZftIaRmpTFok8XQF
PTB9dj96HA4O/w0oh8OvB3BEfhE13LSe8BIBjT2jgbgwgbUwDAYDVR0TAQH/BAIw
ADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMw
EYIJbG9jYWxob3N0hwR/AAABMEMGCCsGAQUFBwEBBDcwNTAzBggrBgEFBQcwAoYn
aHR0cDovL2FpYS5yYW5rc3VwLXRlc3QuaW52YWxpZC9hcmEuZGVyMB8GA1UdIwQY
MBaAFGoIfqY8edkfBfdm9nhAEnQ1H8eHMAoGCCqGSM49BAMCA0kAMEYCIQDNGHQc
bn/Yk3hDiZksL09c0CsLECz8/qxpaf/UmuDYmwIhAOQ1cEgI0IyBcYm5mE1dZktB
i1qnBFf3suk3z371RqlX
-----END CERTIFICATE-----
`;

const cert = (pem: string) => new X509Certificate(pem);
const der = (pem: string) => Buffer.from(cert(pem).raw);
const AIA = 'http://aia.ranksup-test.invalid/ara.der';
const BUGUN = new Date('2027-01-01T00:00:00Z');
const YIL_2050 = new Date('2050-01-01T00:00:00Z');

describe('completeChain', () => {
  it('yalniz yaprak gonderildiyse ara sertifikayi yapraktaki adresten indirir', async () => {
    const fetchIssuer = vi.fn(async () => der(ARA));
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer, roots: [KOK], now: BUGUN });
    expect(fetchIssuer).toHaveBeenCalledTimes(1);
    expect(fetchIssuer).toHaveBeenCalledWith(AIA);
    expect(extras).toHaveLength(1);
    expect(cert(extras![0]).fingerprint256).toBe(cert(ARA).fingerprint256);
  });

  it('PEM olarak gelen ust sertifika da kabul edilir', async () => {
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => Buffer.from(ARA), roots: [KOK], now: BUGUN });
    expect(extras).toHaveLength(1);
  });

  it('sunucu ara sertifikayi gonderdiyse indirme yapmaz', async () => {
    const fetchIssuer = vi.fn(async () => der(ARA));
    const extras = await completeChain({ presented: [cert(YAPRAK), cert(ARA)], fetchIssuer, roots: [KOK], now: BUGUN });
    expect(fetchIssuer).not.toHaveBeenCalled();
    expect(extras).toHaveLength(1);
  });

  it('zincir guvenilen bir koke baglanmiyorsa null — hicbir sey eklenmez', async () => {
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => der(ARA), roots: [BASKA], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('IMZA: ayni adi ve anahtar kimligini tasiyan sahte ara sertifika reddedilir (kendi koku guvenilir olsa bile)', async () => {
    // On kosul: sahte sertifika ad/kimlik eslesmesinden gecer, yalniz imza tutmaz
    expect(cert(YAPRAK).checkIssued(cert(SAHTE_ARA))).toBe(true);
    expect(cert(YAPRAK).verify(cert(SAHTE_ARA).publicKey)).toBe(false);
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => der(SAHTE_ARA), roots: [KOK, BASKA], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('IMZA: sunucunun kendi gonderdigi sahte ara sertifika da kullanilmaz, gercegi indirilir', async () => {
    const fetchIssuer = vi.fn(async () => der(ARA));
    const extras = await completeChain({ presented: [cert(YAPRAK), cert(SAHTE_ARA)], fetchIssuer, roots: [KOK, BASKA], now: BUGUN });
    expect(fetchIssuer).toHaveBeenCalledTimes(1);
    expect(extras!.map((p) => cert(p).fingerprint256)).toEqual([cert(ARA).fingerprint256]);
  });

  it('SERTIFIKA OTORITESI: yapragi imzalamis ama otorite olmayan sertifika zincire alinmaz', async () => {
    // On kosul: imza gercek, sertifika otorite degil
    expect(cert(YAPRAK_C).verify(cert(CA_OLMAYAN).publicKey)).toBe(true);
    expect(cert(CA_OLMAYAN).ca).toBe(false);
    const extras = await completeChain({ presented: [cert(YAPRAK_C)], fetchIssuer: async () => der(CA_OLMAYAN), roots: [KOK], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('GECERLILIK: suresi dolmus ara sertifika kullanilmaz (kok hala gecerli)', async () => {
    const input = { presented: [cert(YAPRAK)], fetchIssuer: async () => der(ARA), roots: [KOK] };
    expect(await completeChain({ ...input, now: BUGUN })).toHaveLength(1);
    expect(await completeChain({ ...input, now: YIL_2050 })).toBeNull();
  });

  it('GECERLILIK: suresi dolmus koke guvenilmez (ara sertifika hala gecerli)', async () => {
    const input = { presented: [cert(YAPRAK_B)], fetchIssuer: async () => der(ARA_B), roots: [KOK_KISA] };
    expect(await completeChain({ ...input, now: BUGUN })).toHaveLength(1);
    expect(await completeChain({ ...input, now: YIL_2050 })).toBeNull();
  });

  it('indirilen sertifika yapragi imzalamamissa null (ilgisiz bir sertifika)', async () => {
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => der(BASKA), roots: [KOK, BASKA], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('sertifika olmayan yanit (HTML) → null', async () => {
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => Buffer.from('<html>404</html>'), roots: [KOK], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('indirme hata verirse null', async () => {
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer: async () => { throw new Error('ag'); }, roots: [KOK], now: BUGUN });
    expect(extras).toBeNull();
  });

  it('indirme sayisi sinirlidir', async () => {
    const fetchIssuer = vi.fn(async () => der(ARA));
    const extras = await completeChain({ presented: [cert(YAPRAK)], fetchIssuer, roots: [KOK], now: BUGUN, maxFetches: 0 });
    expect(extras).toBeNull();
    expect(fetchIssuer).not.toHaveBeenCalled();
  });

  it('eksik halka yoksa bos dizi; sertifika gonderilmediyse null', async () => {
    const never = async () => { throw new Error('cagrilmamali'); };
    expect(await completeChain({ presented: [cert(ARA)], fetchIssuer: never, roots: [KOK], now: BUGUN })).toEqual([]);
    expect(await completeChain({ presented: [], fetchIssuer: never, roots: [KOK], now: BUGUN })).toBeNull();
  });
});

describe('sertifika hatasi siniflandirma', () => {
  it('zincir kurulamadi kodlari tamamlama icin isaretlenir (undici hatayi cause icinde de tasiyabilir)', () => {
    for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']) {
      expect(isChainError({ code }), code).toBe(true);
      expect(isChainError({ cause: { code } }), code).toBe(true);
      expect(tlsErrorDetail({ code }), code).toBe('chain');
    }
  });

  it('suresi dolmus, alan adi uyusmayan ve kendinden imzali sertifika TAMAMLANMAZ, turu ayri bildirilir', () => {
    const cases: Array<[string, string]> = [
      ['CERT_HAS_EXPIRED', 'expired'], ['CERT_NOT_YET_VALID', 'expired'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'name'],
      ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self_signed'], ['SELF_SIGNED_CERT_IN_CHAIN', 'self_signed'],
    ];
    for (const [code, detail] of cases) {
      expect(isChainError({ code }), code).toBe(false);
      expect(tlsErrorDetail({ code }), code).toBe(detail);
    }
  });

  it('sertifika disi ag hatasi sertifika hatasi sayilmaz', () => {
    for (const err of [{ code: 'ECONNRESET' }, { code: 'ECONNREFUSED' }, new Error('x'), null, undefined]) {
      expect(isChainError(err)).toBe(false);
      expect(tlsErrorDetail(err)).toBeNull();
    }
  });
});

describe('caIssuersUrl / parseCertificate / kayit', () => {
  it('yapraktaki ust sertifika adresini okur; adres yoksa null', () => {
    expect(caIssuersUrl(cert(YAPRAK))).toBe(AIA);
    expect(caIssuersUrl(cert(KOK))).toBeNull();
  });

  it('DER ve PEM okunur, baska veri null doner', () => {
    expect(parseCertificate(der(ARA))?.subject).toContain('RanksUp Test Ara Sertifika');
    expect(parseCertificate(Buffer.from(ARA))?.subject).toContain('RanksUp Test Ara Sertifika');
    expect(parseCertificate(Buffer.from('sertifika degil'))).toBeNull();
  });

  it('zinciri tamamlanmamis alan adi icin bulgu yok; normal baglanti kaydi siler', () => {
    expect(tlsChainCompletedFor('hic-gorulmedi.example')).toBe(false);
    tlsChainNotNeeded('hic-gorulmedi.example');
    expect(tlsChainCompletedFor('hic-gorulmedi.example')).toBe(false);
  });
});
