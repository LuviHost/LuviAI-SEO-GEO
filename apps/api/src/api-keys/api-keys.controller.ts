import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string };
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@Req() req: Request) {
    return this.keys.list(ensureUser(req).id);
  }

  @Post()
  create(@Req() req: Request, @Body() body: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) {
    return this.keys.create(ensureUser(req).id, body);
  }

  @Delete(':id')
  revoke(@Req() req: Request, @Param('id') id: string) {
    return this.keys.revoke(ensureUser(req).id, id);
  }
}
