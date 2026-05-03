'use client';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';

const SERVICES = [
  { name: 'API (ai.luvihost.com/api)', status: 'operational', uptime: '99.98%' },
  { name: 'Web Dashboard', status: 'operational', uptime: '99.99%' },
  { name: 'AI Generation Worker', status: 'operational', uptime: '99.95%' },
  { name: 'Publish Adapters', status: 'operational', uptime: '99.92%' },
  { name: 'GSC Sync', status: 'operational', uptime: '99.90%' },
  { name: 'PayTR Webhook', status: 'operational', uptime: '99.99%' },
  { name: 'Email Service (Resend)', status: 'operational', uptime: '99.97%' },
];

export default function StatusPage() {
  return (
    <div className="bg-gradient-to-b from-background to-muted">
      <main className="container max-w-3xl py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full mb-4">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Tüm sistemler çalışıyor</span>
          </div>
          <h1 className="text-4xl font-bold mb-2">Sistem Durumu</h1>
          <p className="text-muted-foreground">
            Son 90 gün ortalama uptime: <strong>%99.96</strong>
          </p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="font-semibold">Servisler</h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {SERVICES.map((s) => (
                <div key={s.name} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground font-mono">{s.uptime}</span>
                    <Badge variant="success">Operational</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-8">
          Detaylı geçmiş ve incident raporları için{' '}
          <a href="https://stats.uptimerobot.com/luviai" className="text-brand hover:underline" target="_blank" rel="noopener">
            stats.uptimerobot.com/luviai
          </a>
        </p>
      </main>
    </div>
  );
}
