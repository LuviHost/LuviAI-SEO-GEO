import { describe, it, expect } from 'vitest';
import { assessMicrosoftAiPreferences, hasNewMicrosoftPreference, microsoftPrefsNeedAttention } from './microsoft-ai-preferences.js';

const page = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;
const assess = (html: string | null, headers: Record<string, string> = {}, robotsText: string | null = null) =>
  assessMicrosoftAiPreferences({ html, headers, robotsText });

describe('Microsoft AI tercihleri — eski NoArchive / NoCache', () => {
  it('meta robots ve meta bingbot sayilir; googlebot sayilmaz', () => {
    expect(assess(page('<meta name="robots" content="index, NoArchive">')).legacy).toEqual(['meta robots: noarchive']);
    expect(assess(page('<meta name="Bingbot" content="nocache">')).legacy).toEqual(['meta bingbot: nocache']);
    expect(assess(page('<meta name="googlebot" content="noarchive">')).legacy).toEqual([]);
  });
  it('X-Robots-Tag: oneksiz ve bingbot oneki sayilir, baska bot oneki sayilmaz', () => {
    expect(assess(null, { 'x-robots-tag': 'noarchive' }).legacy).toEqual(['X-Robots-Tag: noarchive']);
    expect(assess(null, { 'x-robots-tag': 'googlebot: noarchive, bingbot: noindex, nocache' }).legacy).toEqual(['X-Robots-Tag (bingbot): nocache']);
    expect(assess(null, { 'X-Robots-Tag': 'max-snippet: 50, noarchive' }).legacy).toEqual(['X-Robots-Tag: noarchive']);
  });
  it('yeni tercih yoksa eski etiket uyari ister; yeni tercih varsa Microsoft eskisini yok sayar', () => {
    const eski = assess(page('<meta name="robots" content="noarchive">'));
    expect(microsoftPrefsNeedAttention(eski)).toBe(true);
    const ikisi = assess(page('<meta name="robots" content="noarchive"><meta name="Bingbot" content="ai-training:disallow">'));
    expect(hasNewMicrosoftPreference(ikisi)).toBe(true);
    expect(microsoftPrefsNeedAttention(ikisi)).toBe(false);
  });
});

describe('Microsoft AI tercihleri — grounding ve egitim', () => {
  it('meta ve baslikta grounding; en kisitlayici kazanir', () => {
    expect(assess(page('<meta name="Bingbot" content="ai-grounding:disallow">')).grounding).toEqual({ value: 'disallow', source: 'meta bingbot' });
    expect(assess(null, { 'x-robots-tag': 'Bingbot: ai-grounding:disallowextended' }).grounding).toEqual({ value: 'disallowextended', source: 'X-Robots-Tag (bingbot)' });
    expect(assess(page('<meta name="Bingbot" content="ai-grounding:allow">'), { 'x-robots-tag': 'bingbot: ai-grounding:disallow' }).grounding?.value).toBe('disallow');
  });
  it('grounding kapali → uyari; allow → uyari yok', () => {
    expect(microsoftPrefsNeedAttention(assess(page('<meta name="Bingbot" content="ai-grounding:disallowextended">')))).toBe(true);
    expect(microsoftPrefsNeedAttention(assess(page('<meta name="Bingbot" content="ai-grounding:allow">')))).toBe(false);
  });
  it('egitim yasagi tek basina uyari degil (gorunurlugu etkilemez)', () => {
    const p = assess(page('<meta name="Bingbot" content="ai-training:disallow">'));
    expect(p.pageTraining).toEqual({ value: 'disallow', source: 'meta bingbot' });
    expect(microsoftPrefsNeedAttention(p)).toBe(false);
  });
  it('robots.txt __usage_ai-training: tum site, yol bazli; "User-agent: *" egitim tercihi sayilmaz', () => {
    expect(assess(null, {}, 'User-Agent: __usage_ai-training\nDisallow: /\n').robotsTraining).toBe('site');
    expect(assess(null, {}, 'User-agent: *\nAllow: /\n\nUser-Agent: __usage_ai-training\nDisallow: /blog/\n').robotsTraining).toBe('paths');
    expect(assess(null, {}, 'User-Agent: __usage_ai-training\nAllow: /\n').robotsTraining).toBeNull();
    expect(assess(null, {}, 'User-agent: *\nDisallow: /\n').robotsTraining).toBeNull();
  });
  it('hic tercih yok → bos sonuc, uyari yok', () => {
    const p = assess(page('<meta name="robots" content="index, follow">'), {}, 'User-agent: *\nAllow: /\n');
    expect(p).toEqual({ legacy: [], grounding: null, pageTraining: null, robotsTraining: null });
    expect(microsoftPrefsNeedAttention(p)).toBe(false);
  });
});
