import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  sources: Array<{ url: string; title: string }>;
  cited: boolean;
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
 */
@Injectable()
export class PersonaChatService {
  private readonly log = new Logger(PersonaChatService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async ask(siteId: string, history: ChatMessage[]): Promise<ChatResponse> {
    if (!this.anthropic) {
      return { reply: 'AI cevap servisi devre disi.', sources: [], cited: false };
    }

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

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
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
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
      return { reply: 'Bir hata olustu, biraz sonra tekrar deneyin.', sources: [], cited: false };
    }
  }

  /**
   * Site sahibinin embed edecegi widget JS'i.
   */
  buildWidgetJs(siteId: string): string {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'https://ai.luvihost.com';
    return `
(function(){
  if (window.__luviai_widget_loaded) return;
  window.__luviai_widget_loaded = true;

  var SITE_ID = ${JSON.stringify(siteId)};
  var API = ${JSON.stringify(apiBase)};
  var history = [];

  var btn = document.createElement('button');
  btn.innerHTML = '💬';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;font-size:28px;border:none;box-shadow:0 4px 16px rgba(108,92,231,.4);cursor:pointer;z-index:99999;transition:transform .2s';
  btn.onmouseover = function(){ this.style.transform='scale(1.08)'; };
  btn.onmouseout = function(){ this.style.transform='scale(1)'; };

  var box = document.createElement('div');
  box.style.cssText = 'display:none;position:fixed;bottom:96px;right:24px;width:360px;max-width:90vw;height:520px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.2);z-index:99998;flex-direction:column;font-family:-apple-system,sans-serif';

  var header = document.createElement('div');
  header.style.cssText = 'background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;padding:16px;border-radius:16px 16px 0 0;font-weight:600';
  header.innerText = 'AI Asistan';

  var msgs = document.createElement('div');
  msgs.style.cssText = 'flex:1;overflow-y:auto;padding:16px;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:8px';
  msgs.innerHTML = '<div style="background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%">Merhaba! Size nasil yardimci olabilirim?</div>';

  var inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb';
  var input = document.createElement('input');
  input.placeholder = 'Sorunuzu yazin...';
  input.style.cssText = 'flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:14px';
  var send = document.createElement('button');
  send.innerText = 'Gonder';
  send.style.cssText = 'background:#6c5ce7;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer';

  function append(role, text){
    var bubble = document.createElement('div');
    bubble.style.cssText = role === 'user'
      ? 'background:#6c5ce7;color:#fff;padding:10px 14px;border-radius:12px;align-self:flex-end;max-width:80%'
      : 'background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%';
    bubble.innerHTML = text.replace(/\\n/g, '<br>').replace(/(https?:\\/\\/\\S+)/g, '<a href="$1" target="_blank" style="color:'+(role==='user'?'#fff':'#6c5ce7')+';text-decoration:underline">$1</a>');
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function ask(){
    var q = input.value.trim();
    if (!q) return;
    append('user', q);
    history.push({role:'user',content:q});
    input.value = '';
    var loadBubble = document.createElement('div');
    loadBubble.style.cssText = 'background:#f3f4f6;padding:10px 14px;border-radius:12px;align-self:flex-start;max-width:80%;font-style:italic;color:#999';
    loadBubble.innerText = 'yaziliyor...';
    msgs.appendChild(loadBubble);
    msgs.scrollTop = msgs.scrollHeight;

    fetch(API + '/api/sites/' + SITE_ID + '/audit/persona/chat', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({history: history})
    })
    .then(function(r){return r.json();})
    .then(function(data){
      msgs.removeChild(loadBubble);
      append('assistant', data.reply || 'Cevap alinmadi.');
      history.push({role:'assistant',content:data.reply || ''});
    })
    .catch(function(err){
      msgs.removeChild(loadBubble);
      append('assistant', 'Hata olustu, biraz sonra tekrar deneyin.');
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
