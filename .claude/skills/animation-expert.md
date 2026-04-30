---
name: animation-expert
description: Web animation uzmanı. anime.js v4 (animate, createTimeline, stagger, createSpring, onScroll, createDraggable, createMotionPath, morphTo) + CSS keyframes + Framer Motion bilgisi. UI girişleri, scroll-based effects, drag-drop physics, SVG path animation, modal transitions, stagger lists. Kullanıcı "animasyon", "geçiş", "transition", "smooth", "scroll efekti", "drag-drop fizik", "şık olsun", "hareketlendir" deyince TETİKLE. Animation request gelirse ÖNCE bu skill'i oku.
---

# Animation Expert (anime.js v4 öncelikli)

Sen LuviAI projesinde web animasyon uzmanısın. Hareketli, akıcı, profesyonel UI mikro-etkileşimleri tasarla.
**Reduced-motion-first** mantığıyla çalış: kullanıcı `prefers-reduced-motion: reduce` ayarladıysa
animasyonları kısalt veya devre dışı bırak.

---

## Hızlı Karar Ağacı

| İhtiyaç | Tercih edilen araç | Neden |
|---|---|---|
| Tek elemanın bir kerelik animasyonu (giriş, click feedback) | **CSS keyframes** veya `transition` | Bundle-zero, GPU-friendly |
| 2+ elemanın stagger ile akan girişi | **anime.js `animate()` + `stagger()`** | Tek satır, fine-grained kontrol |
| Birden fazla aşamalı sahne (intro → text → outro) | **`createTimeline()`** | Pozisyon (`<`, `+=`, label) ile dakik kurgu |
| Scroll-driven (parallax, reveal-on-scroll) | **`onScroll()`** veya CSS `scroll-timeline` | WAAPI scroll observer |
| Drag interaktivite (kart sürükle) | **`createDraggable()`** veya HTML5 DnD | Spring physics, snap, flick |
| Karmaşık SVG path / morph / drawing | **`morphTo()`, `createDrawable()`, `createMotionPath()`** | SVG-spesifik utiller |
| React/Next.js sayfalar arası | **Framer Motion** veya `view-transition-api` | Component lifecycle ile uyumlu |

> **Kural:** Bir animasyon `transition: all 200ms ease-out` ile çözülebiliyorsa anime.js'e gitme.

---

## Anime.js v4 — Çekirdek API (cheatsheet)

```js
import {
  animate, createTimeline, stagger,
  createSpring, onScroll, createDraggable,
  createDrawable, morphTo, createMotionPath,
  utils, // utils.set / utils.get / utils.random / utils.shuffle
} from 'animejs';
```

### `animate(targets, params)`

```js
animate('.card', {
  translateY: [40, 0],          // [from, to] tuple
  opacity: [0, 1],
  duration: 600,
  delay: stagger(80),           // her elemana +80ms
  ease: 'outExpo',
  loop: false,
  alternate: false,
  autoplay: true,
  onBegin: (anim) => {},
  onUpdate: (anim) => {},
  onComplete: (anim) => {},
});
```

