import { Injectable } from '@nestjs/common';

/** TODO Faz 2: PayTR iframe API + webhook
 *  Docs: https://dev.paytr.com/iframe-api
 */
@Injectable()
export class PaytrService {
  async createSubscription(userId: string, plan: string) {
    return { token: 'TODO', iframeUrl: 'TODO' };
  }

  async handleWebhook(payload: any) {
    return { ok: true };
  }
}
