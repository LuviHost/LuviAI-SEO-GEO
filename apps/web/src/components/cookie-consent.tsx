'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import {
  CONSENT_REOPEN_EVENT,
  CONSENT_STORAGE_KEY,
  announceConsentChange,
  browserConsentStorage,
  browserPageEnv,
  createConsentController,
  readConsent,
  writeConsent,
  type ConsentChoice,
  type ConsentController,
  type ConsentState,
  type ConsentTrigger,
} from '@/lib/consent';

/**
 * Cerez bandi + onaya bagli etiket yukleyici.
 *
 * NEDEN tek bilesen: GTM, GA4 ve Clarity artik kok layout'ta degil, yalniz burada
 * ve yalniz "Kabul et" sonrasi yuklenir (karar mantigi ve kaynaklar:
 * lib/consent.ts). Eski bant tercihi yalniz kaydediyordu; etiketler her
 * durumda yukleniyordu ve metin onayi Gizlilik Politikasi onayina bagliyordu
 * (KVKK cerez rehberi 7.3: riza Gizlilik Bildirimi'ne ilistirilemez).
 *
 * Bant metni neyin, ne icin kullanildigini ve yalniz kabulle yuklendigini
 * soyler (rehber 7.1); "Kabul et" ile "Reddet" ayni boyut ve gorunumde
 * (rehber 7.3: renk, buyukluk, punto acisindan esit). Tercih sonradan gizlilik
 * sayfasindaki "Cerez tercihlerini degistir" dugmesiyle degistirilir
 * (CONSENT_REOPEN_EVENT).
 */

const TEXT = {
  tr: {
    title: 'Çerez tercihin',
    body: 'Analitik ve pazarlama çerezleri: Google Analytics/Tag Manager (ziyaret istatistikleri, reklam dönüşüm ölçümü ve yeniden pazarlama) ve Microsoft Clarity (oturum kaydı ve ısı haritası) — yalnız kabul edersen yüklenir. Oturum için zorunlu çerezler her zaman kullanılır.',
    changeBefore: 'Kararını istediğin zaman ',
    changeLink: 'Gizlilik Politikası',
    changeAfter: '’ndaki çerez bölümünden değiştirebilirsin.',
    current: {
      granted: 'Şu anki tercihin: kabul.',
      denied: 'Şu anki tercihin: ret.',
    },
    accept: 'Kabul et',
    decline: 'Reddet',
    closeDecline: 'Reddet ve kapat',
    close: 'Kapat',
  },
  en: {
    title: 'Your cookie choice',
    body: 'Analytics and marketing cookies: Google Analytics/Tag Manager (visit statistics, ad conversion measurement and remarketing) and Microsoft Clarity (session recordings and heatmaps) — loaded only if you accept. Strictly necessary cookies for your session are always used.',
    changeBefore: 'You can change your choice at any time in the cookie section of our ',
    changeLink: 'Privacy Policy',
    changeAfter: '.',
    current: {
      granted: 'Current choice: accepted.',
      denied: 'Current choice: declined.',
    },
    accept: 'Accept',
    decline: 'Decline',
    closeDecline: 'Decline and close',
    close: 'Close',
  },
} as const;

