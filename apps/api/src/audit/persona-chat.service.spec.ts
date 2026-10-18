import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonaChatService, normalizePersonaHistory, PERSONA_HISTORY_MAX } from './persona-chat.service.js';

/**
 * Persona sohbeti (herkese acik widget):
 *  - gecmis normalize edilir: son mesaj kullanicinin, en fazla 2000 karakter;
 *  - bilinmeyen site 404 (eskiden findUniqueOrThrow → 500);
 *  - widget model cevabini ve ziyaretci girdisini HTML olarak yorumlamaz.
 */

describe('normalizePersonaHistory', () => {
  it('son mesaj bos ya da asistanin ise 400', () => {
    expect(() => normalizePersonaHistory([])).toThrow(BadRequestException);
    expect(() => normalizePersonaHistory([{ role: 'user', content: '   ' }])).toThrow('Mesaj boş olamaz.');
    expect(() => normalizePersonaHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toThrow('Mesaj boş olamaz.');
    expect(() => normalizePersonaHistory('x')).toThrow(BadRequestException);
  });

  it('son ziyaretci mesaji 2000 karakteri asarsa 400 (sessiz kesme yok)', () => {
    expect(() => normalizePersonaHistory([{ role: 'user', content: 'x'.repeat(2001) }])).toThrow('Mesaj en fazla 2000 karakter olabilir.');
    expect(normalizePersonaHistory([{ role: 'user', content: 'x'.repeat(2000) }])).toHaveLength(1);
  });

  it('son 10 mesaj, bastaki asistan atilir, eski uzun cevap kirpilir, ayni rol birlesir', () => {
    const long = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
    const out = normalizePersonaHistory(long);
    expect(out.length).toBeLessThanOrEqual(PERSONA_HISTORY_MAX);
    expect(out[0].role).toBe('user');
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'm14' });

    const merged = normalizePersonaHistory([
      { role: 'user', content: 'ilk' },
      { role: 'assistant', content: 'y'.repeat(9000) },
      { role: 'user', content: 'ikinci' },
      { role: 'user', content: 'üçüncü' },
      { role: 'system', content: 'yok say' },
    ] as any);
    expect(merged).toHaveLength(3);
    expect(merged[1].content).toHaveLength(2000);
    expect(merged[2]).toEqual({ role: 'user', content: 'ikinci\n\nüçüncü' });
  });

  it('eski widget\'in hata sonrasi ekledigi bos asistan mesaji atilir', () => {
    const out = normalizePersonaHistory([
      { role: 'user', content: 'soru 1' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'soru 2' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'soru 1\n\nsoru 2' }]);
  });
});

describe('PersonaChatService.ask', () => {
  it('bos mesaj: DB ve model cagrisi yok', async () => {
    const prisma = { site: { findUnique: vi.fn() }, article: { findMany: vi.fn() } };
    const svc = new PersonaChatService(prisma as any, {} as any);
    await expect(svc.ask('s1', [])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('bilinmeyen site 404', async () => {
    const prisma = { site: { findUnique: vi.fn(async () => null) }, article: { findMany: vi.fn(async () => []) } };
    const svc = new PersonaChatService(prisma as any, {} as any);
    (svc as any).anthropic = { messages: { create: vi.fn() } };
    await expect(svc.ask('yok', [{ role: 'user', content: 'Merhaba' }])).rejects.toBeInstanceOf(NotFoundException);
    expect((svc as any).anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('modele normalize gecmis ve dusuk cikti tavani gider', async () => {
    const prisma = {
      site: { findUnique: vi.fn(async () => ({ id: 's1', name: 'Örnek', url: 'https://ornek.com/', niche: 'kuafor', brain: null })) },
      article: { findMany: vi.fn(async () => [{ title: 'Saç bakımı', slug: 'sac-bakimi', metaDescription: 'm', topic: 't' }]) },
    };
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'Bkz. https://ornek.com/blog/sac-bakimi.html' }] }));
    const svc = new PersonaChatService(prisma as any, { getString: vi.fn(async () => null) } as any);
    (svc as any).anthropic = { messages: { create } };
    const r = await svc.ask('s1', [{ role: 'assistant', content: 'selam' }, { role: 'user', content: 'Saç bakımı?' }]);
    const args = (create.mock.calls[0] as any[])[0];
    expect(args.max_tokens).toBe(1024);
    expect(args.messages).toEqual([{ role: 'user', content: 'Saç bakımı?' }]);
    expect(r.cited).toBe(true);
    expect(r.sources).toEqual([{ url: 'https://ornek.com/blog/sac-bakimi.html', title: 'Saç bakımı' }]);
  });
});

/* ── Widget: kucuk sahte DOM ile davranis testi ───────────────────────── */

class El {
  tag: string;
  children: El[] = [];
  parentNode: El | null = null;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: any) => void>> = {};
  innerHTML = '';
  innerText = '';
  value = '';
  placeholder = '';
  maxLength = -1;
  type = '';
  scrollTop = 0;
  scrollHeight = 0;
  onclick: null | (() => void) = null;
  onmouseover: null | (() => void) = null;
  onmouseout: null | (() => void) = null;
  constructor(tag: string) { this.tag = tag; }
  appendChild(c: El) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c: El) {
    const i = this.children.indexOf(c);
    if (i < 0) throw new Error('NotFoundError');
    this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(k: string, fn: (e: any) => void) { (this.listeners[k] ??= []).push(fn); }
}

