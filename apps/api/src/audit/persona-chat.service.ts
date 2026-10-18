import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { modelForAudience } from '../llm/model-tier.js';
import { PERSONA_MESSAGE_MAX } from './audit.dto.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  sources: Array<{ url: string; title: string }>;
  cited: boolean;
}

/** Modele giden gecmis: son N mesaj (istemci daha fazlasini yollayabilir) */
export const PERSONA_HISTORY_MAX = 10;

/**
 * Cevap tavani. Sistem istemi "max 4-5 cumle" istiyor (~150-250 token);
 * eskiden 4000'di — herkese acik uc istek basina gereksiz yuksek bir cikti
 * maliyeti tavanina izin veriyordu. 1024 kisa cevabi kesmeden kalir.
 */
const PERSONA_MAX_TOKENS = 1024;

/**
 * Istemcinin gonderdigi gecmisi modele uygun hale getirir:
 *  - yalniz { role: user|assistant, content: string } ogeleri;
 *  - son PERSONA_HISTORY_MAX mesaj, bastaki asistan mesajlari atilir
 *    (konusma kullaniciyla baslar);
 *  - ust uste ayni roldeki mesajlar birlestirilir (basarisiz istekten sonra
 *    eski widget art arda iki kullanici mesaji yollayabilir);
 *  - SON mesaj kullanicinin olmali ve bos olamaz; PERSONA_MESSAGE_MAX'i asarsa
 *    400 (sessiz kesme yerine). Onceki mesajlar ayni tavanla kirpilir.
 */
