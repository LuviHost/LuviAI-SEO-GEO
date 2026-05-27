'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Star, X, MessageSquare, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Dashboard'a yerleştirilebilir küçük "Deneyimini paylaş" kartı.
 * Submit edilen testimonial admin onayına düşer, onaylandığında landing'de görünür.
 */
export function TestimonialWidget({ siteId, defaultMetric }: { siteId?: string; defaultMetric?: string }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('luvi_testimonial_dismissed') === '1';
  });
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [metric, setMetric] = useState(defaultMetric ?? '');
  const [submitting, setSubmitting] = useState(false);

  if (dismissed && !open) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('luvi_testimonial_dismissed', '1'); } catch { /* noop */ }
  };

  const submit = async () => {
    if (body.trim().length < 10) {
      toast.error('Yorum en az 10 karakter olmalı');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitTestimonial({
        siteId,
        rating,
        body: body.trim(),
        role: role.trim() || undefined,
        company: company.trim() || undefined,
        metric: metric.trim() || undefined,
      });
      toast.success('Teşekkürler! Yorumun admin onayından sonra landing\'de yayınlanacak.');
      setOpen(false);
      dismiss();
    } catch (err: any) {
      toast.error(err.message || 'Gönderilemedi');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="rounded-2xl border-2 border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-amber-400/5 p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white grid place-items-center shadow-lg shrink-0">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">LuviAI'ı nasıl buldun?</p>
          <p className="text-xs text-muted-foreground">1 cümle yorumun landing'imizde görünebilir — gerçek müşteri sosyal kanıtı oluştur.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shrink-0">
          Yorum yaz
        </Button>
        <button onClick={dismiss} className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-muted-foreground shrink-0" title="Kapat">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-orange-500/30 bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Deneyimini paylaş</h3>
        <button onClick={() => setOpen(false)} className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Star rating */}
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} type="button">
            <Star className={`h-7 w-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'} transition`} />
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">{rating}/5</span>
      </div>

      {/* Body */}
      <div>
        <label className="text-xs font-semibold mb-1 block">Yorumun *</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          placeholder="Örn: ASA Auto-Pilot 60 günde CPI'ı $1.20'den $0.42'ye düşürdü."
          rows={3}
          className="w-full px-3 py-2 rounded-md border bg-background text-sm resize-none"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{body.length}/500 · Min 10 karakter</p>
      </div>

      {/* Role + Company */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold mb-1 block">Rolün</label>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Kurucu / Pazarlama Müdürü" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block">Şirket / Site</label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="KobiPratik / acme.com" className="h-9 text-sm" />
        </div>
      </div>

      {/* Metric (optional) */}
      <div>
        <label className="text-xs font-semibold mb-1 block">Spesifik kazanım (opsiyonel)</label>
        <Input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="40 saat/ay tasarruf · CPI -%62" className="h-9 text-sm" />
        <p className="text-[10px] text-muted-foreground mt-1">Rakamla sosyal kanıt çok daha güçlü olur</p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={() => setOpen(false)} className="flex-1" disabled={submitting}>İptal</Button>
        <Button
          onClick={submit}
          disabled={submitting || body.trim().length < 10}
          className="flex-1 bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
        >
          {submitting ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Gönderiliyor</> : 'Gönder'}
        </Button>
      </div>
    </div>
  );
}
