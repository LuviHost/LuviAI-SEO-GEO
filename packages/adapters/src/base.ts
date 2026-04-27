export interface PublishPayload {
  slug: string;
  title: string;
  bodyHtml: string;
  bodyMd: string;
  metaTitle?: string;
  metaDescription?: string;
  category?: string;
  heroImageUrl?: string;
  schemaMarkup?: Record<string, any>[];
}

export interface PublishCredentials {
  [key: string]: any;
}

export interface PublishResult {
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  error?: string;
}

export abstract class PublishAdapter {
  constructor(
    protected credentials: PublishCredentials,
    protected config: Record<string, any> = {},
  ) {}

  abstract publish(payload: PublishPayload): Promise<PublishResult>;
  abstract test(): Promise<boolean>; // bağlantı test
}
