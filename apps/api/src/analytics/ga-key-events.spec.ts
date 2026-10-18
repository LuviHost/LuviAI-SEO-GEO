import { describe, it, expect } from 'vitest';
import { buildConversionChecks, classifyEventName, eventTokens } from './ga-key-events.js';

describe('classifyEventName — telefon / form-randevu', () => {
  it('telefon tiklamasina benzeyen adlar', () => {
    for (const n of ['phone_click', 'tel_click', 'click_to_call', 'PhoneCall', 'telefon_tiklama', 'hemen_ara', 'call_button', 'clicktocall', 'arama_butonu', 'çağrı_tıklama']) {
      expect(classifyEventName(n), n).toBe('phone');
    }
  });

  it('form / randevu gonderimine benzeyen adlar', () => {
    for (const n of ['generate_lead', 'form_submit', 'contact_form_submit', 'randevu_olustur', 'booking_complete', 'book_now', 'rezervasyon', 'iletisim_formu', 'teklif_talebi', 'appointment_booked']) {
      expect(classifyEventName(n), n).toBe('form');
    }
  });

  it('otomatik/genel olaylar, site aramasi, baslatma ve diger kanallar sayilmaz', () => {
    for (const n of ['page_view', 'click', 'scroll', 'session_start', 'form_start', 'contact_page_view', 'view_search_results',
      'site_arama', 'arama_sonuclari', 'whatsapp_click', 'mailto_click', 'telegram_click', 'sign_up', 'purchase', 'file_download', 'first_visit']) {
      expect(classifyEventName(n), n).toBeNull();
    }
  });

  it('kelimelere bolme: alt cizgi, camelCase, Turkce harf', () => {
    expect(eventTokens('clickToCall_Now')).toEqual(['click', 'to', 'call', 'now']);
    expect(eventTokens('Randevu_Oluştur')).toEqual(['randevu', 'olustur']);
  });
});

describe('buildConversionChecks', () => {
  it('tamam: eslesen onemli etkinlik donemde tetiklendi', () => {
    const [phone, form] = buildConversionChecks({
      rows: [
        { eventName: 'page_view', eventCount: 900, keyEvents: 0 },
        { eventName: 'phone_click', eventCount: 42, keyEvents: 42 },
        { eventName: 'generate_lead', eventCount: 7, keyEvents: 7 },
      ],
      configuredKeyEvents: ['phone_click', 'generate_lead', 'purchase'],
    });
    expect(phone).toEqual({ kind: 'phone', status: 'tamam', keyEvents: [{ name: 'phone_click', count: 42 }], candidates: [] });
    expect(form).toMatchObject({ kind: 'form', status: 'tamam', keyEvents: [{ name: 'generate_lead', count: 7 }] });
  });

  it('tetiklenmedi: onemli etkinlik tanimli ama donemde hic gelmedi (yalniz Admin API gorur)', () => {
    const [phone] = buildConversionChecks({ rows: [{ eventName: 'page_view', eventCount: 10, keyEvents: 0 }], configuredKeyEvents: ['tel_click'] });
    expect(phone).toEqual({ kind: 'phone', status: 'tetiklenmedi', keyEvents: [{ name: 'tel_click', count: 0 }], candidates: [] });
  });

  it('anahtar_degil: benzer olay geliyor ama onemli etkinlik degil (form_submit otomatik toplanmis)', () => {
    const [phone, form] = buildConversionChecks({
      rows: [{ eventName: 'form_submit', eventCount: 15, keyEvents: 0 }, { eventName: 'form_start', eventCount: 40, keyEvents: 0 }],
      configuredKeyEvents: [],
    });
    expect(phone.status).toBe('yok');
    expect(form).toEqual({ kind: 'form', status: 'anahtar_degil', keyEvents: [], candidates: [{ name: 'form_submit', count: 15 }] });
  });

  it('Admin API okunamadiysa (null) rapordaki keyEvents > 0 onemli sayilir', () => {
    const [, form] = buildConversionChecks({
      rows: [{ eventName: 'randevu_al', eventCount: 3, keyEvents: 3 }, { eventName: 'randevu_al', eventCount: 2, keyEvents: 0 }],
      configuredKeyEvents: null,
    });
    // Ayni ad iki satirda gelirse toplanir (isaretleme donem ortasinda yapilmis olabilir)
    expect(form).toEqual({ kind: 'form', status: 'tamam', keyEvents: [{ name: 'randevu_al', count: 5 }], candidates: [] });
  });

  it('yok: hic benzer olay yok', () => {
    const checks = buildConversionChecks({ rows: [], configuredKeyEvents: ['purchase'] });
    expect(checks.map((c) => c.status)).toEqual(['yok', 'yok']);
  });
});
