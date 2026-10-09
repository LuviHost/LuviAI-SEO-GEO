import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AsoService } from './aso.service.js';

const APP = {
  id: 'app1',
  name: 'Takvimim',
  appStoreId: '123',
  developer: 'LuviHost Teknoloji A.Ş.',
  category: 'Productivity',
  metadata: { ios: { title: 'Takvimim: Günlük Plan', subtitle: 'Ajanda ve hatırlatıcı', primaryGenre: 'Productivity', genres: ['Productivity', 'Business'] } },
};

function make(discover: () => Promise<any[]>) {
  const prisma = { trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue(APP) } };
  const aiAgent = { discoverCompetitors: vi.fn().mockImplementation(discover) };
  return new AsoService(prisma as any, {} as any, {} as any, {} as any, {} as any, aiAgent as any, {} as any);
}

describe('AsoService.auditKeywordField', () => {
  it('kayitli metadata ad/alt baslik/sirket/kategoriyi besler; benzer uygulamalardan rakip adi', async () => {
    const svc = make(async () => [
      { name: 'Todoist: To-Do List & Planner', appId: '1', store: 'IOS' },
      { name: 'Android Only', appId: 'x', store: 'ANDROID' },
    ]);
    const r = await svc.auditKeywordField('app1', { keywords: 'todoist alternatifi,ajanda,günlük,productivity tools' });
    expect(r.context).toMatchObject({
      appName: 'Takvimim: Günlük Plan',
      subtitle: 'Ajanda ve hatırlatıcı',
      companyName: 'LuviHost Teknoloji A.Ş.',
      categoryNames: ['Productivity', 'Business'],
      competitorSource: 'similar',
      competitorCount: 1,
    });
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['COMPETITOR_NAME', 'OVERLAP_NAME', 'OVERLAP_SUBTITLE', 'CATEGORY_TERM']));
  });

  it('rakip kesfi hata verirse denetim yine doner, kaynak "failed"', async () => {
    const svc = make(async () => { throw new Error('iTunes 503'); });
    const r = await svc.auditKeywordField('app1', { keywords: 'planlayıcı' });
    expect(r.context.competitorSource).toBe('failed');
    expect(r.summary.error).toBe(0);
  });

  it('istekle verilen alt baslik ve rakip listesi kayitliyi ezer; checkCompetitors=false kesfi atlar', async () => {
    const discover = vi.fn(async () => []);
    const svc = make(discover);
    const r = await svc.auditKeywordField('app1', { keywords: 'notion şablon', subtitle: 'Yeni alt başlık', competitorNames: ['Notion'] });
    expect(r.context).toMatchObject({ subtitle: 'Yeni alt başlık', competitorSource: 'body' });
    expect(discover).not.toHaveBeenCalled();
    const r2 = await svc.auditKeywordField('app1', { keywords: 'x', checkCompetitors: false });
    expect(r2.context.competitorSource).toBe('skipped');
  });

  it('gecersiz govde → 400', async () => {
    const svc = make(async () => []);
    await expect(svc.auditKeywordField('app1', { keywords: 42 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.auditKeywordField('app1', { keywords: 'a'.repeat(1001) })).rejects.toBeInstanceOf(BadRequestException);
  });
});
