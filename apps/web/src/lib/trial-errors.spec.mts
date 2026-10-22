/**
 * Sunucunun deneme hata kodlari panelde ham hata bildirimi olarak kalmaz (inceleme):
 * TRIAL_EXPIRED modali acar, TRIAL_SOURCE_REQUIRED yayin hedefi baglantili bildirim.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TRIAL_ERROR_COPY, isRawTrialToast, readApiErrorCode, siteIdFromApiPath, trialErrorAction,
} from './trial-errors';
import { LAPSED_COPY, expiredModal, lapsedNotice, readTrialAccess, trialBanner, trialPopup } from './trial-access';
import { SOURCE_REQUIRED_COPY } from './article-allowance';

const EXPIRED_MSG = 'Deneme süren doldu; hesabın şu an salt okunur.';
const SOURCE_MSG = 'Ücretsiz denemede makale üretmek için önce sitene bir yayın hedefi bağla (WordPress ya da Markdown ZIP).';

describe('trialErrorAction — yalniz 403 + bilinen kod', () => {
  it('TRIAL_EXPIRED → modal', () => {
    expect(trialErrorAction(403, { statusCode: 403, message: EXPIRED_MSG, code: 'TRIAL_EXPIRED' }, '/sites/s1/articles/generate'))
      .toEqual({ kind: 'expired', message: EXPIRED_MSG });
  });
  it('TRIAL_SOURCE_REQUIRED → istegin sitesinin yayin hedefleri; sitesiz yolda acik sayfanin sitesi, o da yoksa site listesi', () => {
    const body = { statusCode: 403, message: SOURCE_MSG, code: 'TRIAL_SOURCE_REQUIRED' };
    expect(trialErrorAction(403, body, '/sites/abc/articles/generate')).toEqual({ kind: 'source_required', message: SOURCE_MSG, href: '/sites/abc/publish-targets' });
    expect(trialErrorAction(403, body, '/mcp', '/sites/xyz/opportunities')).toMatchObject({ href: '/sites/xyz/publish-targets' });
    expect(trialErrorAction(403, body, '/mcp', '/dashboard')).toMatchObject({ href: '/sites' });
    expect(trialErrorAction(403, { code: 'TRIAL_SOURCE_REQUIRED' }, '/sites/a/x')).toMatchObject({ message: TRIAL_ERROR_COPY.sourceFallback });
  });
  it('baska kod, baska durum ya da govdesiz: null (cagiranin bildirimi aynen kalir)', () => {
    expect(trialErrorAction(403, { message: 'Bu işlem için yetkin yok.' }, '/sites/s1')).toBeNull();
    expect(trialErrorAction(403, { code: 'PAYTR_TEST_MODE' }, '/billing')).toBeNull();
    expect(trialErrorAction(400, { code: 'TRIAL_EXPIRED' }, '/sites/s1')).toBeNull();
    expect(trialErrorAction(403, 'metin', '/sites/s1')).toBeNull();
    expect(readApiErrorCode(null)).toBeNull();
  });
  it('yol ayristirma', () => {
    expect(siteIdFromApiPath('/sites/s%201/articles')).toBe('s 1');
    expect(siteIdFromApiPath('/sites')).toBeNull();
    expect(siteIdFromApiPath(null)).toBeNull();
  });
  it('ham kopya tanima: cagiranin onekli metni de; bos mesaj hicbir seyle eslesmez', () => {
    expect(isRawTrialToast(EXPIRED_MSG, EXPIRED_MSG)).toBe(true);
    expect(isRawTrialToast(`Kaydedilemedi: ${EXPIRED_MSG}`, EXPIRED_MSG)).toBe(true);
    expect(isRawTrialToast('Başka hata', EXPIRED_MSG)).toBe(false);
    expect(isRawTrialToast('herhangi', '')).toBe(false);
    expect(isRawTrialToast(undefined, EXPIRED_MSG)).toBe(false);
  });
});

describe('panele baglanti: api istemcisi olayi yayinlar, deneme bileseni dinler', () => {
  it('api.ts her hatali yanitta duyurur; ApiError makine kodunu tasir', () => {
    const src = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
    expect(src).toContain('announceTrialError(res.status, body, path);');
    expect(src).toContain('this.code = readApiErrorCode(rawBody);');
  });
  it('trial-upgrade dinler: sure doldu modalini yeniden acar, kaynak icin baglantili bildirim', () => {
    const src = readFileSync(new URL('../components/trial-upgrade.tsx', import.meta.url), 'utf8');
    expect(src).toContain('window.addEventListener(TRIAL_ERROR_EVENT, onTrialError)');
    expect(src).toContain('setExpiredSeen(false);');
    expect(src).toContain('label: TRIAL_ERROR_COPY.sourceAction');
  });
});

describe('plani biten eski musteri (phase lapsed): kilit ve "Deneme süren doldu" yok, kapatilabilir bant', () => {
  const lapsed = readTrialAccess({ phase: 'lapsed', endsAt: null, daysLeft: null, checkoutOpen: true, readOnly: false });
  it('sunucunun yeni evresi okunur', () => {
    expect(lapsed).toMatchObject({ phase: 'lapsed', readOnly: false });
  });
  it('bant: "Planın sona erdi — yeniden abone ol"; abonelik sayfasinda yok', () => {
    expect(lapsedNotice(lapsed, { pathname: '/dashboard' })).toEqual(LAPSED_COPY);
    expect(LAPSED_COPY.title).toBe('Planın sona erdi — yeniden abone ol');
    expect(lapsedNotice(lapsed, { pathname: '/billing' })).toBeNull();
  });
  it('deneme modali, geri sayim bandi ve deneme hatirlatmalari acilmaz', () => {
    expect(expiredModal(lapsed, { pathname: '/dashboard' })).toBeNull();
    expect(trialBanner(lapsed)).toBeNull();
    expect(trialPopup(lapsed, { dismissed: new Set() })).toBeNull();
    expect(lapsedNotice(readTrialAccess({ phase: 'expired', readOnly: true }), { pathname: '/dashboard' })).toBeNull();
  });
});

describe('metin: denemede eklenebilen hedefler WordPress ve Markdown ZIP (FTP yok)', () => {
  it('kilit ipucu ve makaleler bandi', () => {
    expect(SOURCE_REQUIRED_COPY.hint).toContain('WordPress ya da Markdown ZIP');
    const page = readFileSync(new URL('../app/(dashboard)/sites/[id]/articles/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('(WordPress ya da Markdown ZIP)');
    expect(page).not.toContain('FTP vb.');
  });
  it('"Takvime" ipucu dogru: denemede kendiliginden uretilmez, kullanici baslatir (sunucu denemede ayirma yapmaz)', () => {
    const table = readFileSync(new URL('../components/content-flow-table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('Ücretsiz denemede kendiliğinden üretilmez; takvimdeki konuyu “Şimdi üret” ile sen başlatırsın.');
  });
});