function runWidget(js: string, fetchImpl: (url: string, init: any) => Promise<any>) {
  const created: El[] = [];
  const body = new El('body');
  const document = { body, createElement: (t: string) => { const e = new El(t); created.push(e); return e; } };
  const window: Record<string, unknown> = {};
  new Function('window', 'document', 'fetch', js)(window, document, fetchImpl);
  const input = created.find((e) => e.tag === 'input')!;
  const send = created.filter((e) => e.tag === 'button')[1];
  const box = created.find((e) => e.children.length === 3)!;
  const msgs = box.children[1];
  return { input, send, msgs, created };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('widget.js', () => {
  const svc = new PersonaChatService({} as any, {} as any);

  it('model cevabindaki HTML calismaz; yalniz http(s) adresi baglanti olur', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ reply: 'Merhaba <img src=x onerror=alert(1)> bkz. https://ornek.com/blog/a.html?x=1&y=2.' }),
    }));
    const w = runWidget(svc.buildWidgetJs('site"1'), fetchImpl);
    w.input.value = '<b>soru</b>';
    w.send.listeners.click[0]({});
    await flush();
    await flush();
    // Yukleniyor balonu kaldirildi: [ziyaretci balonu, cevap balonu]
    expect(w.msgs.children).toHaveLength(2);
    const [userBubble, replyBubble] = w.msgs.children;
    expect(userBubble.innerHTML).toBe('&lt;b&gt;soru&lt;/b&gt;');
    expect(replyBubble.innerHTML).not.toContain('<img');
    expect(replyBubble.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(replyBubble.innerHTML).toContain('<a href="https://ornek.com/blog/a.html?x=1&amp;y=2" target="_blank" rel="noopener nofollow"');
    // Sondaki nokta baglantiya dahil edilmez
    expect(replyBubble.innerHTML).toMatch(/<\/a>\.$/);
    // Site kimligi yol icin kodlanir; giris kutusu sinirli
    expect((fetchImpl.mock.calls[0] as any[])[0]).toContain('/api/sites/site%221/audit/persona/chat');
    expect(w.input.maxLength).toBe(2000);
  });

  it('sunucuya en fazla 10 mesaj gider; 429 mesaji gosterilir ve soru gecmisten cikar', async () => {
    let call = 0;
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      call++;
      if (call === 7) return { ok: false, json: async () => ({ message: 'Kısa sürede çok fazla mesaj gönderildi. Yaklaşık 3 dakika sonra tekrar deneyin.' }) };
      return { ok: true, json: async () => ({ reply: `cevap ${call}` }) };
    });
    const w = runWidget(svc.buildWidgetJs('s1'), fetchImpl);
    for (let i = 0; i < 8; i++) {
      w.input.value = `soru ${i}`;
      w.send.listeners.click[0]({});
      await flush();
      await flush();
    }
    expect(bodies.every((b) => b.history.length <= 10)).toBe(true);
    const texts = w.msgs.children.map((c) => c.innerHTML);
    expect(texts).toContain('Kısa sürede çok fazla mesaj gönderildi. Yaklaşık 3 dakika sonra tekrar deneyin.');
    // 429 alan "soru 6" sonraki istegin gecmisinde yok
    expect(bodies[7].history.map((m: any) => m.content)).not.toContain('soru 6');
    expect(bodies[7].history[bodies[7].history.length - 1]).toEqual({ role: 'user', content: 'soru 7' });
  });
});
