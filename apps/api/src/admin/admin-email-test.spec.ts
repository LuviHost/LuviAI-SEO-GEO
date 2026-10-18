import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { EmailTestDto } from './admin.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('admin e-posta testi govdesi', () => {
  it('dize olmayan alici, bicim disi sablon ve bilinmeyen alan 400', async () => {
    await expect(pipe.transform({ to: ['a@b.co'] }, asBody(EmailTestDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ to: 'a@b.co', template: '../../etc/passwd' }, asBody(EmailTestDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ to: 'a@b.co', data: { x: 1 } }, asBody(EmailTestDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gecerli govde gecer', async () => {
    await expect(pipe.transform({ to: 'a@b.co', template: 'weekly_report', name: 'Ayşe' }, asBody(EmailTestDto))).resolves.toBeDefined();
  });
});
