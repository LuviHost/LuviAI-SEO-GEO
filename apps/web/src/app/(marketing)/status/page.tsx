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
    <div className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full mb-5">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Tüm sistemler çalışıyor</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            Sistem{' '}
            <span className="bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 bg-clip-text text-transparent">
              Durumu
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Son 90 gün ortalama uptime: <strong className="text-foreground">%99.96</strong>
          </p>
        </div>

        <div className="rounded-2xl border bg-background overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Servisler</h2>
          </div>
          <div className="divide-y">
            {SERVICES.map((s) => (
              <div key={s.name} className="px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="font-medium">{s.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">{s.uptime}</span>
                  <Badge variant="success" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Operational</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-8">
          Detaylı geçmiş ve incident raporları için{' '}
          <a href="https://stats.uptimerobot.com/luviai" className="text-orange-600 hover:underline" target="_blank" rel="noopener">
            stats.uptimerobot.com/luviai
          </a>
        </p>
      </main>
    </div>
  );
}
