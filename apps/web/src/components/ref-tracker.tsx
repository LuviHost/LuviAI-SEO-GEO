'use client';

import { useEffect } from 'react';

/**
 * RefTracker — Cloudflare CDN cache'i ana sayfa middleware'i bypass ettiği için
 * client-side fallback. URL'de ?ref=CODE varsa:
 *   1) document.cookie ile luvi_ref set eder (60 gün, sameSite=lax)
 *   2) URL'den ref param'ı temizler (history.replaceState — kullanıcı bu URL'i
 *      kopyalayıp paylaşırsa kazara kendi ref'ini dağıtmasın)
 *
 * Set edilen cookie'yi NextAuth signIn callback (server) cookies() API ile
 * okuyup affiliate attribute endpoint'ini çağırır.
 *
 * Last-touch attribution: yeni ref linki tıklandığında eski cookie üzerine yazar.
 * (Kullanıcı niyeti son linktedir; first-touch testing'de yanlış attribution
 * üretiyordu.)
 */
export function RefTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) return;
    if (!/^[a-z0-9-_]{4,64}$/i.test(ref)) return;

    // Last-touch attribution: yeni ref linki her zaman cookie'yi günceller.
    // Sebep: kullanıcı bilinçli olarak başka bir linke tıklıyorsa niyetinin
    // son linkte olduğunu varsayıyoruz. Eski cookie korumak (first-touch)
    // testing'de ve real-world'de kullanıcıyı şaşırtıyor (önceden tıklanan
    // bir linkten kalma cookie ile yanlış affiliate'a atfedilme riski).
    const maxAge = 60 * 24 * 60 * 60; // 60 gün
    document.cookie = `luvi_ref=${encodeURIComponent(ref)}; max-age=${maxAge}; path=/; samesite=lax`;

    // URL temizle — adres çubuğundan ?ref kaybolsun
    url.searchParams.delete('ref');
    const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
    window.history.replaceState({}, '', cleanUrl);
  }, []);

  return null;
}
