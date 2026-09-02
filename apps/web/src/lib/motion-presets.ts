/**
 * Hareket sozlesmesi — TEK kaynak. Sayfa/karta giris animasyonu yazan herkes
 * buradan import eder; bilesen icinde elle transition tanimi YASAK (tutarlilik).
 *
 * Kullanim:
 *   <motion.div variants={staggerContainer} initial="hidden" animate="show">
 *     <motion.div variants={fadeUp}>…</motion.div>
 *   </motion.div>
 *
 * reducedMotion saygisi template.tsx'teki <MotionConfig reducedMotion="user"> ile
 * merkezi — burada tekrar kontrol edilmez.
 */
import type { Variants, Transition } from 'motion/react';

/** Apple ease-out-expo — tailwind.config'teki 'apple' easing'in JS esleseni */
export const EASE_APPLE = [0.16, 1, 0.3, 1] as const;

export const TRANSITION_BASE: Transition = { duration: 0.45, ease: EASE_APPLE };
export const TRANSITION_FAST: Transition = { duration: 0.25, ease: EASE_APPLE };

/** Standart giris: 12px alttan + fade. Kart, metrik, satir icin. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: TRANSITION_BASE },
};

/** Yalniz fade — layout kaymasi istenmeyen yerlerde (grafik, iframe). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: TRANSITION_BASE },
};

/** Ebeveyn: cocuklari 60ms arayla sirala. Metrik gridleri icin. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

/** Sayfa gecisi — template.tsx kullanir (hafif: 4px + fade, 300ms). */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_APPLE } },
};
