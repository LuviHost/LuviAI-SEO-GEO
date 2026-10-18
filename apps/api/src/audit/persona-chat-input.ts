import { BadRequestException } from '@nestjs/common';
import type { ChatMessage } from './persona-chat.service.js';

/**
 * Herkese acik persona sohbet ucunun (POST /sites/:siteId/audit/persona/chat)
 * girdi kurallari. Uc @Public: kimlik yok, gecmisi istemci kendi gonderir ve
 * her istek RanksUp'in model anahtariyla ucretli bir cagri.
 */

/** Ziyaretcinin son sorusu icin ust sinir (karakter). Sohbet kutusu tek satirlik bir input. */
export const PERSONA_CHAT_MAX_QUESTION_CHARS = 1000;

/** Modele gidecek en fazla mesaj — PersonaChatService.MAX_HISTORY_MESSAGES ile ayni. */
const MAX_TURNS = 10;

/** Govdede bakilacak en fazla oge (express govde siniri ~100 KB; yine de sinirli tara). */
const MAX_SCANNED = 50;

/**
 * Govdedeki `history`yi dogrular ve modele gidecek hale getirir.
 *
 *  - Dizi olmali; her oge { role: 'user' | 'assistant', content: string }.
 *  - Bos icerikli mesaj atilir: widget hata alinca (or. 429) gecmise bos bir
 *    asistan cevabi ekliyor; Messages API'de metin blogu en az 1 karakter
 *    olmali (TextBlockParam.text minLength 1) ve ardisik ayni rol turlari
 *    zaten tek tura birlestirilir — kaynak: platform.claude.com/docs/en/api/messages
 *    (18.10.2026). Atilmasa bir kez sinira takilan ziyaretcinin sohbeti sayfa
 *    yenilenene kadar hep hata verirdi.
 *  - Son mesaj ziyaretcinin sorusu olmali ve PERSONA_CHAT_MAX_QUESTION_CHARS'i
 *    asmamali. Onceki mesajlari servis zaten 2000 karakterde keser.
 */
export function sanitizePersonaHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException('Sohbet geçmişi (history) bir dizi olmalı.');
  }
  const kept: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_SCANNED)) {
    const role = (m as { role?: unknown } | null)?.role;
    const content = (m as { content?: unknown } | null)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      throw new BadRequestException('Sohbet mesajı geçersiz: role "user" ya da "assistant", content metin olmalı.');
    }
    if (!content.trim()) continue;
    kept.push({ role, content });
  }
  const recent = kept.slice(-MAX_TURNS);
  const last = recent[recent.length - 1];
  if (!last || last.role !== 'user') {
    throw new BadRequestException('Soru boş olamaz.');
  }
  if (last.content.length > PERSONA_CHAT_MAX_QUESTION_CHARS) {
    throw new BadRequestException(`Soru en fazla ${PERSONA_CHAT_MAX_QUESTION_CHARS} karakter olabilir.`);
  }
  return recent;
}
