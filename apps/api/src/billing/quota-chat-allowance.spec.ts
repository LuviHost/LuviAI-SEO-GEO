import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { CHAT_BUSY_CODE, CHAT_MESSAGE_LIMIT_CODE, QuotaService } from './quota.service.js';
import { BASE_PLANS, findPlan } from './plans.js';

/**
 * Panel sohbeti (Asistan) mesaj hakki — sahip karari 11.11.2026 ("zarar etmeyelim").
 *
 * NEDEN VAR: sohbette mesaj siniri yoktu; her mesaj 7 tura kadar Sonnet cagrisi
 * (yaklasik $0.05-0.25). Kural: hesap basina takvim ayinda deneme 20 (TOPLAM), Baslangic 100,
 * Profesyonel 500, Ajans 1.500, Kurumsal 5.000 mesaj; ADMIN muaf. Sayi plans.ts'te
 * (chatMessagesPerMonth), sayac kv_store'da (sema degismedi).
 * Bu dosya iki yonu de sabitler: sinir dolunca engeller, dolmadan engellemez.
 */

vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

/** kv_store'un bellek ici karsiligi: create tekil anahtar (P2002), updateMany kosullu (karsilastir-ve-yaz) */
function kvDb(initial: Record<string, string> = {}) {
  const rows = new Map<string, { value: string; expiresAt: Date | null }>(
    Object.entries(initial).map(([k, v]) => [k, { value: v, expiresAt: null }]),
  );
  const kvStore = {
    findUnique: vi.fn(async ({ where }: any) => {
      const r = rows.get(where.key);
      return r ? { value: r.value } : null;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      rows.set(data.key, { value: data.value, expiresAt: data.expiresAt ?? null });
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const r = rows.get(where.key);
      if (!r || r.value !== where.value) return { count: 0 };
      r.value = data.value;
      return { count: 1 };
    }),
  };
  return { rows, kvStore };
}

