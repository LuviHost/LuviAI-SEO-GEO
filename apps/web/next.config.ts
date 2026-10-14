import type { NextConfig } from 'next';

const config: NextConfig = {
  /**
   * NEDEN env'den: canli sunucu `.next/standalone/apps/web/server.js` uzerinden calisiyor ve
   * `pnpm build` tam o klasoru silip yeniden yaziyordu — build suren 2-3 dakika boyunca site
   * 500 ve ChunkLoadError veriyordu (01.09.2026'da gercek kullanicida goruldu). Deploy artik
   * NEXT_DIST_DIR=.next-yeni ile ayri dizine build alip bitince yer degistiriyor; calisan
   * surum build boyunca bozulmuyor.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  output: 'standalone',
  /**
   * apps/video (Remotion) kaynak TSX olarak tuketilir — AiScan kompozisyonu landing'de
   * @remotion/player ile oynatilir. Ayrica build adimi gerekmez; Next derler.
   */
  transpilePackages: ['@luviai/video'],
  /**
   * YEREL ONIZLEME (yalniz `next dev`): PREVIEW_PROD_API=1 iken /api/* istekleri
   * sunucu tarafinda canli API'ye vekillenir — tarayici ayni kokene konustugu
   * icin CORS gerekmez. /api/auth (NextAuth) yerel dosya rotasi oldugu icin
   * vekillenmez. Kimlik: NEXT_PUBLIC_PREVIEW_API_KEY (salt-okunur anahtar,
   * lib/api.ts). Uretim build'inde hic devreye girmez.
   */
  async rewrites() {
    if (process.env.NODE_ENV === 'production' || !process.env.PREVIEW_PROD_API) return [];
    const target = process.env.PREVIEW_API_ORIGIN || 'https://ranksup.ai';
    return { beforeFiles: [], afterFiles: [{ source: '/api/:path*', destination: `${target}/api/:path*` }], fallback: [] };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ];
  },
};
export default config;
