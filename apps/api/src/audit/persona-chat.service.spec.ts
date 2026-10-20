import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonaChatService, normalizePersonaHistory, PERSONA_HISTORY_MAX } from './persona-chat.service.js';
import { advertisedArticleEntry, publicArticleWhere } from './ai-sitemap.service.js';

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

  it('modele normalize gecmis ve dusuk cikti tavani gider; kaynak yazinin GERCEK adresi', async () => {
    const prisma = {
      site: { findUnique: vi.fn(async () => ({ id: 's1', name: 'Örnek', url: 'https://ornek.com/', niche: 'kuafor', brain: null })) },
      article: {
        findMany: vi.fn(async () => [
          // WordPress'te yayinda: adres yayin kaydindan
          { title: 'Saç bakımı', slug: 'sac-bakimi', metaDescription: 'm', topic: 't', publishedTo: [{ targetId: 't1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com/sac-bakimi/' }] },
          // Adresi bilinmeyen yazi (yalniz Markdown ZIP): baglanti verilmez
          { title: 'Boya rehberi', slug: 'boya-rehberi', metaDescription: 'b', topic: 'b', publishedTo: [{ targetId: 'z1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/x.zip' }] },
        ]),
      },
      publishTarget: { findMany: vi.fn(async () => [{ id: 'z1', type: 'MARKDOWN_ZIP', config: {} }]) },
      $executeRawUnsafe: vi.fn(async () => 1),
      kvStore: { findUnique: vi.fn(async () => ({ value: '1' })) },
    };
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'Bkz. https://ornek.com/sac-bakimi/' }] }));
    const svc = new PersonaChatService(prisma as any, { getString: vi.fn(async () => null) } as any);
    (svc as any).anthropic = { messages: { create } };
    const r = await svc.ask('s1', [{ role: 'assistant', content: 'selam' }, { role: 'user', content: 'Saç bakımı?' }]);
    const args = (create.mock.calls[0] as any[])[0];
    expect(args.max_tokens).toBe(1024);
    expect(args.messages).toEqual([{ role: 'user', content: 'Saç bakımı?' }]);
    // Uydurma /blog/<slug>.html adresi istemde hic yok; adresi bilinmeyen yazi bagsiz
    expect(args.system).toContain('(https://ornek.com/sac-bakimi/)');
    expect(args.system).not.toContain('/blog/');
    expect(args.system).toContain('"Boya rehberi" — b (adres yok — bağlantı verme)');
    expect(r.cited).toBe(true);
    expect(r.sources).toEqual([{ url: 'https://ornek.com/sac-bakimi/', title: 'Saç bakımı' }]);
  });

  /**
   * WordPress hedef formunun varsayilani 'Taslak': bu hedefe "yayinlanan" yazi WordPress'te
   * taslak durur, kayitli duz ?p=<id> adresi giris yapmamis ziyaretciye 404 verir. Sohbet
   * articlePublicUrl kullaniyordu ve bu adresi ziyaretciye baglanti olarak veriyordu. Artik
   * site haritasi ve llms-full'un ILAN ettigi adres kurali (advertisedArticleEntry) gecerli.
   */
  describe('baglanti yalniz gercek, herkese acik sayfaya (site haritasiyla ayni kural)', () => {
    const SITE_URL = 'https://ornek.com/';
    const TARGET_ROWS = [
      { id: 'wpd', type: 'WORDPRESS_REST', config: { postStatus: 'draft' } },
      { id: 'wpp', type: 'WORDPRESS_XMLRPC', config: { postStatus: 'publish' } },
    ];
    const wp = (targetId: string, externalUrl: string, extra: Record<string, unknown> = {}) => (
      [{ targetId, targetType: targetId === 'wpp' ? 'WORDPRESS_XMLRPC' : 'WORDPRESS_REST', ok: true, externalUrl, ...extra }]
    );
    const ARTICLES = [
      // Taslak modundaki hedef, hic canli gorulmemis duz baglanti: ziyaretciye 404
      { title: 'Taslak yazı', slug: 'taslak-yazi', metaDescription: 'm1', topic: 't1', publishedTo: wp('wpd', 'https://ornek.com/?p=42', { externalId: '42' }) },
      // Ayni hedefte guzel kalici baglanti: WordPress yaziyi son yazimda herkese acik bildirdi
      { title: 'Açık yazı', slug: 'acik-yazi', metaDescription: 'm2', topic: 't2', publishedTo: wp('wpd', 'https://ornek.com/acik-yazi/', { externalId: '43' }) },
      // Canlilik denetiminin bir kez canli gordugu duz baglanti
      { title: 'Görülmüş yazı', slug: 'gorulmus-yazi', metaDescription: 'm3', topic: 't3', publishedTo: wp('wpd', 'https://ornek.com/?p=44', { externalId: '44', liveSeenAt: '2026-10-19T02:20:00.000Z' }) },
      // Yayin modundaki XML-RPC hedefi, durumu bilinmeyen eski kayit (duz baglanti)
      { title: 'XML-RPC yazısı', slug: 'xmlrpc-yazisi', metaDescription: 'm4', topic: 't4', publishedTo: wp('wpp', 'https://ornek.com/?p=45', { externalId: '45' }) },
    ];
    const sor = async (replyText: string) => {
      const prisma = {
        site: { findUnique: vi.fn(async () => ({ id: 's1', name: 'Örnek', url: SITE_URL, niche: 'kuafor', brain: null })) },
        article: { findMany: vi.fn(async () => ARTICLES) },
        publishTarget: { findMany: vi.fn(async () => TARGET_ROWS) },
        $executeRawUnsafe: vi.fn(async () => 1),
        kvStore: { findUnique: vi.fn(async () => ({ value: '1' })) },
      };
      const create = vi.fn(async () => ({ content: [{ type: 'text', text: replyText }] }));
      const svc = new PersonaChatService(prisma as any, { getString: vi.fn(async () => null) } as any);
      (svc as any).anthropic = { messages: { create } };
      const r = await svc.ask('s1', [{ role: 'user', content: 'Ne önerirsin?' }]);
      return { r, system: String(((create.mock.calls[0] as any[])[0]).system) };
    };

    it('hic canli gorulmemis WordPress taslak ?p= adresi verilmez; cevapta gecse de kaynak sayilmaz', async () => {
      const { r, system } = await sor('Bkz. https://ornek.com/?p=42 ve https://ornek.com/acik-yazi/');
      expect(system).toContain('"Taslak yazı" — m1 (adres yok — bağlantı verme)');
      expect(system).not.toContain('?p=42');
      expect(system).toContain('"Açık yazı" — m2 (https://ornek.com/acik-yazi/)');
      expect(r.sources).toEqual([{ url: 'https://ornek.com/acik-yazi/', title: 'Açık yazı' }]);
    });

    it('her yazinin adresi site haritasi / llms-full kuraliyla birebir ayni (advertisedArticleEntry)', async () => {
      const { system } = await sor('Merhaba');
      const site = new URL(SITE_URL);
      const targets = new Map(TARGET_ROWS.map((t) => [t.id, { type: t.type, config: t.config }]));
      for (const a of ARTICLES) {
        const want = advertisedArticleEntry(site, a.slug, a.publishedTo, targets)?.url ?? null;
        expect(system, a.title).toContain(`"${a.title}" — ${a.metaDescription} (${want ?? 'adres yok — bağlantı verme'})`);
      }
    });
  });

  /**
   * Liste kurali llms-full ile ayni (publicArticleWhere + includePublicArticle + publicArticleText).
   * NEDEN: yalniz PUBLISHED okunuyordu ve kaydin kendi basligi veriliyordu: yeniden yazimi onay
   * bekleyen ama sitede canli duran yazi sohbette yoktu; eski metni gosteren kopyaya yeni baslik
   * veriliyordu.
   */
  describe('liste ve metin llms-full ile ayni kural (adresteki sayfanin metni)', () => {
    const SITE_URL = 'https://ornek.com/';
    const live = (url: string, extra: Record<string, unknown> = {}) => [{ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: url, remoteStatus: 'publish', ...extra }];
    const snapshot = (title: string, metaDescription: string) => ({ liveSnapshot: { title, metaTitle: null, metaDescription, bodyMd: 'eski govde' } });
    const ROWS = [
      // Yeniden yazimi onay bekliyor; sitede eski metniyle canli
      { id: 'a1', title: 'Yeni başlık 1', slug: 'yazi-1', metaDescription: 'yeni özet 1', topic: 't1', status: 'READY_TO_PUBLISH', publishedTo: live('https://ornek.com/yazi-1/') },
      // Onay bekliyor ama sitede canli adresi yok: listelenmez
      { id: 'a2', title: 'Yeni başlık 2', slug: 'yazi-2', metaDescription: 'yeni özet 2', topic: 't2', status: 'REVIZE_NEEDED', publishedTo: [] },
      // Yayinda; adresteki kopya elle guncelleme bekliyor (eski metin)
      { id: 'a3', title: 'Yeni başlık 3', slug: 'yazi-3', metaDescription: 'yeni özet 3', topic: 't3', status: 'PUBLISHED', publishedTo: live('https://ornek.com/yazi-3/', { manualUpdatePending: true }) },
      // Yayinda, guncel
      { id: 'a4', title: 'Başlık 4', slug: 'yazi-4', metaDescription: 'özet 4', topic: 't4', status: 'PUBLISHED', publishedTo: live('https://ornek.com/yazi-4/') },
    ];
    const OLDER: Record<string, unknown> = {
      a1: { id: 'a1', metaTitle: null, bodyMd: 'yeni govde', agentOutputs: snapshot('Eski başlık 1', 'eski özet 1') },
      a3: { id: 'a3', metaTitle: null, bodyMd: 'yeni govde', agentOutputs: snapshot('Eski başlık 3', 'eski özet 3') },
    };
    const sor = async (replyText: string) => {
      const findMany = vi.fn(async (args: any) => (args?.where?.id?.in ? args.where.id.in.map((id: string) => OLDER[id]).filter(Boolean) : ROWS));
      const prisma = {
        site: { findUnique: vi.fn(async () => ({ id: 's1', name: 'Örnek', url: SITE_URL, niche: 'kuafor', brain: null })) },
        article: { findMany },
        publishTarget: { findMany: vi.fn(async () => [{ id: 'wp', type: 'WORDPRESS_REST', config: {} }]) },
        $executeRawUnsafe: vi.fn(async () => 1),
        kvStore: { findUnique: vi.fn(async () => ({ value: '1' })) },
      };
      const create = vi.fn(async () => ({ content: [{ type: 'text', text: replyText }] }));
      const svc = new PersonaChatService(prisma as any, { getString: vi.fn(async () => null) } as any);
      (svc as any).anthropic = { messages: { create } };
      const r = await svc.ask('s1', [{ role: 'user', content: 'Ne önerirsin?' }]);
      return { r, findMany, system: String(((create.mock.calls[0] as any[])[0]).system) };
    };

    it('yazilar site haritasi / llms-full secimiyle okunur (publicArticleWhere)', async () => {
      const { findMany } = await sor('Merhaba');
      expect((findMany.mock.calls[0] as any[])[0].where).toEqual(publicArticleWhere('s1'));
    });

    it('onay bekleyen canli yazi adresteki ESKI metniyle listelenir; adresi olmayan listelenmez', async () => {
      const { system } = await sor('Merhaba');
      expect(system).toContain('"Eski başlık 1" — eski özet 1 (https://ornek.com/yazi-1/)');
      expect(system).not.toContain('Yeni başlık 1');
      expect(system).not.toContain('Yeni başlık 2');
    });

    it('eski metni gosteren kopyaya yeni baslik verilmez; kaynak basligi da adresteki baslik', async () => {
      const { r, system } = await sor('Bkz. https://ornek.com/yazi-3/');
      expect(system).toContain('"Eski başlık 3" — eski özet 3 (https://ornek.com/yazi-3/)');
      expect(system).not.toContain('Yeni başlık 3');
      expect(system).toContain('"Başlık 4" — özet 4 (https://ornek.com/yazi-4/)');
      expect(r.sources).toEqual([{ url: 'https://ornek.com/yazi-3/', title: 'Eski başlık 3' }]);
    });
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
