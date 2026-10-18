import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreatePublishTargetDto, UpdatePublishTargetDto } from './publish-targets.dto.js';
import { PublishTargetsController } from './publish-targets.controller.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('yayin hedefi govdeleri — sinif DTO', () => {
  it('panel formunun govdeleri gecer (credentials/config icerigi hedef tipine gore serbest)', async () => {
    await expect(pipe.transform({
      type: 'WORDPRESS_REST', name: 'Blog', isDefault: true,
      credentials: { siteUrl: 'https://ornek.com', username: 'admin', appPassword: 'abcd efgh' },
      config: { publicBaseUrl: 'https://ornek.com/blog' },
    }, asBody(CreatePublishTargetDto))).resolves.toBeDefined();
    await expect(pipe.transform({ isDefault: true }, asBody(UpdatePublishTargetDto))).resolves.toBeDefined();
    await expect(pipe.transform({ isActive: false }, asBody(UpdatePublishTargetDto))).resolves.toBeDefined();
    await expect(pipe.transform({ name: 'Blog', config: { a: '1' }, isDefault: false }, asBody(UpdatePublishTargetDto))).resolves.toBeDefined();
  });

  it('dize credentials (adres denetimini bos nesneyle gecirirdi), siteId ve yanlis tip 400', async () => {
    await expect(pipe.transform({ type: 'FTP', name: 'x', credentials: 'host=10.0.0.1' }, asBody(CreatePublishTargetDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ type: 'FTP', name: 'x', credentials: {}, siteId: 's-baskasi' }, asBody(CreatePublishTargetDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ type: 'FTP', name: ['x'], credentials: {} }, asBody(CreatePublishTargetDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ isDefault: 'yes' }, asBody(UpdatePublishTargetDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ siteId: 's-baskasi' }, asBody(UpdatePublishTargetDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kimlik temizleme sozlesmesi govdede korunur: icteki null ve bos dize servise aynen ulasir', async () => {
    // null → alani sil, bos dize → kayitli degeri koru (publish-target-credentials.ts)
    const out = await pipe.transform({ credentials: { accessKey: null, apiSecret: '' } }, asBody(UpdatePublishTargetDto));
    expect(out.credentials).toEqual({ accessKey: null, apiSecret: '' });
  });

  it('controller alanlari tek tek gecirir; siteId yalniz yoldan', async () => {
    const create = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const ctl = new PublishTargetsController({ create, update } as any);
    const req = { user: { id: 'u1', role: 'USER' } } as any;
    await ctl.create(req, 's1', { type: 'FTP', name: 'x', credentials: { host: 'h' }, siteId: 's2' } as any);
    expect((create.mock.calls[0] as any)[0]).toBe('s1');
    expect((create.mock.calls[0] as any)[1]).not.toHaveProperty('siteId');
    await ctl.update(req, 't1', { isActive: true, siteId: 's2' } as any);
    expect((update.mock.calls[0] as any)[1]).not.toHaveProperty('siteId');
  });
});
