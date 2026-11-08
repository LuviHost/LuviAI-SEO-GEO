import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { etiketDegeri, resendAyar, resendMesaj, resendOlayEsle, resendSorunlari, svixDogrula } from './resend-kanal.js';
import type { EpostaKimlik } from '../prospect/eposta-sablon.js';

const ENV = {
  RESEND_API_KEY: 're_test', MAILJET_FROM_EMAIL: 'emir@ranksup.ai', MAILJET_FROM_NAME: 'Emir · RanksUp',
  EPOSTA_RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('gizli-anahtar').toString('base64'),
};

describe('resendAyar / resendSorunlari', () => {
  it('ayni hesabin anahtarina ve Mailjet gonderen adresine duser; ayri degiskenler onceliklidir', () => {
    expect(resendAyar(ENV)).toMatchObject({ apiKey: 're_test', from: 'emir@ranksup.ai', replyTo: 'emir@ranksup.ai', fromName: 'Emir · RanksUp' });
    expect(resendAyar({ ...ENV, EPOSTA_RESEND_API_KEY: 're_ayri', EPOSTA_RESEND_FROM: 'Info@RanksUp.ai' })).toMatchObject({ apiKey: 're_ayri', from: 'info@ranksup.ai' });
    expect(resendSorunlari(resendAyar(ENV))).toEqual([]);
  });

  it('webhook sirri olmadan hazir degil (fren kor kalir); noreply adresinden gitmez', () => {
    expect(resendSorunlari(resendAyar({ ...ENV, EPOSTA_RESEND_WEBHOOK_SECRET: '' })).join()).toMatch(/WEBHOOK_SECRET/);
    expect(resendSorunlari(resendAyar({ ...ENV, EPOSTA_RESEND_FROM: 'noreply@ranksup.ai' })).join()).toMatch(/noreply/);
    expect(resendSorunlari(resendAyar({})).join()).toMatch(/RESEND_API_KEY yok/);
  });
});