export function CookieConsent({ gtmId, clarityId, gaId }: { gtmId?: string; clarityId?: string; gaId?: string }) {
  const { locale } = useT();
  const d = TEXT[locale];
  // null: depo henuz okunmadi (sunucu ve ilk istemci cizimi). Bu arada hicbir
  // sey yuklenmez ve hicbir cerez silinmez: onay verenin _ga kimligi
  // okumadan once silinmesin.
  const [state, setState] = useState<ConsentState | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const focusOnOpen = useRef(false);
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  // Plan + yan etkiler (geri alma, cerez silme, yukleme, yenileme) lib/consent.ts
  // createConsentController'da. Tarayici ortamina dokundugu icin yalniz efekt/olay
  // icinde kurulur (sunucu ciziminde window yok).
  const controllerRef = useRef<ConsentController | null>(null);
  const controller = useCallback(() => {
    if (!controllerRef.current) controllerRef.current = createConsentController(browserPageEnv());
    return controllerRef.current;
  }, []);

  const apply = useCallback(
    (next: ConsentState, trigger: ConsentTrigger) => {
      const plan = controller().apply(next, trigger, { gtmId, clarityId, gaId });
      setState(next);
      setOpen(plan.showBanner);
    },
    [controller, gtmId, clarityId, gaId],
  );

  // Ilk okuma
  useEffect(() => {
    apply(readConsent(browserConsentStorage, Date.now()), 'load');
  }, [apply]);

  // Gizlilik sayfasindaki "Cerez tercihlerini degistir" dugmesi
  useEffect(() => {
    const onReopen = () => {
      focusOnOpen.current = true;
      setOpen(true);
    };
    window.addEventListener(CONSENT_REOPEN_EVENT, onReopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, onReopen);
  }, []);

  // Baska sekmede verilen ya da geri alinan karar bu sekmeye de uygulanir. Geri
  // almada GTM'i yuklemis bu sekme de yenilenir (planConsent: consent "denied"
  // yuklu container'i durdurmaz); forma yazilmissa bir sonraki sayfa gecisinde.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== CONSENT_STORAGE_KEY) return;
      apply(readConsent(browserConsentStorage, Date.now()), 'sync');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [apply]);

  // Geri/ileri onbellegi (bfcache): onbellekteki sayfa storage olayini almaz (olay
  // yalniz "fully active" belgelere gider: https://html.spec.whatwg.org/multipage/webstorage.html#send-a-storage-notification);
  // geri donuste depodaki karar yeniden okunur, eski sayfada yuklu kalan etiketler
  // geri alinmis onayla calismasin (https://web.dev/articles/bfcache#update-stale-or-sensitive-data-after-bfcache-restore).
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) apply(readConsent(browserConsentStorage, Date.now()), 'sync');
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [apply]);

  // Bu sayfada bir form alanina yazildi: baska sekmeden gelen geri almada yenileme
  // sayfa gecisini bekler (kaydedilmemis metin silinmesin)
  useEffect(() => {
    const onInput = () => controller().noteInput();
    document.addEventListener('input', onInput, true);
    return () => document.removeEventListener('input', onInput, true);
  }, [controller]);

  // Sayfa gecisi: bekleyen yenileme varsa simdi (ilk cizimde degil, yalniz yol degisince)
  useEffect(() => {
    const prev = lastPathname.current;
    lastPathname.current = pathname;
    if (prev !== null && prev !== pathname) controller().routeChanged();
  }, [pathname, controller]);

  // Dugmeyle acilan bant klavye ve ekran okuyucu kullanicisina duyurulsun
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      panelRef.current?.focus();
    }
  }, [open]);

  const choose = (choice: ConsentChoice) => {
    // Kaydedilemezse (depo kapali) karar bu sayfada yine uygulanir; sonraki giriste yeniden sorulur
    writeConsent(browserConsentStorage, choice, Date.now());
    announceConsentChange();
    apply(choice, 'choice');
  };

  if (!open || state === null) return null;

  // Ilk gosterimde kapatmak = reddetmek (rizaya tabi cerezler ilk elde pasif);
  // tercih zaten verilmisse yalniz bandi kapatir, karari degistirmez
  const undecided = state === 'unset';

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-md z-50 focus:outline-none"
    >
      <div className="bg-card border rounded-xl shadow-2xl p-5 relative">
        <button
          type="button"
          onClick={undecided ? () => choose('denied') : () => setOpen(false)}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          aria-label={undecided ? d.closeDecline : d.close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 id="cookie-consent-title" className="font-bold mb-2 pr-6">{d.title}</h2>
        <p id="cookie-consent-body" className="text-sm text-muted-foreground mb-2">{d.body}</p>
        <p className="text-sm text-muted-foreground mb-4">
          {d.changeBefore}
          <Link href="/privacy#cerezler" className="text-brand hover:underline">{d.changeLink}</Link>
          {d.changeAfter}
          {!undecided && <> {d.current[state]}</>}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => choose('granted')} className="flex-1">
            {d.accept}
          </Button>
          <Button size="sm" variant="outline" onClick={() => choose('denied')} className="flex-1">
            {d.decline}
          </Button>
        </div>
      </div>
    </section>
  );
}