export function normalizePersonaHistory(raw: unknown): ChatMessage[] {
  const list = Array.isArray(raw) ? raw : [];
  const valid = list.filter(
    (m): m is ChatMessage =>
      !!m && typeof m === 'object'
      && ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant')
      && typeof (m as ChatMessage).content === 'string',
  );
  const last = valid[valid.length - 1];
  if (!last || last.role !== 'user' || !last.content.trim()) {
    throw new BadRequestException('Mesaj boş olamaz.');
  }
  if (last.content.length > PERSONA_MESSAGE_MAX) {
    throw new BadRequestException(`Mesaj en fazla ${PERSONA_MESSAGE_MAX} karakter olabilir.`);
  }

  // Bos icerikli mesaj atilir: eski widget hata cevabinda gecmise bos asistan
  // mesaji ekliyordu ve Anthropic bos icerigi reddeder (sonraki tum istekler duserdi)
  const window = valid.filter((m) => m.content.trim()).slice(-PERSONA_HISTORY_MAX);
  while (window.length && window[0].role !== 'user') window.shift();

  const out: ChatMessage[] = [];
  for (const m of window) {
    const content = m.content.slice(0, PERSONA_MESSAGE_MAX);
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

/**
 * Persona Chat Widget — site sahibinin yazar persona'sini bir chat widget'a
 * baglar. Site ziyaretcisi soru sorar, AI brain context'i + yayinlanmis
 * makaleler uzerinden cevap verir, ilgili makaleye link verir.
 *
 * Brand voice + persona = AI kim oldugumuzu degil, MARKAYI taklit eder.
 *
 * Kullanim:
 *   <script src="/api/widget.js?site=..."></script>
 *   Sag alt kose Floating Action Button + chat penceresi.
 *
 * HIZ SINIRI: uc @Public; ziyaretci IP'si + site ve site toplami kovalari
 * persona-chat-throttler.guard.ts'te.
 */
@Injectable()
export class PersonaChatService {
  private readonly log = new Logger(PersonaChatService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async ask(siteId: string, history: ChatMessage[]): Promise<ChatResponse> {
    // Girdi once: bos/uzun mesaj model ya da DB'ye hic gitmeden 400
    const messages = normalizePersonaHistory(history);

    if (!this.anthropic) {
      return { reply: 'AI cevap servisi şu anda devre dışı.', sources: [], cited: false };
    }

    // Bilinmeyen site eskiden findUniqueOrThrow ile 500 donuyordu
    const site: any = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    // Kimlik BIREBIR ayni olmali: sites harmanlamasi harf/bosluk farkini yok
    // sayar ('CMSQ...' de bu satiri bulur), hiz siniri kovalari ise kimligi
    // dize olarak sayar. Uc @Public — SiteAccessGuard'in sahiplik dali
    // calismaz; kanonik bicim denetimi orada, bu ikinci kapi (common/site-id.ts).
    if (!site || site.id !== siteId) throw new NotFoundException('Site bulunamadı.');

    // En guncel 30 makale title + slug + meta
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 30,
      select: { title: true, slug: true, metaDescription: true, topic: true } as any,
    });
    const baseUrl = site.url.replace(/\/+$/, '');

    const articleList = articles.map((a: any, i: number) =>
      `${i + 1}. "${a.title}" — ${a.metaDescription ?? a.topic} (${baseUrl}/blog/${a.slug}.html)`
    ).join('\n');

    const brand = site.name;
    const niche = site.niche ?? '';
    const brandVoice: any = site.brain?.brandVoice ?? {};
    const persona: any = (Array.isArray(site.brain?.personas) ? site.brain.personas[0] : null) ?? {};

    const system = `Sen ${brand} markasinin temsilcisisin. Adin: ${persona.name ?? brand + ' Asistan'}.
Sektor: ${niche}
Marka tonu: ${brandVoice.tone ?? 'profesyonel ama samimi'}
Uzmanlik: ${(persona.expertise ?? []).slice(0, 5).join(', ')}

KURALLAR:
- Kisa, net, samimi cevap ver (max 4-5 cumle)
- Bilmiyorsan, bilmedigini soyle
- Mumkunse asagidaki yayinlanmis makalelerden birine link ver (URL ile)
- Reklam YAPMA, gercek deger ver
- Karmasik soru ise "Bunu detayli yazimizda anlatmistik" deyip link ver

YAYINLANMIS MAKALELER:
${articleList}

Cevabin sonunda kullandigin makale URL'lerini parantez icinde belirt: (kaynak: ${baseUrl}/blog/...).`;

    try {
      // Widget ziyaretcisi anonim → 'anon' kademesi (admin panelden MODEL_ANON).
      const resp = await this.anthropic.messages.create({
        model: await modelForAudience(this.settings, 'anon'),
        max_tokens: PERSONA_MAX_TOKENS,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

      // Cevapta gecen makale URL'lerini extract et
      const cited: Array<{ url: string; title: string }> = [];
      for (const a of articles as any[]) {
        const url = `${baseUrl}/blog/${a.slug}.html`;
        if (text.includes(url) || text.includes(`/blog/${a.slug}`)) {
          cited.push({ url, title: a.title });
        }
      }

      return {
        reply: text,
        sources: cited,
        cited: cited.length > 0,
      };
    } catch (err: any) {
      this.log.warn(`Persona chat fail: ${err.message}`);
      return { reply: 'Bir hata oluştu, biraz sonra tekrar deneyin.', sources: [], cited: false };
    }
  }

  /**
   * Site sahibinin embed edecegi widget JS'i.
   *
   * GUVENLIK: model cevabi ve ziyaretci girdisi once HTML kacisindan gecer,
   * sonra yalniz http(s) adresleri baglantiya cevrilir. Eskiden metin dogrudan
   * innerHTML'e yaziliyordu: cevaba (ya da ziyaretcinin yazdigina) giren
   * <img onerror=...> gibi bir etiket musteri sitesinde calisirdi.
   * Gecmis istemcide tutulur; sunucuya yalniz son PERSONA_HISTORY_MAX mesaj
   * gider, giris kutusu PERSONA_MESSAGE_MAX karakterle sinirli. Hata (or. 429
   * hiz siniri) sunucunun Turkce mesajiyla gosterilir.
   */
  buildWidgetJs(siteId: string): string {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai';
    return `
(function(){
  if (window.__luviai_widget_loaded) return;
  window.__luviai_widget_loaded = true;

  var SITE_ID = ${JSON.stringify(siteId)};
  var API = ${JSON.stringify(apiBase)};
  var MAX_LEN = ${PERSONA_MESSAGE_MAX};
  var MAX_HISTORY = ${PERSONA_HISTORY_MAX};
  var history = [];

  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Sohbeti aç');
  btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;display:flex;align-items:center;justify-content:center;border:none;box-shadow:0 4px 16px rgba(108,92,231,.4);cursor:pointer;z-index:99999;transition:transform .2s';
  btn.onmouseover = function(){ this.style.transform='scale(1.08)'; };
  btn.onmouseout = function(){ this.style.transform='scale(1)'; };

  var box = document.createElement('div');
  box.style.cssText = 'display:none;position:fixed;bottom:96px;right:24px;width:360px;max-width:90vw;height:520px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.2);z-index:99998;flex-direction:column;font-family:-apple-system,sans-serif';

  var header = document.createElement('div');
  header.style.cssText = 'background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;padding:16px;border-radius:16px 16px 0 0;font-weight:600';
  header.innerText = 'AI Asistan';

  var msgs = document.createElement('div');
  msgs.style.cssText = 'flex:1;overflow-y:auto;padding:16px;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:8px';
  msgs.innerHTML = '<div style="background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%">Merhaba! Size nasıl yardımcı olabilirim?</div>';

  var inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb';
  var input = document.createElement('input');
  input.placeholder = 'Sorunuzu yazın...';
  input.maxLength = MAX_LEN;
  input.style.cssText = 'flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:14px';
  var send = document.createElement('button');
  send.type = 'button';
  send.innerText = 'Gönder';
  send.style.cssText = 'background:#6c5ce7;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer';

  function linkify(u, role){
    var t = u.replace(/[.,;:!?]+$/, '');
    return '<a href="' + t + '" target="_blank" rel="noopener nofollow" style="color:' + (role === 'user' ? '#fff' : '#6c5ce7') + ';text-decoration:underline">' + t + '</a>' + u.slice(t.length);
  }

  function append(role, text){
    var bubble = document.createElement('div');
    bubble.style.cssText = role === 'user'
      ? 'background:#6c5ce7;color:#fff;padding:10px 14px;border-radius:12px;align-self:flex-end;max-width:80%'
      : 'background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%';
    bubble.innerHTML = esc(text)
      .replace(/\\n/g, '<br>')
      .replace(/https?:\\/\\/[^\\s<()]+/g, function(u){ return linkify(u, role); });
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function ask(){
    var q = input.value.trim().slice(0, MAX_LEN);
    if (!q) return;
    append('user', q);
    history.push({role:'user',content:q});
    input.value = '';
    var loadBubble = document.createElement('div');
    loadBubble.style.cssText = 'background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%;font-style:italic;color:#999';
    loadBubble.innerText = 'yazılıyor...';
    msgs.appendChild(loadBubble);
    msgs.scrollTop = msgs.scrollHeight;
    function removeLoader(){ if (loadBubble.parentNode) loadBubble.parentNode.removeChild(loadBubble); }

    fetch(API + '/api/sites/' + encodeURIComponent(SITE_ID) + '/audit/persona/chat', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({history: history.slice(-MAX_HISTORY)})
    })
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(data){ return {ok: r.ok, data: data || {}}; });
    })
    .then(function(res){
      removeLoader();
      if (!res.ok) {
        // Cevapsiz kalan soru gecmisten cikar; sunucu mesaji (or. hiz siniri) gosterilir
        history.pop();
        var m = Array.isArray(res.data.message) ? res.data.message[0] : res.data.message;
        append('assistant', typeof m === 'string' && m ? m : 'Şu anda cevap verilemiyor, biraz sonra tekrar deneyin.');
        return;
      }
      var reply = typeof res.data.reply === 'string' && res.data.reply ? res.data.reply : 'Cevap alınamadı.';
      append('assistant', reply);
      history.push({role:'assistant',content:reply.slice(0, MAX_LEN)});
    })
    .catch(function(){
      removeLoader();
      history.pop();
      append('assistant', 'Hata oluştu, biraz sonra tekrar deneyin.');
    });
  }

  input.addEventListener('keypress', function(e){ if (e.key === 'Enter') ask(); });
  send.addEventListener('click', ask);

  inputWrap.appendChild(input);
  inputWrap.appendChild(send);
  box.appendChild(header);
  box.appendChild(msgs);
  box.appendChild(inputWrap);

  btn.onclick = function(){
    var open = box.style.display === 'flex';
    box.style.display = open ? 'none' : 'flex';
  };

  document.body.appendChild(btn);
  document.body.appendChild(box);
})();
    `;
  }
}