describe('svixDogrula', () => {
  it('Svix belgesindeki ornek vektoru dogrular', () => {
    const ok = svixDogrula(
      'whsec_plJ3nmyCDGBKInavdOK15jsl',
      { id: 'msg_loFOjxBNrRLzqYUf', timestamp: '1731705121', signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' },
      '{"event_type":"ping","data":{"success":true}}',
      1731705121,
    );
    expect(ok).toBe(true);
  });

  it('govde degisirse, zaman toleransi asilirsa ya da imza yoksa reddeder; listede biri tutması yeter', () => {
    const sir = ENV.EPOSTA_RESEND_WEBHOOK_SECRET;
    const govde = '{"type":"email.bounced"}';
    const imza = createHmac('sha256', Buffer.from('gizli-anahtar')).update(`m1.1000.${govde}`).digest('base64');
    const b = { id: 'm1', timestamp: '1000', signature: `v1,yanlis v1,${imza}` };
    expect(svixDogrula(sir, b, govde, 1000)).toBe(true);
    expect(svixDogrula(sir, b, Buffer.from(govde), 1100)).toBe(true);
    expect(svixDogrula(sir, b, govde + ' ', 1000)).toBe(false);
    expect(svixDogrula(sir, b, govde, 1000 + 301)).toBe(false);
    expect(svixDogrula(sir, { ...b, signature: undefined }, govde, 1000)).toBe(false);
    expect(svixDogrula('', b, govde, 1000)).toBe(false);
  });
});

describe('resendOlayEsle', () => {
  const olay = (type: string, data: Record<string, unknown> = {}) => ({
    type, created_at: '2026-11-04T09:00:00.000Z', data: { email_id: 'e-1', to: ['Info@Firma.com.tr'], ...data },
  });

  it('geri donme, bastirma ve sikayet kapatici durumlara esler', () => {
    expect(resendOlayEsle(olay('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'no such user' } })))
      .toMatchObject({ emailId: 'e-1', alici: 'info@firma.com.tr', durum: 'BOUNCE', hata: 'Permanent: General: no such user' });
    expect(resendOlayEsle(olay('email.suppressed'))).toMatchObject({ durum: 'BOUNCE', sonOlay: 'suppressed' });
    expect(resendOlayEsle(olay('email.complained'))).toMatchObject({ durum: 'SPAM' });
    expect(resendOlayEsle(olay('email.failed'))).toMatchObject({ durum: 'HATA' });
  });

  it('gecici geri donme satiri kapatir ama ayri isaretlenir; kalici ve belirsiz kalici sayilir', () => {
    expect(resendOlayEsle(olay('email.bounced', { bounce: { type: 'Transient', subType: 'General', message: 'try later' } })))
      .toMatchObject({ durum: 'BOUNCE', sonOlay: 'soft_bounce', hata: 'Transient: General: try later' });
    expect(resendOlayEsle(olay('email.bounced', { bounce: { type: 'Permanent', subType: 'General' } }))).toMatchObject({ durum: 'BOUNCE', sonOlay: 'bounce' });
    expect(resendOlayEsle(olay('email.bounced', { bounce: { type: 'Undetermined' } }))).toMatchObject({ durum: 'BOUNCE', sonOlay: 'bounce' });
    expect(resendOlayEsle(olay('email.bounced'))).toMatchObject({ durum: 'BOUNCE', sonOlay: 'bounce' });
  });

  it('teslim olaylari durum degistirmez ama teslim kanitidir; bilinmeyen olay yok sayilir', () => {
    const d = resendOlayEsle(olay('email.delivered'))!;
    expect(d).toMatchObject({ sonOlay: 'delivered', teslim: true });
    expect(d.durum).toBeUndefined();
    expect(d.zaman.toISOString()).toBe('2026-11-04T09:00:00.000Z');
    expect(resendOlayEsle(olay('contact.created'))).toBeNull();
    expect(resendOlayEsle({ type: 'email.bounced' })).toBeNull();
    expect(resendOlayEsle(olay('email.delivered', { to: ['Ali <ali@x.com>'] }))!.alici).toBe('ali@x.com');
  });
});

describe('resendMesaj', () => {
  const kimlik: EpostaKimlik = {
    fromEmail: 'emir@ranksup.ai', fromName: 'RanksUp', replyTo: 'emir@ranksup.ai', gonderenAd: 'Emir Burgazlı',
    gonderenUnvan: 'Kurucu, RanksUp', gonderenAdres: 'Osmangazi/Bursa', mersis: '', kimlik: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.',
  };

  it('duz metin, ret linki + tek tik ret basligi, etiketler; HTML yok (takip pikseli eklenmez)', () => {
    const m = resendMesaj(
      { id: 'cm1abc', email: 'info@firma1.com.tr', firma: 'Firma1 A.Ş.', marka: null, sektor: 'ajans', varyant: 'A', web: null },
      kimlik, resendAyar(ENV), 'test', 'https://api.ranksup.ai', 'kurumsal-2026-11',
    );
    expect(m.from).toBe('"Emir · RanksUp" <emir@ranksup.ai>');
    expect(m.to).toEqual(['info@firma1.com.tr']);
    expect(m.text).toContain('Merhaba Firma1 ekibi,');
    expect(m.text).toContain('https://api.ranksup.ai/api/eposta/ret?e=info%40firma1.com.tr&t=');
    expect(m).not.toHaveProperty('html');
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m.tags).toEqual([{ name: 'kampanya', value: 'kurumsal-2026-11' }, { name: 'hedef', value: 'cm1abc' }]);
    expect(m.text).not.toMatch(/\{\{/);
    // imzadaki site baglantisi firmaya ozel tiklama baglantisi olur; metne baska baglanti eklenmez
    expect(m.text).toContain('Osmangazi/Bursa · Emirhan Burgazlı · VKN 1 · Osmangazi V.D. · https://ranksup.ai/e/cm1abc');
    expect(m.text.match(/https:\/\/ranksup\.ai\/e\//g)).toHaveLength(1);
  });

  it('etiket degeri yalniz izinli karakterler', () => {
    expect(etiketDegeri('kurumsal 2026/11·ş')).toBe('kurumsal_2026_11__');
  });
});
