import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PromptsService, CreatePromptDto } from './prompts.service.js';

interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

function userId(req: AuthedRequest): string {
  if (!req.user?.id) throw new Error('Unauthenticated');
  return req.user.id;
}

@Controller('prompts')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  /** GET /prompts — kullanıcının ve public promptları */
  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query('siteId') siteId?: string,
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('mine') mine?: string,
    @Query('publicOnly') publicOnly?: string,
  ) {
    return this.prompts.list(userId(req), {
      siteId,
      category,
      q,
      mine: mine === 'true' || mine === '1',
      publicOnly: publicOnly === 'true' || publicOnly === '1',
    });
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.prompts.getOne(id, userId(req));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreatePromptDto) {
    return this.prompts.create(userId(req), body);
  }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Partial<CreatePromptDto>) {
    return this.prompts.update(id, userId(req), body);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.prompts.remove(id, userId(req));
  }

  @Post(':id/use')
  use(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { variables: Record<string, string> }) {
    return this.prompts.use(id, userId(req), body.variables ?? {});
  }

  @Post(':id/upvote')
  upvote(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.prompts.upvote(id, userId(req));
  }

  @Post(':id/clone')
  clone(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.prompts.clone(id, userId(req));
  }

  @Post('seed-defaults')
  seed(@Req() req: AuthedRequest) {
    return this.prompts.seedDefaults(userId(req));
  }
}
