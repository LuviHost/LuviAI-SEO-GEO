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
      /**
       * Ajan kesif belgeleri (public/.well-known). Uzantisiz dosyaya Next
       * application/octet-stream verirdi; spesifikasyonlarin istedigi turler:
       *  - RFC 9728 §3.2 korunan kaynak metadatasi: application/json
       *    (https://www.rfc-editor.org/rfc/rfc9728.html#section-3.2). api.ranksup.ai'de
       *    kok yollar bu uygulamaya geliyor; MCP kaynagi /api/mcp oldugu icin belge
       *    /.well-known/oauth-protected-resource/api/mcp yolunda durur.
       *  - AI Catalog: application/ai-catalog+json (SHOULD) — github.com/Agent-Card/ai-catalog
       *    specification/ai-catalog.md "Media Type"
       * Herkese acik, salt-okuma metadata: tarayici tabanli istemciler icin CORS acik.
       */
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      {
        source: '/.well-known/ai-catalog.json',
        headers: [
          { key: 'Content-Type', value: 'application/ai-catalog+json' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
};
export default config;
