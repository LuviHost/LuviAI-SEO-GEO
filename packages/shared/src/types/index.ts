export interface Brain {
  brandVoice: BrandVoice;
  personas: Persona[];
  competitors: Competitor[];
  seoStrategy: SeoStrategy;
  glossary: GlossaryItem[];
}

export interface BrandVoice {
  tone: string;
  bannedWords: string[];
  examples: string[];
}

export interface Persona {
  name: string;
  age: string;
  expertise: string;
  searchIntent: string[];
  ctaTarget: string;
}

export interface Competitor {
  name: string;
  url: string;
  strengths: string[];
  weaknesses: string[];
}

export interface SeoStrategy {
  pillars: Pillar[];
  programmatic?: ProgrammaticTemplate[];
}

export interface Pillar {
  url: string;
  name: string;
  clusters: string[];
}

export interface ProgrammaticTemplate {
  name: string;
  variables: string[];
  template: string;
}

export interface GlossaryItem {
  term: string;
  translation: string;
  note?: string;
}

export interface PublishCredentials {
  type: string;
  [key: string]: any;
}

export interface PublishResult {
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  error?: string;
}
