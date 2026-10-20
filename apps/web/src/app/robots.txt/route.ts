import { buildRobotsTxt } from '@/lib/robots-txt';

/** robots.txt — icerik ve gerekce: src/lib/robots-txt.ts */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(buildRobotsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
