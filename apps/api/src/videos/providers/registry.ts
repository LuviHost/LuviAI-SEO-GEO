import type { VideoProvider, VideoProviderInfo } from './types.js';
import { SlideshowVideoProvider } from './slideshow.provider.js';
import { VeoVideoProvider } from './veo.provider.js';
import { RunwayVideoProvider } from './runway.provider.js';
import { HeyGenVideoProvider } from './heygen.provider.js';
import { SoraVideoProvider } from './sora.provider.js';

const PROVIDERS: VideoProvider[] = [
  new SlideshowVideoProvider(),
  new VeoVideoProvider(),
  new RunwayVideoProvider(),
  new HeyGenVideoProvider(),
  new SoraVideoProvider(),
];

const MAP: Record<string, VideoProvider> = {};
for (const p of PROVIDERS) MAP[p.key] = p;

export function getVideoProvider(key: string): VideoProvider {
  const p = MAP[key];
  if (!p) throw new Error(`Bilinmeyen video provider: ${key}`);
  return p;
}

export function listVideoProviders(): VideoProviderInfo[] {
  return PROVIDERS.map((p) => p.info());
}
