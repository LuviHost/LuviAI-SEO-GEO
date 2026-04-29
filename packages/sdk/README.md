# @luviai/sdk

Official Node.js SDK for [LuviAI](https://ai.luvihost.com) — SEO + GEO + Ads automation platform.

## Install

```bash
npm install @luviai/sdk
```

## Quick Start

```ts
import { LuviAI } from '@luviai/sdk';

const luvi = new LuviAI({ apiKey: process.env.LUVIAI_API_KEY! });

// 1. Liste sites
const sites = await luvi.sites.list();

// 2. Generate article
const article = await luvi.articles.generate({
  siteId: sites[0].id,
  topic: 'WordPress hosting nasıl seçilir?',
});

// 3. Site GEO health score
const score = await luvi.audit.scoreCard(sites[0].id);
console.log(`GEO Skoru: ${score.overallScore}/100 (Grade: ${score.grade})`);

// 4. AI Citation history
const citations = await luvi.audit.citationHistory(sites[0].id, 30);

// 5. Build paid ad campaign
const campaign = await luvi.ads.build(sites[0].id, {
  platform: 'both',
  objective: 'leads',
  productOrService: 'Hosting paketleri 49 TL\'den',
  landingUrl: 'https://siteniz.com',
  budgetType: 'daily',
  budgetAmount: 100,
});
```

## Get an API Key

1. Sign in at https://ai.luvihost.com
2. Go to **Settings → API Keys**
3. Click **Create Key**, choose scopes
4. Copy the token (starts with `luvi_`)

## Available Resources

- `luvi.sites` — list/create/update/delete
- `luvi.articles` — generate, publish, audio, video, translate
- `luvi.audit` — score card, citation history, schema validate, auto-fix
- `luvi.ads` — campaigns (Google + Meta), audience, copy, images, build, launch
- `luvi.analytics` — GSC overview, top articles, reports
- `luvi.social` — channels, publish

## License

MIT © LuviHost