**Per-property override** (her property'e ayrı duration/ease):

```js
animate('.hero', {
  translateX: { from: -50, to: 0, ease: 'outBack', duration: 800 },
  opacity:    { to: 1, duration: 400 },
  rotate:     { to: '1turn', ease: 'inOutSine', duration: 1200 },
});
```

### `createTimeline()` — sahne kurgusu

```js
const tl = createTimeline({ defaults: { duration: 500, ease: 'outQuart' } });

tl
  .label('intro')
  .add('.logo',     { scale: [0.8, 1], opacity: [0, 1] })
  .add('.headline', { translateY: [20, 0], opacity: [0, 1] }, '<+=120')  // 120ms önce
  .add('.subline',  { opacity: [0, 1] }, '<<')                            // önceki ile aynı anda
  .label('cta')
  .add('.btn',      { scale: [0.9, 1] }, 'cta')
  .call(() => analytics.track('hero_animated'), '+=200');
```

**Pozisyon syntax:**
- `0` veya `1500` — milisaniye (absolute)
- `'+=200'` — önceki bitişten 200ms sonra
- `'-=100'` — önceki bitişten 100ms önce
- `'<'` veya `'<<'` — önceki ile **aynı anda başla**
- `'<+=200'` — önceki başlangıçtan 200ms sonra
- `'label-name'` — labela hizala

### `stagger()` — kademeli giriş

```js
animate('.list-item', {
  y: [20, 0],
  opacity: [0, 1],
  delay: stagger(80),                      // sıralı
  // delay: stagger(80, { from: 'center' }), // ortadan dışa
  // delay: stagger(80, { from: 'last' }),   // sondan başa
  // delay: stagger([100, 800]),             // ilk→son arası dağıt
  duration: 500,
  ease: 'outCubic',
});
```

**Grid stagger** (matrix layout):

```js
animate('.grid-cell', {
  scale: [0, 1],
  delay: stagger(40, { grid: [12, 8], from: 'center' }),
  ease: 'outBack',
});
```

### `createSpring()` — fizik tabanlı

```js
const spring = createSpring({ stiffness: 100, damping: 12, mass: 1 });

animate('.card', {
  translateY: [50, 0],
  ease: spring,   // duration spring'den otomatik hesaplanır
});
```

### `onScroll()` — scroll observer

```js
animate('.fade-in', {
  opacity: [0, 1],
  translateY: [40, 0],
  ease: 'outQuart',
  autoplay: onScroll({
    target: '.fade-in',
    enter: 'bottom-=100 top',  // viewport altı 100px üstünden geç
    leave: 'top top',
    sync: 1,                    // 1 = scroll'a kilitli, 0 = bir kez tetikle
  }),
});
```

### `createDraggable()` — drag + spring

```js
createDraggable('.draggable', {
  bounds: '.container',
  snap: 50,                     // 50px gride snap
  onGrab: () => {},
  onRelease: (drag) => drag.flick({ velocity: 0.8 }),
  spring: { stiffness: 80, damping: 10 },
});
```

### Playback kontrolü

```js
const a = animate('.x', { translateX: 200, autoplay: false });
a.play();    a.pause();    a.reverse();
a.seek(750); a.complete(); a.cancel();
a.then(() => console.log('done'));   // promise
```

---

## Easing referansı

Tam liste:

```
linear
in / out / inOut / outIn                    (power = 1.675)
in/out/inOut/outIn   + Quad / Cubic / Quart / Quint
in/out/inOut/outIn   + Sine / Expo / Circ
in/out/inOut/outIn   + Back     (overshoot = 1.70158)
in/out/inOut/outIn   + Bounce
in/out/inOut/outIn   + Elastic  (amplitude = 1, period = 0.3)
cubicBezier(x1, y1, x2, y2)
steps(n)
spring (createSpring)
```

**Kullanım rehberi:**
- **Giriş animasyonu** → `outExpo`, `outBack`, `outCubic`
- **Çıkış animasyonu** → `inQuad`, `inExpo`
- **Hover/feedback** → `outSine`, `outQuart` (kısa, 150-250ms)
- **Bouncy CTA / başarı** → `outBack`, `outBounce`, `outElastic`
- **Tab/sayfa geçişi** → `inOutQuart`, `inOutCubic`
- **Fizik (drag, kartı bırak)** → `createSpring()`

---

## React / Next.js entegrasyon kalıbı

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

export function FadeInList({ items }: { items: string[] }) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    // prefers-reduced-motion guard
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const a = animate(ref.current.children, {
      translateY: [16, 0],
      opacity: [0, 1],
      delay: stagger(60),
      duration: 500,
      ease: 'outQuart',
    });
    return () => a.cancel();   // unmount cleanup
  }, [items.length]);   // dependency: items değişirse yeniden anime et

  return (
    <ul ref={ref}>
      {items.map((it) => <li key={it}>{it}</li>)}
    </ul>
  );
}
```

**Kurallar:**
- `useEffect` içinde animate, return'de `a.cancel()`
- `window` erişimi `typeof window !== 'undefined'` ile koru (SSR)
- DOM ref'leri `useRef`, class selector'ları yerine `ref.current.querySelectorAll(...)`
- Dependency array'i dikkatli — animasyonu yeniden başlatmak istemiyorsan `[]` boş bırak

---

## Performans kuralları

### Kullan
✅ `transform` (translate, scale, rotate) — GPU-composited, hızlı
✅ `opacity` — GPU-composited
✅ `filter` (blur, brightness) — GPU
✅ `will-change: transform` (animasyon başlamadan önce, sonra kaldır)

### Kullanma
❌ `width`, `height`, `top`, `left`, `margin`, `padding` — layout reflow tetikler
❌ `box-shadow` blur değişimi — paint pahalı (FLIP yapacaksan ölç)
❌ 60fps'de 100+ paralel `animate()` — DocumentFragment veya tek timeline tercih et
❌ `setState` her `onUpdate`'te — render thrash; `requestAnimationFrame` veya direct DOM mutate

### Reduced motion
Her animasyon kalıbında:

```ts
const reduced = typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = reduced ? 0 : 600;
```

veya CSS:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## LuviAI projesinde tipik animasyon kalıpları

### 1. Site Skoru sayacı (number tween)

```ts
const obj = { v: 0 };
animate(obj, {
  v: targetScore,
  duration: 1500,
  ease: 'outExpo',
  onUpdate: () => scoreEl.textContent = Math.round(obj.v).toString(),
});
```

### 2. Stepper kart açılışı (accordion)

```ts
animate(content, {
  height: ['0px', `${content.scrollHeight}px`],
  opacity: [0, 1],
  duration: 350,
  ease: 'outQuart',
  onComplete: () => content.style.height = 'auto',
});
```

### 3. Tutorial modal sahnesi (drag-drop simülasyonu)

```ts
const tl = createTimeline({ loop: true, defaults: { ease: 'inOutQuart' } });
tl
  .add('.demo-card', { x: [0, 180], y: [0, 110], duration: 1200 })
  .add('.demo-target', { backgroundColor: ['transparent', '#7c5cfc33'] }, '<+=600')
  .add('.demo-time-tag', { opacity: [0, 1], scale: [0.8, 1] }, '<+=400')
  .add('.demo-card', { opacity: [1, 0], duration: 400 }, '+=300')
  .add('.demo-card', { x: 0, y: 0, opacity: 1, duration: 0 });   // reset
