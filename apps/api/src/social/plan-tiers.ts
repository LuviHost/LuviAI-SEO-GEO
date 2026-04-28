/**
 * Sosyal medya — plan bazli haftalik post kotasi ve default slot zamanlari.
 *
 * Saat: Europe/Istanbul (UTC+3, yaz saati uygulanmaz).
 * dayOfWeek: 0=Pazar ... 6=Cumartesi (Date.getDay() ile uyumlu).
 *
 * "Slot" = haftada bir post atilabilecek sabit gun+saat. Plan kac slot
 * tanimliyorsa o kadar otomatik post yayinlanir.
 */

export type WeeklySlot = {
  dayOfWeek: number; // 0-6
  hour: number;      // 0-23
  minute: number;    // 0-59
};

export type PlanSocialConfig = {
  postsPerWeek: number;
  slots: WeeklySlot[];
  timezone: string;
};

export const PLAN_SOCIAL_LIMITS: Record<string, PlanSocialConfig> = {
  TRIAL: {
    postsPerWeek: 1,
    timezone: 'Europe/Istanbul',
    slots: [{ dayOfWeek: 2, hour: 10, minute: 0 }], // Sali 10:00
  },
  STARTER: {
    postsPerWeek: 1,
    timezone: 'Europe/Istanbul',
    slots: [{ dayOfWeek: 2, hour: 10, minute: 0 }], // Sali 10:00
  },
  PRO: {
    postsPerWeek: 2,
    timezone: 'Europe/Istanbul',
    slots: [
      { dayOfWeek: 2, hour: 10, minute: 0 }, // Sali 10:00
      { dayOfWeek: 4, hour: 14, minute: 0 }, // Persembe 14:00
    ],
  },
  AGENCY: {
    postsPerWeek: 3,
    timezone: 'Europe/Istanbul',
    slots: [
      { dayOfWeek: 1, hour: 10, minute: 0 }, // Pazartesi 10:00
      { dayOfWeek: 3, hour: 14, minute: 0 }, // Carsamba 14:00
      { dayOfWeek: 5, hour: 11, minute: 0 }, // Cuma 11:00
    ],
  },
  ENTERPRISE: {
    postsPerWeek: 3,
    timezone: 'Europe/Istanbul',
    slots: [
      { dayOfWeek: 1, hour: 10, minute: 0 },
      { dayOfWeek: 3, hour: 14, minute: 0 },
      { dayOfWeek: 5, hour: 11, minute: 0 },
    ],
  },
};

export function getPlanSocialConfig(plan: string | null | undefined): PlanSocialConfig {
  if (plan && PLAN_SOCIAL_LIMITS[plan]) return PLAN_SOCIAL_LIMITS[plan];
  return PLAN_SOCIAL_LIMITS.TRIAL;
}

export const DAY_LABELS_TR: Record<number, string> = {
  0: 'Pazar',
  1: 'Pazartesi',
  2: 'Sali',
  3: 'Carsamba',
  4: 'Persembe',
  5: 'Cuma',
  6: 'Cumartesi',
};

export function formatSlotLabel(slot: WeeklySlot): string {
  const day = DAY_LABELS_TR[slot.dayOfWeek] ?? `Gun ${slot.dayOfWeek}`;
  const hh = String(slot.hour).padStart(2, '0');
  const mm = String(slot.minute).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}
