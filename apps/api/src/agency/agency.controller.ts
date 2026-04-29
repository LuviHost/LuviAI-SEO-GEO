import { Body, Controller, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AgencyService } from './agency.service.js';
import { Public } from '../auth/public.decorator.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller('agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  /** GET /agency/overview — agency owner dashboard */
  @Get('overview')
  overview(@Req() req: Request) {
    return this.agency.getOverview(ensureUser(req).id);
  }

  /** POST /agency/invite — yeni client davet (email + invite URL) */
  @Post('invite')
  invite(@Req() req: Request, @Body() body: { email: string; name?: string }) {
    return this.agency.inviteClient(ensureUser(req).id, body.email, body.name);
  }

  /** PATCH /agency/whitelabel */
  @Patch('whitelabel')
  whitelabel(@Req() req: Request, @Body() body: any) {
    return this.agency.updateWhitelabel(ensureUser(req).id, body);
  }

  /** GET /agency/resolve-domain?host=... — Public (frontend rebrand) */
  @Public()
  @Get('resolve-domain')
  resolveDomain(@Query('host') host: string) {
    return this.agency.resolveDomain(host);
  }
}
