/**
 * Tema dugmesi: yalniz ACIK ve KOYU (sahip, 16.11.2026: "pc ikonunu kaldır, güneş ve gece yeter").
 *
 * Eskiden uc durum vardi: acik → koyu → sistem (bilgisayar ikonu) → acik. Sistem secenegi kalkti;
 * dugme gorunen temayi gosterir ve tiklaninca digerine gecer.
 *
 * `resolved`: next-themes'in `resolvedTheme` degeri (ekranda GORUNEN tema). Onceden "sistem"
 * secmis kullanicinin kayitli tercihi durur; dugme onda da gorunen temaya gore dogru ikonu
 * gosterir ve ilk tiklamada acik / koyu secimi kaydedilir. Bilinmeyen deger koyu sayilir
 * (uygulamanin varsayilan temasi).
 */
export type ThemeChoice = 'light' | 'dark';

export function shownTheme(resolved: string | null | undefined): ThemeChoice {
  return resolved === 'light' ? 'light' : 'dark';
}

export function nextTheme(resolved: string | null | undefined): ThemeChoice {
  return shownTheme(resolved) === 'light' ? 'dark' : 'light';
}

/** Dugmenin okunur adi: "Tema: koyu. Açık temaya geç" */
export function themeToggleLabel(resolved: string | null | undefined): string {
  return shownTheme(resolved) === 'light' ? 'Tema: açık. Koyu temaya geç' : 'Tema: koyu. Açık temaya geç';
}
