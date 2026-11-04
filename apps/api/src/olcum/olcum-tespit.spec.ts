import { describe, expect, it } from 'vitest';
import { ayniKokenScriptleri, donusumOlayiMi, gtmKaynagiAyikla, gtmKimlikleri, olcumBulgulari, olcumTespit } from './olcum-tespit.js';

/** gtm.js'in bicimi: kutuphane kodu + `var data = {"resource": {...}}` + kutuphane kodu (uydurma, kucultulmus) */
function gtmJs(resource: object, kutuphane = '') {
  return `(function(){var data = {"resource": ${JSON.stringify(resource)}, "runtime":[]};\n` +
    `var x="https://www.googleadservices.com/pagead/conversion/"+a; ${kutuphane} })();`;
}

const KAPSAYICI = {
  macros: [
    { function: '__e' },
    { function: '__v', vtp_name: 'ecommerce.value' },
    { function: '__u', vtp_component: 'PATH' },
  ],
  tags: [
    { function: '__googtag', vtp_tagId: 'G-ABCDEF1234', tag_id: 1 },
    { function: '__gaawe', vtp_eventName: 'generate_lead', vtp_measurementIdOverride: 'G-ABCDEF1234', tag_id: 2 },
    { function: '__awct', vtp_conversionId: '123456789', vtp_conversionLabel: 'AbC_dEf-1', vtp_conversionValue: '800', vtp_currencyCode: 'TRY', tag_id: 3 },
    { function: '__paused', vtp_originalTagType: 'html', tag_id: 4 },
    {
      function: '__cvt_X1', vtp_pixelId: '1234567890123', vtp_optInMetaCAPI: true, vtp_standardEventName: 'Purchase',
      vtp_objectPropertyList: ['list', ['map', 'name', 'value', 'value', ['macro', 1]]], tag_id: 5,
    },
    { function: '__html', vtp_html: '<script>_linkedin_partner_id="7654321";</script><script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>', tag_id: 6 },
    { function: '__cvt_X2', vtp_projectId: 'abcd1234ef', tag_id: 7 },
  ],
  predicates: [
    { function: '_eq', arg0: ['macro', 0], arg1: 'gtm.js' },
    { function: '_eq', arg0: ['macro', 0], arg1: 'form_submit' },
    { function: '_eq', arg0: ['macro', 2], arg1: '/tesekkurler' },
    { function: '_eq', arg0: ['macro', 0], arg1: 'purchase' },
  ],
  rules: [
    [['if', 0], ['add', 0, 5, 6]],
    [['if', 1], ['add', 1]],
    [['if', 2], ['add', 2]],
    [['if', 3], ['add', 4]],
  ],
};

const HTML = `<html><head>
<script src="/_next/static/chunks/main-abc.js"></script>
<script src="https://www.ornek.com.tr/assets/app.js?v=2"></script>
<script src="https://cdn.baska.com/lib.js"></script>
<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i})(window,document,'script','dataLayer','GTM-ABC1234');</script>
<script>!function(){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '1234567890123');fbq('track', 'Lead', {value: 250, currency: 'TRY'});</script>
</head></html>`;

