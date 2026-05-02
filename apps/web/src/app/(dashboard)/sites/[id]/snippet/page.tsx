'use client';
import { useSiteContext } from '../site-context';
import { SnippetPanel } from '@/components/site-flow-stepper';
import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function SnippetPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Snippet Üretici</h2>
          <p className="text-sm text-muted-foreground">Bir URL gir, AI title/description/FAQ önerileri üret + uygula.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-5">
          <SnippetPanel siteId={site.id} />
        </CardContent>
      </Card>
    </div>
  );
}
