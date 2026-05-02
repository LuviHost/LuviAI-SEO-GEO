'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSiteContext } from '../site-context';
import { Loader2 } from 'lucide-react';

/** /topics artık /articles'a yönleniyor — Önerilen Konular + Makaleler birleşik liste */
export default function TopicsRedirectPage() {
  const router = useRouter();
  const { site } = useSiteContext();
  useEffect(() => {
    router.replace(`/sites/${site.id}/articles` as any);
  }, [router, site.id]);
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Yönlendiriliyor — İçerikler sayfasına gidiyorsun…
      </div>
    </div>
  );
}
