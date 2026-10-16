import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';

/**
 * Rotayi haftalik AI olcum hakkina baglar (bkz. measurement-allowance.ts).
 *
 * Guard degil interceptor: hakki handler'dan ONCE ayirmak, handler'i
 * AsyncLocalStorage baglaminda calistirmak ve sonuca gore iade etmek gerekiyor;
 * guard yalnizca "once" kismini gorur. Plan kapisi (PlanFeatureGuard) guard
 * oldugu icin bundan once calisir — kilitli plandaki kullanici hak yakmaz.
 */
@Injectable()
export class MeasurementSessionInterceptor implements NestInterceptor {
  // Acik @Inject: decorator metadata'si uretmeyen derleyicilerde (vitest/esbuild) de calissin
  constructor(@Inject(MeasurementAllowanceService) private readonly allowance: MeasurementAllowanceService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest<{ user?: { id?: string; role?: string } }>().user;
    // next.handle() handler'i abone olununca calistirir; abonelik run()'in
    // baglami icinde oldugu icin handler ve alt cagrilari baglami gorur.
    return from(this.allowance.run(user, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }
}

/** `@MeasurementSession()` — kullanici tetikli AI olcum uclari icin */
export const MeasurementSession = () => UseInterceptors(MeasurementSessionInterceptor);
