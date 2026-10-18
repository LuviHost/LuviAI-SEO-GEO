import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrackerController, buildTrackerJs } from './tracker.controller.js';

/**
 * tracker.js / widget.js / beacon — istekten gelen `site` degeri.
 *
 * NEDEN VAR: tracker.js, `site` sorgu degerini sunulan betigin icine ham
 * yaziyordu (`'...beacon?site=${siteId}&url='`). Tek tirnak ya da satir sonu
 * iceren bir deger JS dizesinden cikip betige kod ekleyebiliyordu. Vitest
 * dekorator metadata'si uretmedigi icin controller elle kurulur.
 */

/** Uretilen betigi tarayici yerine sahte nesnelerle calistirir; beacon adresini doner */
function runTracker(js: string, ua = 'Mozilla/5.0 (compatible; GPTBot/1.2)'): string | null {
  let src: string | null = null;
  class FakeImage {
    constructor(public w: number, public h: number) {}
    set src(v: string) { src = v; }
  }
  // Betik gercekten calistirilir: enjekte edilen kodun CALISMADIGI boyle gorulur
  new Function('navigator', 'document', 'location', 'Image', js)(
    { userAgent: ua },
    { referrer: 'https://chatgpt.com/' },
    { href: 'https://ornek.com/blog/a.html' },
    FakeImage,
  );
  return src;
}

describe('buildTrackerJs — site degeri her zaman veri', () => {
  afterEach(() => { delete (globalThis as any).__pwned; });

  it('tirnakla dizeden cikma girisimi kod olarak calismaz; deger URL-kodlu gider', () => {
    const payload = "x';globalThis.__pwned=1;'";
    const js = buildTrackerJs(payload, 'https://api.ranksup.ai');
    const src = runTracker(js);
    expect((globalThis as any).__pwned).toBeUndefined();
    expect(src).not.toBeNull();
    const u = new URL(src!);
    expect(u.origin + u.pathname).toBe('https://api.ranksup.ai/api/tracker/beacon');
    expect(u.searchParams.get('site')).toBe(payload);
    expect(u.searchParams.get('url')).toBe('https://ornek.com/blog/a.html');
    expect(u.searchParams.get('ref')).toBe('https://chatgpt.com/');
  });

  it('satir sonu, cift tirnak ve </script> betigi bozmaz', () => {
    const payload = 'a\n"b</script><script>globalThis.__pwned=1</script>';
    const js = buildTrackerJs(payload, 'https://api.ranksup.ai');
    expect(js).not.toContain('</script>');
    const src = runTracker(js);
    expect((globalThis as any).__pwned).toBeUndefined();
    expect(new URL(src!).searchParams.get('site')).toBe(payload);
  });

  it('normal site kimligi: bot ya da AI yonlendirmesi yoksa beacon atilmaz', () => {
    const js = buildTrackerJs('cmoj14abc', 'https://ranksup.ai');
    expect(js).toContain('"https://ranksup.ai/api/tracker/beacon?site=cmoj14abc"');
    const src = runTracker(js.replace("document.referrer || ''", "''"), 'Mozilla/5.0 Safari');
    expect(src).toBeNull();
  });
});

describe('TrackerController — sorgu degerleri yalniz duz metin', () => {
  function ctl() {
    const aiReferrer = { record: vi.fn(async () => undefined) };
    const personaChat = { buildWidgetJs: vi.fn((id: string) => `// widget ${id}`) };
    const c = new TrackerController(aiReferrer as any, personaChat as any, {} as any);
    const res = () => ({ send: vi.fn() });
    return { c, aiReferrer, personaChat, res };
  }

  it('tracker.js: dizi/nesne/bos deger "site param missing"; dize kodlanarak gomulur', () => {
    const { c, res } = ctl();
    for (const bad of [['a', 'b'], { x: 'y' }, '', undefined]) {
      const r = res();
      c.trackerScript(bad, r as any);
      expect(r.send).toHaveBeenCalledWith('// RanksUp tracker — site param missing');
    }
    const r = res();
    c.trackerScript("s1'", r as any);
    const js = String(r.send.mock.calls[0][0]);
    expect(js).toContain("beacon?site=s1'\"");
    expect(() => runTracker(js)).not.toThrow();
  });

  it('widget.js: dize disi deger gomulmez', () => {
    const { c, personaChat, res } = ctl();
    const r1 = res();
    c.widgetScript(['a', 'b'], r1 as any);
    expect(r1.send).toHaveBeenCalledWith('// RanksUp widget — site param missing');
    expect(personaChat.buildWidgetJs).not.toHaveBeenCalled();
    const r2 = res();
    c.widgetScript('s1', r2 as any);
    expect(personaChat.buildWidgetJs).toHaveBeenCalledWith('s1');
  });

  it('beacon: dize disi site/ref kaydedilmez; GIF her durumda doner', async () => {
    const { c, aiReferrer, res } = ctl();
    const r1 = res();
    await c.beacon(['s1', 's2'], 'https://ornek.com/', 'https://chatgpt.com/', r1 as any);
    expect(aiReferrer.record).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(r1.send.mock.calls[0][0])).toBe(true);
    const r2 = res();
    await c.beacon('s1', { u: 1 }, 'https://chatgpt.com/', r2 as any);
    expect(aiReferrer.record).toHaveBeenCalledWith('s1', 'https://chatgpt.com/', '');
  });
});
