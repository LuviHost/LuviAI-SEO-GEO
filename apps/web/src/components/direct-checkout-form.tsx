'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * PayTR Direkt API ödeme formu (otomatik yenileme açıkken).
 *
 * Kart alanları bu formdan TARAYICIDAN DOĞRUDAN PayTR'ye post edilir
 * (action = https://www.paytr.com/odeme); RanksUp sunucusuna uğramaz.
 * İmzalı gizli alanlar API'den gelir. store_card=1 → kart PayTR'de saklanır,
 * dönem sonunda kayıtlı karttan otomatik yenilenir. Onay kutusu zorunlu ve
 * varsayılan olarak işaretsiz (otomatik yenileme açık rızayla).
 */
export interface DirectCheckout {
  mode: 'direct';
  action: string;
  fields: Record<string, string>;
  utoken: string | null;
  merchantOid: string;
  amountText: string;
  planName: string;
  cycle: 'monthly' | 'annual';
}

export const CHECKOUT_STORAGE_KEY = 'ranksup-direct-checkout';

const digits = (v: string) => v.replace(/\D/g, '');

export function DirectCheckoutForm({ checkout }: { checkout: DirectCheckout }) {
  const [owner, setOwner] = useState('');
  const [number, setNumber] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const donem = checkout.cycle === 'annual' ? 'yıllık' : 'aylık';
  const valid = useMemo(() => {
    const m = Number(month);
    return owner.trim().length >= 3
      && digits(number).length >= 15 && digits(number).length <= 16
      && m >= 1 && m <= 12
      && digits(year).length === 2
      && digits(cvv).length >= 3;
  }, [owner, number, month, year, cvv]);

  return (
    <Card className="mx-auto w-full max-w-md p-6">
      <div className="mb-5">
        <p className="text-label text-muted-foreground">Ödenecek tutar</p>
        <p className="font-brand text-h4 font-semibold tabular-nums">{checkout.amountText}</p>
        <p className="text-sm text-muted-foreground">RanksUp {checkout.planName} · {donem}</p>
      </div>

      <form method="POST" action={checkout.action} onSubmit={() => setSubmitting(true)} className="space-y-4">
        {Object.entries(checkout.fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {checkout.utoken && <input type="hidden" name="utoken" value={checkout.utoken} />}
        <input type="hidden" name="store_card" value="1" />

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Kart üzerindeki isim</span>
          <Input name="cc_owner" autoComplete="cc-name" value={owner} onChange={(e) => setOwner(e.target.value.slice(0, 50))} required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Kart numarası</span>
          <div className="relative">
            <Input
              inputMode="numeric"
              autoComplete="cc-number"
              value={digits(number).replace(/(\d{4})(?=\d)/g, '$1 ')}
              onChange={(e) => setNumber(digits(e.target.value).slice(0, 16))}
              className="pr-10 font-mono tabular-nums"
              required
            />
            <CreditCard className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>
          {/* Görünen alan 4'lü gruplu; PayTR'ye yalnız rakamlar gider */}
          <input type="hidden" name="card_number" value={digits(number)} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Ay</span>
            <Input name="expiry_month" inputMode="numeric" autoComplete="cc-exp-month" placeholder="AA" value={month} onChange={(e) => setMonth(digits(e.target.value).slice(0, 2))} required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Yıl</span>
            <Input name="expiry_year" inputMode="numeric" autoComplete="cc-exp-year" placeholder="YY" value={year} onChange={(e) => setYear(digits(e.target.value).slice(-2))} required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">CVV</span>
            <Input name="cvv" inputMode="numeric" autoComplete="cc-csc" value={cvv} onChange={(e) => setCvv(digits(e.target.value).slice(0, 4))} required />
          </label>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" required />
          <span>
            Aboneliğimin, iptal edene kadar her {checkout.cycle === 'annual' ? 'yıl' : 'ay'} sonunda bu karttan otomatik yenilenmesini
            ve kartımın ödeme kuruluşu PayTR tarafından saklanmasını onaylıyorum.{' '}
            <Link href="/terms" target="_blank" className="underline underline-offset-2">Koşullar</Link>
          </span>
        </label>

        <Button type="submit" size="lg" className="w-full" disabled={!valid || !consent || submitting}>
          {submitting ? 'Bankana yönlendiriliyorsun…' : `${checkout.amountText} öde ve aboneliği başlat`}
        </Button>
        <p className="flex items-start gap-2 text-label text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Kart bilgilerin RanksUp sunucularına gönderilmez; doğrudan PayTR'ye iletilir ve bankanın 3D Secure doğrulamasıyla onaylanır.
          Aboneliği istediğin zaman Abonelik sayfasından iptal edebilirsin.
        </p>
      </form>
    </Card>
  );
}
