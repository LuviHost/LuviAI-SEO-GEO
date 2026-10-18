/**
 * Tarama gecmisi rozetleri: yontem / kapsam degisen ardisik taramalarda yesil-kirmizi
 * hukum yok; "ilk tarama" yalniz gercekten ilkse; otomatik tarama rozetle ayrilir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  FIRST_AUDIT_LABEL, HISTORY_API_MAX, NOT_COMPARABLE_LABEL, PREVIOUS_NOT_LISTED_LABEL, auditTriggerBadge, historyDeltaView,
} from './audit-history';

const satir = (overallScore: number, scoreComparableWithPrevious?: boolean | null, scoreMethodNote?: string | null) =>
  ({ overallScore, scoreComparableWithPrevious, scoreMethodNote });

describe('historyDeltaView', () => {
  it('yontem / kapsam degistiyse hukum yok: notr, API nedeni gosterilir', () => {
    const not = 'Görsel alt metni kontrolünün ölçüm yöntemi değişti; skor farkı karşılaştırılamaz.';
    const rows = [satir(86, false, not), satir(64, null)];
    expect(historyDeltaView(rows, 0, 20)).toEqual({ kind: 'not_comparable', delta: 22, note: not });
  });

  it('etiket kapsam farkinda da dogru: yalniz "yontem degisti" demez', () => {
    // API false'u kontrol iki taramadan yalniz birinde olculebildiginde de doner (kapsamiFarkli)
    expect(NOT_COMPARABLE_LABEL).toBe('yöntem/kapsam değişti');
  });

  it('not gelmezse genel aciklama; dusus de kotulesti sayilmaz', () => {
    const v = historyDeltaView([satir(50, false, '  '), satir(70, true)], 0, 20);
    expect(v.kind).toBe('not_comparable');
    expect(v).toMatchObject({ delta: -20 });
    expect((v as { note: string }).note).toMatch(/iyileşme veya kötüleşme sayılmaz/);
  });

  it('ayni yontem: fark hukum olarak okunur', () => {
    expect(historyDeltaView([satir(80, true), satir(75, null)], 0, 20)).toEqual({ kind: 'comparable', delta: 5 });
    expect(historyDeltaView([satir(70, true), satir(75, null)], 0, 20)).toEqual({ kind: 'comparable', delta: -5 });
  });

  it('API alani gondermediyse (eski API) sayi notr, hukum yok', () => {
    expect(historyDeltaView([satir(80), satir(75)], 0, 20)).toEqual({ kind: 'unknown', delta: 5 });
  });

  it('"ilk tarama" yalniz liste sinira dayanmadiysa; dayandiysa iddia yok', () => {
    const iki = [satir(80, true), satir(75, null)];
    expect(historyDeltaView(iki, 1, 20)).toEqual({ kind: 'first' });
    const dolu = Array.from({ length: 20 }, (_, k) => satir(60 + k, k === 19 ? null : true));
    expect(historyDeltaView(dolu, 19, 20)).toEqual({ kind: 'none' });
  });

  it('K13: API ust siniri (100) istenenden kucukse liste "kesilmemis" sayilmaz — en eski satir ilk tarama degil', () => {
    // 200 istendi, API en fazla 100 doner (audit.service getHistory guvenliLimit): 100 satir
    // geldiyse daha eski tarama olabilir; eski kural (rows < limit) burada "ilk tarama" diyordu
    const yuz = Array.from({ length: HISTORY_API_MAX }, (_, k) => satir(50, k === HISTORY_API_MAX - 1 ? null : true));
    expect(historyDeltaView(yuz, HISTORY_API_MAX - 1, 200)).toEqual({ kind: 'none' });
    expect(historyDeltaView(yuz.slice(0, 99), 98, 200)).toEqual({ kind: 'first' });
  });

  it('K13: etiketler — onceki satiri listede olmayan en eski satir notr metinle', () => {
    expect(FIRST_AUDIT_LABEL).toBe('ilk tarama');
    expect(PREVIOUS_NOT_LISTED_LABEL).toBe('önceki tarama listede yok');
  });
});

describe('auditTriggerBadge', () => {
  it('otomatik ve dogrulama taramalari rozetle ayrilir; kullanici taramasi rozetsiz', () => {
    expect(auditTriggerBadge('system')?.label).toBe('Otomatik');
    expect(auditTriggerBadge('system')?.title).toContain('Kullanıcı Taraması');
    expect(auditTriggerBadge('test')?.label).toBe('Doğrulama');
    expect(auditTriggerBadge('user')).toBeNull();
    expect(auditTriggerBadge(undefined)).toBeNull();
    expect(auditTriggerBadge('bilinmeyen')).toBeNull();
  });
});
