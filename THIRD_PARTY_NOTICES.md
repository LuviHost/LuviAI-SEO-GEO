# Third-Party Notices

RanksUp is proprietary software. Some parts are ported from, adapted from, or
bundled with open-source projects. Their copyright and license notices are
reproduced here as their licenses require. npm dependencies installed through
`package.json` are not listed; their licenses ship with each package.

Each ported file also names its source in a header comment.

---

## alirezarezvani/claude-code-aso-skill — MIT

- Source: https://github.com/alirezarezvani/claude-code-aso-skill
- Copyright (c) 2025 Alireza Rezvani
- Used in (TypeScript ports of the Python modules, commit `e0e3e21`):
  `apps/api/src/aso/aso-scorer.service.ts`, `itunes-api.client.ts`,
  `aso-keyword-analyzer.service.ts`, `aso-review-analyzer.service.ts`,
  `aso-metadata-optimizer.service.ts`, `aso-localization-helper.service.ts`,
  `aso-ab-test-planner.service.ts`, `aso-launch-checklist.service.ts`.
- Copied agent/command definitions: `.claude/agents/aso/*.md`,
  `.claude/commands/aso/*.md`.

## AgriciDaniel/claude-ads — MIT

- Source: https://github.com/AgriciDaniel/claude-ads
- Copyright (c) 2026 agricidaniel
- Used in: `apps/api/src/ads/rules/*` (Google/Meta ads audit rules).

## danny-avila/LibreChat — MIT

- Source: https://github.com/danny-avila/LibreChat
- Copyright (c) 2026 LibreChat
- Used in: `apps/api/src/llm/` (provider abstraction pattern).

## xandemon/developer-icons — MIT

- Source: https://github.com/xandemon/developer-icons
- Copyright (c) 2024 Sandesh Katwal aka xandemon
- Used in: `apps/web/public/brands/*.svg` via `components/vendor-logo.tsx`.
- The logos are trademarks of their respective owners; the MIT license covers
  the SVG files, not the marks.

## charlie947/social-media-skills — MIT

- Source: https://github.com/charlie947/social-media-skills
- Copyright (c) 2026 Charlie Hills
- Used in: `apps/api/src/_prompts/social-skills/` (see `CREDITS.md` there).

## every-app/open-seo — MIT

- Source: https://github.com/every-app/open-seo
- Copyright (c) 2026 Ben Senescu
- Ported logic: `apps/api/src/analytics/search-opportunity.ts` (GSC × GA4
  search opportunities: candidate filter, page key, percentile components,
  from `SearchOpportunityService`).
- Rules and parameters adopted, code rewritten: `apps/api/src/audit/host-match.ts`,
  `audit/comparable-trend.ts`, `audit/image-alt-check.ts`,
  `sites/image-extract.ts`, `sites/js-shell.ts`.

## rorkai/App-Store-Connect-CLI — MIT

- Source: https://github.com/rorkai/App-Store-Connect-CLI
- Copyright (c) 2026 Rudrank Riyam
- Rules adopted, code rewritten: `apps/api/src/aso/keyword-field-audit.ts`
  (keyword field scan: empty segments, non-canonical separators, duplicates,
  name/subtitle overlap; character-based limit per its issue #1399).

## appeeky/aso-skills — MIT

- Source: https://github.com/appeeky/aso-skills
- Copyright (c) 2026 Erencan
- Rules adopted, code rewritten: `apps/api/src/aso/keyword-field-audit.ts`
  (spaces after commas, singular forms, no "app"/category names);
  `apps/api/src/aso/asc/review-reply.ts` (review-management skill: HEAR reply
  structure — acknowledge, empathize, act, resolve; do not ask users to change
  their rating, offer no incentives, do not be defensive).

## Expo app template (650 Industries) — MIT

- Source: https://github.com/expo/expo (create-expo-app template)
- Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)
- Used in: `mobile/` project scaffolding. (Its `LICENSE` file previously sat in
  `mobile/` and could be misread as the app's own license; the app is
  proprietary.)

## Vincentwei1021/video-shotcraft — Apache-2.0

- Source: https://github.com/Vincentwei1021/video-shotcraft
- Copyright 2026 Wei Yihao
- Used in: `apps/video/src/styles/kit.tsx` (`bezier`, `EASE`, `velocity`, `SpeedBlur`, adapted from `demos/_fixtures/Polish.tsx`;
  changes listed in `apps/video/src/styles/CREDITS.md`). Full license text:
  `apps/video/src/styles/LICENSE-Apache-2.0-video-shotcraft.txt`.

## LemoLab/lemo-opuscar — MIT

- Copyright (c) 2026 LemoLab
- Used in: `apps/video/src/styles/swiss.tsx` (swiss-motion easing constant `cubic-bezier(.7, 0, .2, 1)`; the
  rest of the style is a re-implementation of its techniques).

## oguzhankayan/motion-engine, Manim Community Edition, MoviePy — MIT (techniques only)

- motion-engine: Copyright (c) 2026 Oguzhan Kayan — https://github.com/oguzhankayan/motion-engine
- Manim CE: Copyright (c) 2018 3Blue1Brown LLC; Copyright (c) 2024 the Manim Community Developers — https://github.com/ManimCommunity/manim
- MoviePy: Copyright (c) 2015 Zulko — https://github.com/Zulko/moviepy
- Used in: `apps/video/src/styles/{chat,diagram,footage}.tsx` re-implement techniques from trials built with these
  tools (no source code copied; none of them runs on the server). See `apps/video/src/styles/CREDITS.md`.

---

## MIT License text

Applies to every component above, with that component's copyright line.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
