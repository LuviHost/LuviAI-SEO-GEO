'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'luviai-cookie-consent';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: true, ts: Date.now() }));
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: false, ts: Date.now() }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-md z-50">
      <div className="bg-card border rounded-xl shadow-2xl p-5 relative">
        <button
          onClick={decline}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          aria-label="Kapat"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="font-bold mb-2">🍪 Çerez Kullanımı</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Deneyimini iyileştirmek için çerez kullanıyoruz. Kabul ederek{' '}
          <Link href="/privacy" className="text-brand hover:underline">
            Gizlilik Politikası
          </Link>
          'nı onaylamış olursun.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={accept} className="flex-1">
            Kabul Et
          </Button>
          <Button size="sm" variant="outline" onClick={decline}>
            Reddet
          </Button>
        </div>
      </div>
    </div>
  );
}