describe('olcumTespit', () => {
  const r = olcumTespit({
    html: HTML,
    js: [`gtag("event","conversion",{send_to:"AW-123456789/XyZ_9",value:1500,currency:"TRY"});window.dataLayer.push({event:"demo_talebi",plan:"pro"});dataLayer.push({event:"gtm.dom"});oaiq("measure","registration_completed",{type:"customer_action"})`],
    gtm: { 'GTM-ABC1234': gtmJs(KAPSAYICI, 'var c="https://www.clarity.ms/tag/"+p;') },
  });
  const platform = (k: string) => r.platformlar.find((p) => p.kod === k);
  const olay = (ad: string) => r.olaylar.find((o) => o.ad === ad);

  it('platformlari kimlikleriyle bulur (sayfa, paket, kapsayici)', () => {
    expect(platform('gtm')).toMatchObject({ kimlikler: ['GTM-ABC1234'], tur: 'etiket' });
    expect(platform('ga4')?.kimlikler).toEqual(['G-ABCDEF1234']);
    expect(platform('google_ads')?.kimlikler).toEqual(['AW-123456789']);
    expect(platform('meta')).toMatchObject({ kimlikler: ['1234567890123'], kaynaklar: ['gtm', 'html'] });
    expect(platform('linkedin')?.kimlikler).toEqual(['7654321']);
    expect(platform('clarity')?.kimlikler).toEqual(['abcd1234ef']);
    expect(platform('openai_ads')).toMatchObject({ tur: 'reklam', kaynaklar: ['js'] });
  });

  it('donusum olaylarini tetikleyicisi ve degeriyle cikarir; sabit deger ile dinamik ayrilir', () => {
    expect(olay('generate_lead')).toMatchObject({ platform: 'ga4', tetikleyici: 'form_submit', kaynak: 'gtm' });
    expect(olay('AW-123456789/AbC_dEf-1')).toMatchObject({ tetikleyici: '/tesekkurler', deger: { tur: 'sabit', sayi: 800, para: 'TRY' } });
    expect(olay('Purchase')).toMatchObject({ platform: 'meta', tetikleyici: 'purchase', deger: { tur: 'dinamik' } });
    expect(olay('Lead')).toMatchObject({ platform: 'meta', deger: { tur: 'sabit', sayi: 250, para: 'TRY' }, kaynak: 'html' });
    expect(olay('AW-123456789/XyZ_9')).toMatchObject({ platform: 'google_ads', deger: { tur: 'sabit', sayi: 1500 } });
    expect(olay('demo_talebi')).toMatchObject({ platform: 'datalayer' });
    expect(olay('registration_completed')).toMatchObject({ platform: 'openai_ads' });
    expect(r.olaylar.some((o) => o.ad.startsWith('gtm.'))).toBe(false);
  });

  it('kapsayici ozeti: etiket sayisi ve duraklatilan', () => {
    expect(r.gtm).toEqual([{ kimlik: 'GTM-ABC1234', etiketSayisi: 7, duraklatilan: 1, sunucuTarafli: false }]);
    expect(r.sunucuTarafli).toBe(false);
  });

  it('GTM kutuphanesindeki Google Ads adresi tek basina Google Ads saymaz (yanlis pozitif)', () => {
    const yalin = olcumTespit({
      html: '', js: [],
      gtm: { 'GTM-YALIN12': gtmJs({ macros: [{ function: '__e' }], tags: [{ function: '__googtag', vtp_tagId: 'G-ZZZZZZ9999' }], predicates: [], rules: [] }) },
    });
    expect(yalin.platformlar.map((p) => p.kod)).toEqual(['gtm', 'ga4']);
  });

  it('cozulemeyen kapsayici: yalniz GTM kimligi, uydurma platform yok', () => {
    const bozuk = olcumTespit({ html: '', js: [], gtm: { 'GTM-BOZUK12': 'googleadservices.com/pagead/conversion "resource": {bozuk' } });
    expect(bozuk.platformlar.map((p) => p.kod)).toEqual(['gtm']);
    expect(bozuk.gtm[0]).toMatchObject({ etiketSayisi: 0 });
  });

  it('sunucu taraflı etiketleme izi', () => {
    expect(olcumTespit({ html: `<script>gtag('config','G-AAAAAA1111',{server_container_url:'https://olcum.ornek.com'})</script>`, js: [], gtm: {} }).sunucuTarafli).toBe(true);
  });
});

describe('yardimcilar', () => {
  it('gtmKaynagiAyikla: nesneden sonra gelen kodu ve dizi icindeki parantezleri asar', () => {
    expect(gtmKaynagiAyikla(gtmJs({ tags: [{ function: '__html', vtp_html: '<b>}{"x"</b>' }] }))?.tags?.[0].vtp_html).toBe('<b>}{"x"</b>');
    expect(gtmKaynagiAyikla('kod yok')).toBeNull();
  });

  it('gtmKimlikleri: tekil ve sinirli', () => {
    expect(gtmKimlikleri([HTML, HTML, `'GTM-IKINCI1' 'GTM-UCUNCU1' 'GTM-DORDUN1'`])).toEqual(['GTM-ABC1234', 'GTM-IKINCI1', 'GTM-UCUNCU1']);
  });

  it('ayniKokenScriptleri: yalniz ayni alan adi (www dahil), mutlak adres', () => {
    expect(ayniKokenScriptleri(HTML, 'https://ornek.com.tr/')).toEqual([
      'https://ornek.com.tr/_next/static/chunks/main-abc.js',
      'https://www.ornek.com.tr/assets/app.js?v=2',
    ]);
  });

  it('donusumOlayiMi: sayfa gorunumu ve GTM ic olaylari degil', () => {
    expect(['PageView', 'page_view', 'gtm.js', 'page_viewed'].map((ad) => donusumOlayiMi({ ad }))).toEqual([false, false, false, false]);
    expect(donusumOlayiMi({ ad: 'generate_lead' })).toBe(true);
  });
});

describe('olcumBulgulari', () => {
  const kodlar = (r: Parameters<typeof olcumBulgulari>[0]) => olcumBulgulari(r).map((b) => b.kod);

  it('hic analitik yoksa kritik', () => {
    expect(kodlar(olcumTespit({ html: '<html></html>', js: [], gtm: {} }))).toEqual(['analitik-yok']);
  });

  it('analitik var, donusum gorunmuyor; reklam pikseli donusumsuz', () => {
    const r = olcumTespit({ html: `<script src="https://www.googletagmanager.com/gtag/js?id=G-AAAAAA1111"></script><script>fbq('init','1234567890123');fbq('track','PageView')</script>`, js: [], gtm: {} });
    expect(kodlar(r)).toEqual(['donusum-gorunmuyor', 'reklam-donusumsuz', 'ai-kanal-grubu']);
    expect(olcumBulgulari(r).find((b) => b.kod === 'donusum-gorunmuyor')?.metin).toMatch(/Dışarıdan görünen/);
  });

  it('donusumu olculen sitede yalniz AI kanal grubu tavsiyesi', () => {
    const r = olcumTespit({ html: `<script>gtag('config','G-AAAAAA1111');gtag('event','sign_up',{method:'google'})</script>`, js: [], gtm: {} });
    expect(kodlar(r)).toEqual(['ai-kanal-grubu']);
  });
});
