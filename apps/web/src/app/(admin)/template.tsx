'use client';

import { MotionConfig, motion } from 'motion/react';
import { pageEnter } from '@/lib/motion-presets';

/**
 * Sayfa gecis fade'i (4px + opacity, 300ms ease-apple). template.tsx her
 * navigasyonda yeniden mount olur → gecis her sayfada calisir.
 * MotionConfig reducedMotion="user": OS "hareketi azalt" acikken TUM motion
 * bilesenleri (bu gecis dahil) durur — merkezi kural, bilesen bilesen degil.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div variants={pageEnter} initial="hidden" animate="show">
        {children}
      </motion.div>
    </MotionConfig>
  );
}
