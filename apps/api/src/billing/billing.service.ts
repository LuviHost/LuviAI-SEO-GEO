import { Injectable } from '@nestjs/common';

@Injectable()
export class BillingService {
  getPlans() {
    return [
      { id: 'starter', price: 499, articles: 10, sites: 1 },
      { id: 'pro', price: 1299, articles: 50, sites: 3 },
      { id: 'agency', price: 3299, articles: 250, sites: 10 },
    ];
  }
}
