import type { autoFixMessages } from './api';
import type { NoticeSpec } from './notice';

/**
 * Kok dosya otomatik duzeltmesinin bildirimleri — saf, test edilir
 * (auto-fix-notices.spec.mts). Site Skoru adimi (site-flow-stepper.tsx) kullanir.
 *
 * NEDEN: adim, sonucu `msg.applied` ile "N duzeltme uygulandi" diye basari olarak
 * gosteriyordu. applied YUKLENEN her dosyayi sayar; API yazimdan sonra canli adresi
 * yeniden okur ve birebir goremedigi dosyayi files[].verified=false + unverified[]
 * nedeniyle doner (auto-fix.service runAutoFix). Sitede dogrulanamayan yazim duz
 * basari sayilmaz: basari yalniz verified, digerleri API'nin Turkce nedeniyle uyari.
 * Genel Bakis (site-overview-dashboard.tsx) ve sablon gruplari (audit-issue-groups.tsx)
 * ayni kurali uygular; onizleme diyalogu files[0].verified ile.
 */
export type AutoFixMessages = ReturnType<typeof autoFixMessages>;

export function autoFixNotices(msg: AutoFixMessages, fixLabel: (fix: string) => string = (f) => f): NoticeSpec[] {
  const notices: NoticeSpec[] = [];
  const names = (fixes: string[]) => fixes.map(fixLabel).join(', ');
  if (msg.verified.length > 0) {
    notices.push({ tone: 'success', title: `${msg.verified.length} düzeltme uygulandı ve sitede doğrulandı: ${names(msg.verified)}` });
  }
  if (msg.unverifiedFixes.length > 0) {
    notices.push({
      tone: 'warning',
      title: `${names(msg.unverifiedFixes)} yazıldı ama sitede doğrulanamadı`,
      description: msg.unverified.join(' · ') || undefined,
    });
  }
  // Hata metni API'den — eskiden yalniz "N duzeltme basarisiz" yaziyordu, neden gorunmuyordu
  if (msg.errors.length > 0) {
    notices.push({
      tone: 'error',
      title: msg.errors.length === 1 ? 'Düzeltme uygulanmadı' : `${msg.errors.length} düzeltme uygulanmadı`,
      description: msg.errors.join(' · '),
    });
  }
  if (msg.unchanged.length > 0) notices.push({ tone: 'info', title: 'Değişiklik gerekmedi', description: msg.unchanged.join(' · ') });
  if (msg.unsupported.length > 0) {
    notices.push({
      tone: 'warning',
      title: `${msg.unsupported.length} madde otomatik düzeltilemez (${names(msg.unsupported)}); snippet aracında düzelt`,
    });
  }
  // Eskiden burada "queue'ya eklendi" yaziyordu; ortada kuyruk yoktu
  if (msg.applied.length === 0 && msg.errors.length === 0 && msg.unchanged.length === 0 && msg.unsupported.length === 0) {
    notices.push({ tone: 'info', title: 'Uygulanacak otomatik düzeltme bulunmadı' });
  }
  return notices;
}
