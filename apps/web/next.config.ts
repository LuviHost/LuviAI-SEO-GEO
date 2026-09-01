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
