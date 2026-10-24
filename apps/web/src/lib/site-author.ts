/**
 * Sitenin gercek yazari (panel formu). API: GET/PUT/DELETE
 * /sites/:id/audit/author-profile/site (api audit/author-profile.service.ts).
 * Kayit varsa uretilen makalelerin JSON-LD author'u Person olur ve gorunur
 * "Bu makale <ad> tarafindan hazirlandi" satiri bu adi tasir; yoksa Organization.
 */
export interface SiteAuthor {
  name: string;
  url?: string;
  sameAs?: string[];
  jobTitle?: string;
}

export interface SiteAuthorForm {
  name: string;
  jobTitle: string;
  url: string;
  /** Satir basina bir profil adresi */
  sameAs: string;
}

export const EMPTY_AUTHOR_FORM: SiteAuthorForm = { name: '', jobTitle: '', url: '', sameAs: '' };

export function authorToForm(a: SiteAuthor | null | undefined): SiteAuthorForm {
  if (!a) return EMPTY_AUTHOR_FORM;
  return { name: a.name ?? '', jobTitle: a.jobTitle ?? '', url: a.url ?? '', sameAs: (a.sameAs ?? []).join('\n') };
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Formu API govdesine cevirir; hata varsa Turkce mesaj doner (sunucu ayrica dogrular) */
export function formToAuthor(f: SiteAuthorForm): { author: SiteAuthor } | { error: string } {
  const name = f.name.replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Yazar adı zorunlu.' };
  if (name.length > 120) return { error: 'Yazar adı en fazla 120 karakter olabilir.' };
  const url = f.url.trim();
  if (url && !isHttpUrl(url)) return { error: 'Yazar sayfası http(s):// ile başlayan bir adres olmalı.' };
  const sameAs = Array.from(new Set(f.sameAs.split(/\s+/).map((s) => s.trim()).filter(Boolean)));
  const bad = sameAs.find((s) => !isHttpUrl(s));
  if (bad) return { error: `Geçersiz profil adresi: ${bad}` };
  if (sameAs.length > 10) return { error: 'En fazla 10 profil adresi eklenebilir.' };
  const jobTitle = f.jobTitle.replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    author: {
      name,
      ...(url ? { url } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      ...(jobTitle ? { jobTitle } : {}),
    },
  };
}
