import { describe, it, expect } from 'vitest';
import {
  normalizeSchemaType, schemaTypesOf, isOrganizationType, isLocalBusinessType,
  collectTypedNodes, findOrganizationNode, LOCAL_BUSINESS_TYPES, ORGANIZATION_TYPES,
} from './schema-org-types.js';

describe('normalizeSchemaType', () => {
  it('schema.org IRI ve schema: onekini atar, harfe dokunmaz', () => {
    expect(normalizeSchemaType('https://schema.org/Dentist')).toBe('Dentist');
    expect(normalizeSchemaType('http://www.schema.org/HairSalon')).toBe('HairSalon');
    expect(normalizeSchemaType('schema:Restaurant')).toBe('Restaurant');
    expect(normalizeSchemaType('localbusiness')).toBe('localbusiness');
    expect(normalizeSchemaType(42)).toBeNull();
    expect(normalizeSchemaType('   ')).toBeNull();
  });
});

describe('alt tur kumeleri', () => {
  it('Google ornekleri ve sik Turk KOBI turleri LocalBusiness sayilir', () => {
    for (const t of ['BeautySalon', 'HairSalon', 'NailSalon', 'DaySpa', 'Restaurant', 'CafeOrCoffeeShop',
      'Dentist', 'MedicalClinic', 'AutoRepair', 'LegalService', 'RealEstateAgent', 'Store', 'ClothingStore',
      'HomeAndConstructionBusiness', 'Plumber', 'Hotel', 'HealthClub', 'ExerciseGym']) {
      expect(isLocalBusinessType(t), t).toBe(true);
      expect(isOrganizationType(t), t).toBe(true);
    }
  });

  it('Organization alt turleri LocalBusiness degil ama Organization', () => {
    for (const t of ['Corporation', 'EducationalOrganization', 'MedicalOrganization', 'NGO', 'OnlineBusiness', 'OnlineStore', 'SportsTeam']) {
      expect(isOrganizationType(t), t).toBe(true);
      expect(isLocalBusinessType(t), t).toBe(false);
    }
  });

  it('organizasyon olmayan turler disarida', () => {
    for (const t of ['WebSite', 'WebPage', 'Product', 'Person', 'Article', 'Place', 'Thing']) {
      expect(isOrganizationType(t), t).toBe(false);
    }
  });

  it('LocalBusiness kumesi Organization kumesinin alt kumesi', () => {
    for (const t of LOCAL_BUSINESS_TYPES) expect(ORGANIZATION_TYPES.has(t), t).toBe(true);
  });
});

describe('collectTypedNodes', () => {
  it('@graph, dizi ve ic ice publisher dugumlerini toplar; ust duzey once', () => {
    const nodes = collectTypedNodes({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'X', publisher: { '@type': 'Organization', name: 'X Ltd' } },
        { '@type': ['HairSalon', 'LocalBusiness'], name: 'X Kuafor' },
      ],
    });
    expect(nodes.map((n) => schemaTypesOf(n)[0])).toEqual(['WebSite', 'HairSalon', 'Organization']);
  });

  it('dongusel / cok derin yapida patlamaz', () => {
    const a: any = { '@type': 'Thing' };
    a.self = a;
    expect(collectTypedNodes(a).length).toBe(1);
  });
});

describe('findOrganizationNode', () => {
  it('BeautySalon kabul edilir (v2 yalniz Organization|LocalBusiness kabul ediyordu)', () => {
    const m = findOrganizationNode([{ '@type': 'BeautySalon', name: 'S', sameAs: ['https://instagram.com/s', 'https://facebook.com/s'] }]);
    expect(m?.type).toBe('BeautySalon');
    expect(m?.isLocalBusiness).toBe(true);
    expect(m?.sameAsCount).toBe(2);
  });

  it('tur dizisinde genel ust tur yerine spesifik olan raporlanir', () => {
    expect(findOrganizationNode([{ '@type': ['LocalBusiness', 'Dentist'] }])?.type).toBe('Dentist');
  });

  it('birden fazla adayda sameAs en zengini secilir; tekil sameAs metni sayilir', () => {
    const m = findOrganizationNode([
      { '@type': 'Organization', sameAs: 'https://x.com/a' },
      { '@type': 'Corporation', sameAs: ['https://a', 'https://b', ''] },
    ]);
    expect(m?.type).toBe('Corporation');
    expect(m?.sameAsCount).toBe(2);
  });

  it('organizasyon yoksa null', () => {
    expect(findOrganizationNode([{ '@type': 'WebSite' }, { '@type': 'Product' }])).toBeNull();
  });
});
