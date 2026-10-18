import { toast } from 'sonner';

/**
 * Bildirim tarifi — saf yardimcilar (publish-result.ts, stuck-recovery.ts) metni
 * ve tonu uretir, bilesen bunu showNotice ile gosterir.
 *
 * NEDEN AYRI: metin kurallari test edilsin diye yardimcilar sonner'a (React)
 * baglanmaz; yalniz bu tipi tip olarak import ederler.
 */
export interface NoticeSpec {
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description?: string;
}

export function showNotice(n: NoticeSpec): void {
  const opts = { description: n.description, duration: n.tone === 'success' ? 7000 : 10000 };
  switch (n.tone) {
    case 'success': toast.success(n.title, opts); break;
    case 'warning': toast.warning(n.title, opts); break;
    case 'error': toast.error(n.title, opts); break;
    default: toast.message(n.title, opts);
  }
}
