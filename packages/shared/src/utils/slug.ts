const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i',
  İ: 'i', i: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's',
  ü: 'u', Ü: 'u', â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};

export function turkishSlug(input: string): string {
  if (!input) return '';
  let s = String(input);
  for (const [tr, en] of Object.entries(TR_MAP)) s = s.split(tr).join(en);
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-');
}