const NOV = new Date(2026, 10, 11, 12, 0, 0);
const DEC = new Date(2026, 11, 1, 0, 5, 0);
const monthKey = (userId: string, d: Date) => `sohbet-mesaj:${userId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function build(initial: Record<string, string> = {}, user: Record<string, unknown> = { plan: 'PRO', role: 'USER' }) {
  const db = kvDb(initial);
  const prisma: any = { kvStore: db.kvStore, user: { findUniqueOrThrow: vi.fn(async () => ({ id: 'u1', ...user })) } };
  return { quota: new QuotaService(prisma), rows: db.rows, kvStore: db.kvStore };
}

async function rejection(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error('hata bekleniyordu');
}

describe('sohbet mesaj hakki — sayi plans.ts tek kaynak', () => {
  it('sahibin onayladigi sayilar: deneme 20, Baslangic 100, Profesyonel 500, Ajans 1.500, Kurumsal 5.000', () => {
    expect(Object.fromEntries(BASE_PLANS.map((p) => [p.id, p.chatMessagesPerMonth]))).toEqual({
      trial: 20, starter: 100, pro: 500, agency: 1_500, enterprise: 5_000,
    });
  });

  it('QuotaService hakki plans.ts\'ten okur; bilinmeyen plan 0', () => {
    const { quota } = build();
    for (const p of BASE_PLANS) expect(quota.chatMessageLimitFor(p.id.toUpperCase()), p.id).toBe(p.chatMessagesPerMonth);
    expect(quota.chatMessageLimitFor('BILINMEYEN')).toBe(0);
  });

  it('merdiven geriye gitmez: ust planin hakki alt plandan az degil', () => {
    const sayilar = BASE_PLANS.map((p) => p.chatMessagesPerMonth);
    expect([...sayilar].sort((a, b) => a - b)).toEqual(sayilar);
  });
});

describe('consumeChatMessageSlot — engellemesi gerekeni engeller, izin verileni engellemez', () => {
  it('hak dolmadan: gecer ve sayac TAM bir artar; ilk mesaj satiri olusturur', async () => {
    const { quota, rows } = build();
    const slot = await quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV);
    expect(slot).toEqual({ charged: true, key: monthKey('u1', NOV) });
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('1');
    await quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('2');
  });

  it('son hak kullanilabilir (499 → 500), sonraki mesaj 403 CHAT_MESSAGE_LIMIT ve sayac artmaz', async () => {
    const { quota, rows } = build({ [monthKey('u1', NOV)]: '499' });
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV)).resolves.toMatchObject({ charged: true });
    const err = await rejection(() => quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect((err.getResponse() as any).code).toBe(CHAT_MESSAGE_LIMIT_CODE);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('500');
  });

  it('her planda sinir plans.ts\'teki sayida keser', async () => {
    for (const p of BASE_PLANS) {
      const plan = p.id.toUpperCase();
      const key = plan === 'TRIAL' ? 'sohbet-mesaj:u1:deneme' : monthKey('u1', NOV);
      const dolu = build({ [key]: String(p.chatMessagesPerMonth) });
      await expect(dolu.quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan }, NOV), plan).rejects.toBeInstanceOf(ForbiddenException);
      const birEksik = build({ [key]: String(p.chatMessagesPerMonth - 1) });
      await expect(birEksik.quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan }, NOV), plan).resolves.toMatchObject({ charged: true });
    }
  });

  it('ADMIN muaf: hak doluyken de gecer, sayac HIC yazilmaz', async () => {
    const { quota, rows, kvStore } = build({ [monthKey('u1', NOV)]: '500' });
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'ADMIN', plan: 'PRO' }, NOV)).resolves.toEqual({ charged: false, key: null });
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('500');
    expect(kvStore.findUnique).not.toHaveBeenCalled();
  });

  it('hesap basina: baska hesabin sayaci etkilemez', async () => {
    const { quota } = build({ [monthKey('u2', NOV)]: '500' });
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV)).resolves.toMatchObject({ charged: true });
  });
});

describe('ay donumu — diger aylik sayaclarla ayni sinir (sunucu saati, yil + ay)', () => {
  it('ucretli plan: yeni takvim ayinda sayac sifirdan baslar', async () => {
    const { quota, rows } = build({ [monthKey('u1', NOV)]: '100' });
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'STARTER' }, NOV)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'STARTER' }, DEC)).resolves.toEqual({ charged: true, key: monthKey('u1', DEC) });
    expect(rows.get(monthKey('u1', DEC))?.value).toBe('1');
    // Eski ayin satiri bir daha okunmaz; suresi ertesi ayin sonunda dolar (KvSweepCron siler)
    expect(rows.get(monthKey('u1', DEC))?.expiresAt).toEqual(new Date(2027, 1, 1));
  });

  it('deneme: hak TOPLAM — ay donse de sifirlanmaz (denemenin makale ve calistirma haklari gibi)', async () => {
    const { quota, rows } = build({ 'sohbet-mesaj:u1:deneme': '20' });
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'TRIAL' }, NOV)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'TRIAL' }, DEC)).rejects.toBeInstanceOf(ForbiddenException);
    expect([...rows.keys()]).toEqual(['sohbet-mesaj:u1:deneme']);
  });

  it('deneme sayaci suresiz yazilir (aylik anahtar degil)', async () => {
    const { quota, rows } = build();
    await quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'TRIAL' }, NOV);
    expect(rows.get('sohbet-mesaj:u1:deneme')).toEqual({ value: '1', expiresAt: null });
  });
});

describe('eszamanlilik — son hak iki kez alinamaz', () => {
  it('ayni anda gelen iki mesajdan yalniz biri son hakki alir; sayac hakki ASMAZ', async () => {
    const { quota, rows } = build({ [monthKey('u1', NOV)]: '99' });
    const user = { id: 'u1', role: 'USER', plan: 'STARTER' };
    const sonuc = await Promise.allSettled([quota.consumeChatMessageSlot(user, NOV), quota.consumeChatMessageSlot(user, NOV)]);
    expect(sonuc.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const red = sonuc.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((red.reason.getResponse() as any).code).toBe(CHAT_MESSAGE_LIMIT_CODE);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('100');
  });

  it('ayni anda gelen on mesaj (hak bol): hepsi gecer ya da 429 alir, sayac tam gecen kadar artar', async () => {
    const { quota, rows } = build({ [monthKey('u1', NOV)]: '10' });
    const user = { id: 'u1', role: 'USER', plan: 'PRO' };
    const sonuc = await Promise.allSettled(Array.from({ length: 10 }, () => quota.consumeChatMessageSlot(user, NOV)));
    const gecen = sonuc.filter((r) => r.status === 'fulfilled').length;
    expect(gecen).toBeGreaterThanOrEqual(1);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe(String(10 + gecen));
    for (const r of sonuc) {
      if (r.status === 'rejected') expect((r.reason.getResponse() as any).code).toBe(CHAT_BUSY_CODE);
    }
  });

  it('ilk mesaj yarisi: satiri iki istek birden olusturmaya calisirsa ikincisi kosullu artisa doner', async () => {
    const { quota, rows } = build();
    const user = { id: 'u1', role: 'USER', plan: 'PRO' };
    await Promise.all([quota.consumeChatMessageSlot(user, NOV), quota.consumeChatMessageSlot(user, NOV)]);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('2');
  });

  it('yaris cozulemezse 429 CHAT_BUSY: mesaj reddedilir, hak dusmez (sinir asilmaz)', async () => {
    const { quota, kvStore, rows } = build({ [monthKey('u1', NOV)]: '5' });
    kvStore.updateMany.mockResolvedValue({ count: 0 });
    const err = await rejection(() => quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV));
    expect(err.getStatus()).toBe(429);
    expect((err.getResponse() as any).code).toBe(CHAT_BUSY_CODE);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('5');
  });
});

describe('iade — model cagrilmadan basarisiz olan mesaj sayilmaz', () => {
  it('refundChatMessageSlot sayaci bir azaltir; 0\'in altina inmez; ucretsiz gecis (charged false) iade etmez', async () => {
    const { quota, rows } = build();
    const user = { id: 'u1', role: 'USER', plan: 'PRO' };
    const slot = await quota.consumeChatMessageSlot(user, NOV);
    await quota.refundChatMessageSlot(slot);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('0');
    await quota.refundChatMessageSlot(slot);
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('0');
    rows.set(monthKey('u1', NOV), { value: '7', expiresAt: null });
    await quota.refundChatMessageSlot({ charged: false, key: null });
    expect(rows.get(monthKey('u1', NOV))?.value).toBe('7');
  });

  it('iade hatasi yutulur (cagiranin asil hatasi kaybolmaz)', async () => {
    const { quota, kvStore } = build({ [monthKey('u1', NOV)]: '3' });
    kvStore.findUnique.mockRejectedValue(new Error('db yok'));
    await expect(quota.refundChatMessageSlot({ charged: true, key: monthKey('u1', NOV) })).resolves.toBeUndefined();
  });
});

describe('sayac okunamazsa — urun durmaz (loglanir, mesaj engellenmez)', () => {
  it('kv_store hatasi: mesaj gecer, hak dusmus sayilmaz', async () => {
    const { quota, kvStore } = build();
    kvStore.findUnique.mockRejectedValue(new Error('db yok'));
    await expect(quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan: 'PRO' }, NOV)).resolves.toEqual({ charged: false, key: null });
  });
});

describe('musteriye giden metin — sinir, yenilenme, (varsa) yukseltme yolu', () => {
  const metin = async (plan: string, key: string) => {
    const limit = findPlan(plan.toLowerCase())!.chatMessagesPerMonth;
    const { quota } = build({ [key]: String(limit) });
    const err = await rejection(() => quota.consumeChatMessageSlot({ id: 'u1', role: 'USER', plan }, NOV));
    return err.message;
  };

  it('Baslangic: siniri, gelecek ay basinda yenilendigini ve Profesyonel\'deki hakki soyler', async () => {
    expect(await metin('STARTER', monthKey('u1', NOV))).toBe(
      'Bu ayki 100 Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir; Profesyonel planında ayda 500 mesaj gönderebilirsin.',
    );
  });

  it('Profesyonel: yukseltme VAAT ETMEZ (Kurumsal teklifle), yalniz yenilenmeyi soyler', async () => {
    const m = await metin('PRO', monthKey('u1', NOV));
    expect(m).toBe('Bu ayki 500 Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir.');
    expect(m).not.toMatch(/yükselt|Kurumsal|plan[ıi]na geç/i);
  });

  it('Ajans ve Kurumsal: binlik ayirici Turkce, yukseltme vaadi yok', async () => {
    expect(await metin('AGENCY', monthKey('u1', NOV))).toBe('Bu ayki 1.500 Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir.');
    expect(await metin('ENTERPRISE', monthKey('u1', NOV))).toBe('Bu ayki 5.000 Asistan mesajı hakkını kullandın. Hak gelecek ayın başında yenilenir.');
  });

  it('deneme: "yenilenir" DEMEZ (hak toplam); satin alinabilir planlarin hakkini soyler', async () => {
    const m = await metin('TRIAL', 'sohbet-mesaj:u1:deneme');
    expect(m).toBe(
      'Deneme hesabındaki 20 Asistan mesajı hakkını kullandın; deneme hakkı yenilenmez. Başlangıç planında ayda 100, Profesyonel planında ayda 500 mesaj gönderebilirsin.',
    );
    expect(m).not.toMatch(/ayın başında yenilenir/);
  });
});

describe('checkChatQuota — panelin gordugu', () => {
  it('kullanilan, hak, kalan; ADMIN sinirsiz; deneme toplam', async () => {
    const pro = build({ [monthKey('u1', NOV)]: '37' });
    expect(await pro.quota.checkChatQuota('u1', NOV)).toEqual({ used: 37, limit: 500, remaining: 463, unlimited: false, lifetime: false });
    const bos = build();
    expect(await bos.quota.checkChatQuota('u1', NOV)).toEqual({ used: 0, limit: 500, remaining: 500, unlimited: false, lifetime: false });
    const admin = build({}, { plan: 'PRO', role: 'ADMIN' });
    expect((await admin.quota.checkChatQuota('u1', NOV)).unlimited).toBe(true);
    const deneme = build({ 'sohbet-mesaj:u1:deneme': '20' }, { plan: 'TRIAL', role: 'USER' });
    expect(await deneme.quota.checkChatQuota('u1', DEC)).toEqual({ used: 20, limit: 20, remaining: 0, unlimited: false, lifetime: true });
  });
});