```

### 4. Toast / notification entry

```ts
animate(toastEl, {
  translateY: [-20, 0],
  opacity: [0, 1],
  duration: 300,
  ease: 'outBack',
});
```

### 5. Skor / metrik kartlarının grid girişi

```ts
animate('.metric-card', {
  scale: [0.95, 1],
  opacity: [0, 1],
  delay: stagger(80, { from: 'first' }),
  duration: 500,
  ease: 'outCubic',
});
```

### 6. Drag-drop article kartı: drop bounce feedback

```ts
const spring = createSpring({ stiffness: 200, damping: 8 });
animate(droppedCard, { scale: [1.1, 1], ease: spring });
```

### 7. Article üretiliyor pulse (waiting state)

```css
.generating-dot {
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50%      { opacity: 1;   transform: scale(1); }
}
```

(Bu durumda CSS keyframes JS'ten daha hafif — sürekli pulse için `requestAnimationFrame` döngüsü kurma.)

### 8. Sayfa içi smooth scroll → element

```ts
import { utils } from 'animejs';
const target = document.querySelector('#section-2');
const startY = window.scrollY;
const endY = target.getBoundingClientRect().top + startY - 80;
const obj = { y: startY };
animate(obj, {
  y: endY,
  duration: 800,
  ease: 'inOutCubic',
  onUpdate: () => window.scrollTo(0, obj.y),
});
```

---

## Anti-patterns / sık hatalar

| Hata | Düzeltme |
|---|---|
| `animate('.x', { left: '100px' })` | `translateX: 100` (transform > left) |
| Her render'da `useEffect` ile yeni animate, cleanup yok | `return () => a.cancel()` |
| 200 elemanı `forEach` ile tek tek `animate()` | Tek `animate('.list', { delay: stagger() })` |
| `setState({ x })` her `onUpdate`'te | DOM ref ile direkt mutate (`el.style.transform = ...`) |
| `duration: 0` reduced-motion için | Animasyonu tamamen `if (reduced) return` ile atla |
| `loop: true` + cleanup yok = memory leak | `useEffect` cleanup'da `a.cancel()` |
| Server component içinde `animate` | `'use client'` zorunlu |
| `whileHover={{...}}` yerine `:hover` CSS | Mikro hover için CSS yeter, JS gereksiz |

---

## Karar verirken sor

1. **Reduce motion?** İlk satır kontrol.
2. **CSS yetiyor mu?** Tek property → CSS. Çok aşamalı → JS.
3. **WAAPI var mı?** Modern Chrome/Safari `Element.animate()` zaten hızlı — anime.js'in WAAPI sürümü (`waapi.animate`) bunu kullanır.
4. **Bundle fark eder mi?** Anime.js v4 = 24.5 KB. 1-2 animasyon için kritik değil; landing page için tree-shake kontrol et.
5. **A11y?** Hareket fobisi, epilepsi → `prefers-reduced-motion` + flash sınırı (3 Hz altı).

---

## Hızlı referans linkleri

- v4 home & docs: https://animejs.com/
- Animation API: https://animejs.com/documentation/animation
- Timeline: https://animejs.com/documentation/timeline
- Built-in eases: https://animejs.com/documentation/easings/built-in-eases
- WAAPI MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API
- prefers-reduced-motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

---

## Çıktı protokolü

Bir animasyon istendiğinde:
1. **Üst seviye plan** ver (1-2 cümle): hangi araç, neden.
2. **Kod** ver (copy-paste hazır, import'lar dahil).
3. **Reduced-motion guard** ekle.
4. **Cleanup** unutma (React).
5. Performans uyarısı varsa belirt (ör. "100+ stagger için grid mode kullan").
6. Gerekirse alternatifi (CSS-only) kısaca yan yana göster.
