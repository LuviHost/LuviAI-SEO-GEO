/**
 * schema.org Organization / LocalBusiness alt turleri — TEK kaynak (saf).
 *
 * NEDEN: AXO org-schema kontrolu yalniz @type === 'Organization' |
 * 'LocalBusiness' kabul ediyordu; BeautySalon, Dentist, Restaurant gibi en
 * dogru alt turu kullanan siteler "Organization yok" diye FAIL aliyordu. Oysa
 * Google en spesifik alt turu ister ("Use the most specific LocalBusiness
 * sub-type possible"):
 *   https://developers.google.com/search/docs/appearance/structured-data/local-business
 * Hiyerarsi schema.org tam tur agacindan (Thing > Organization):
 *   https://schema.org/docs/full.html , https://schema.org/LocalBusiness
 *
 * Birden fazla ebeveyni olan turler (Dentist, Hospital, MedicalClinic,
 * Pharmacy, Physician, HealthClub, SkiResort, AutoPartsStore) kumelerde tek
 * kez durur. Schema/SEO denetimi de bu modulu kullanir.
 */

/** LocalBusiness ve tum alt turleri */
export const LOCAL_BUSINESS_TYPES: ReadonlySet<string> = new Set([
  'LocalBusiness',
  'AnimalShelter', 'ArchiveOrganization', 'ChildCare', 'Dentist', 'DryCleaningOrLaundry',
  'EmploymentAgency', 'InternetCafe', 'Library', 'ProfessionalService', 'RadioStation',
  'RealEstateAgent', 'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'TelevisionStation',
  'TouristInformationCenter', 'TravelAgency',
  // AutomotiveBusiness
  'AutomotiveBusiness', 'AutoBodyShop', 'AutoDealer', 'AutoPartsStore', 'AutoRental', 'AutoRepair',
  'AutoWash', 'GasStation', 'MotorcycleDealer', 'MotorcycleRepair',
  // EmergencyService
  'EmergencyService', 'FireStation', 'Hospital', 'PoliceStation',
  // EntertainmentBusiness
  'EntertainmentBusiness', 'AdultEntertainment', 'AmusementPark', 'ArtGallery', 'Casino',
  'ComedyClub', 'MovieTheater', 'NightClub',
  // FinancialService
  'FinancialService', 'AccountingService', 'AutomatedTeller', 'BankOrCreditUnion', 'InsuranceAgency',
  // FoodEstablishment
  'FoodEstablishment', 'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery',
  'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery',
  // GovernmentOffice
  'GovernmentOffice', 'PostOffice',
  // HealthAndBeautyBusiness
  'HealthAndBeautyBusiness', 'BeautySalon', 'DaySpa', 'HairSalon', 'HealthClub', 'NailSalon', 'TattooParlor',
  // HomeAndConstructionBusiness
  'HomeAndConstructionBusiness', 'Electrician', 'GeneralContractor', 'HVACBusiness', 'HousePainter',
  'Locksmith', 'MovingCompany', 'Plumber', 'RoofingContractor',
  // LegalService
  'LegalService', 'Attorney', 'Notary',
  // LodgingBusiness
  'LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort',
  'SkiResort', 'VacationRental',
  // MedicalBusiness
  'MedicalBusiness', 'Audiology', 'CommunityHealth', 'Dermatology', 'DietNutrition', 'Emergency',
  'Geriatric', 'Gynecologic', 'MedicalClinic', 'CovidTestingFacility', 'Midwifery', 'Nursing',
  'Obstetric', 'Oncologic', 'Ophthalmology', 'Optician', 'Optometric', 'Otolaryngologic',
  'Pediatric', 'Pharmacy', 'Physician', 'IndividualPhysician', 'PhysiciansOffice', 'Physiotherapy',
  'PlasticSurgery', 'Podiatric', 'PrimaryCare', 'Psychiatric', 'PublicHealth',
  // SportsActivityLocation
  'SportsActivityLocation', 'BowlingAlley', 'ExerciseGym', 'GolfCourse', 'PublicSwimmingPool',
  'SportsClub', 'StadiumOrArena', 'TennisComplex',
  // Store
  'Store', 'BikeStore', 'BookStore', 'ClothingStore', 'ComputerStore', 'ConvenienceStore',
  'DepartmentStore', 'ElectronicsStore', 'Florist', 'FurnitureStore', 'GardenStore', 'GroceryStore',
  'HardwareStore', 'HobbyShop', 'HomeGoodsStore', 'JewelryStore', 'LiquorStore', 'MensClothingStore',
  'MobilePhoneStore', 'MovieRentalStore', 'MusicStore', 'OfficeEquipmentStore', 'OutletStore',
  'PawnShop', 'PetStore', 'ShoeStore', 'SportingGoodsStore', 'TireShop', 'ToyStore', 'WholesaleStore',
]);

/** Organization ve tum alt turleri (LocalBusiness agaci dahil) */
export const ORGANIZATION_TYPES: ReadonlySet<string> = new Set([
  'Organization',
  'Airline', 'Consortium', 'Cooperative', 'Corporation', 'FundingScheme', 'GovernmentOrganization',
  'LibrarySystem', 'NGO', 'NewsMediaOrganization', 'PoliticalParty', 'ResearchOrganization',
  'SearchRescueOrganization', 'WorkersUnion',
  'EducationalOrganization', 'CollegeOrUniversity', 'ElementarySchool', 'HighSchool', 'MiddleSchool',
  'Preschool', 'School',
  'MedicalOrganization', 'DiagnosticLab', 'VeterinaryCare',
  'OnlineBusiness', 'OnlineStore', 'OnlineMarketplace',
  'PerformingGroup', 'DanceGroup', 'MusicGroup', 'TheaterGroup',
  'Project', 'FundingAgency', 'ResearchProject',
  'SportsOrganization', 'SportsTeam',
  ...LOCAL_BUSINESS_TYPES,
]);

/** FoodEstablishment ailesi — Google restoran karuseli kurallari icin */
export const FOOD_ESTABLISHMENT_TYPES: ReadonlySet<string> = new Set([
  'FoodEstablishment', 'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery',
  'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery',
]);

/**
 * "schema:Dentist", "https://schema.org/Dentist", "http://schema.org/Dentist"
 * → "Dentist". Tur adlari buyuk/kucuk harf duyarlidir (JSON-LD IRI); Google da
 * "localbusiness" yazimini tanimaz, o yuzden harf donusturmuyoruz.
 */
export function normalizeSchemaType(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = t.trim().replace(/^https?:\/\/(www\.)?schema\.org\//i, '').replace(/^schema:/i, '');
  return s.length > 0 && s.length <= 100 ? s : null;
}

/** Dugumun @type degerleri (dizi ya da tekil), normalize edilmis */
export function schemaTypesOf(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Record<string, unknown>)['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const t of list) {
    const n = normalizeSchemaType(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export const isOrganizationType = (t: string): boolean => ORGANIZATION_TYPES.has(t);
export const isLocalBusinessType = (t: string): boolean => LOCAL_BUSINESS_TYPES.has(t);

/**
 * JSON-LD govdesinden @type tasiyan tum dugumleri toplar: dizi, @graph (ic ice
 * dahil) ve ic ice nesneler (ör. WebSite.publisher → Organization). Ust duzey
 * dugumler once gelir. Derinlik ve dugum sayisi sinirli — dusmanca/bozuk
 * JSON-LD taramayi kilitlemesin.
 */
export function collectTypedNodes(parsed: unknown, maxNodes = 500): any[] {
  const top: any[] = [];
  const nested: any[] = [];
  const seen = new Set<unknown>();

  const visit = (v: unknown, depth: number, isTop: boolean) => {
    if (top.length + nested.length >= maxNodes || depth > 8 || !v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1, isTop);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (obj['@graph'] !== undefined) visit(obj['@graph'], depth + 1, isTop);
    if (obj['@type'] !== undefined) (isTop ? top : nested).push(obj);
    for (const [k, child] of Object.entries(obj)) {
      if (k === '@graph' || k === '@context' || !child || typeof child !== 'object') continue;
      visit(child, depth + 1, false);
    }
  };

  visit(parsed, 0, true);
  return [...top, ...nested];
}

export interface OrganizationMatch {
  node: any;
  /** Dugumun Organization agacindaki en spesifik turu (ör. 'BeautySalon') */
  type: string;
  isLocalBusiness: boolean;
  sameAsCount: number;
}

function sameAsCount(node: any): number {
  const s = node?.sameAs;
  if (Array.isArray(s)) return s.filter((x) => typeof x === 'string' && x.trim()).length;
  return typeof s === 'string' && s.trim() ? 1 : 0;
}

/**
 * Organization (ya da alt turu) dugumu. Birden fazlaysa sameAs'i en zengin
 * olan secilir — kimlik grafigini tasiyan dugum odur.
 */
export function findOrganizationNode(nodes: readonly any[]): OrganizationMatch | null {
  let best: OrganizationMatch | null = null;
  for (const node of nodes) {
    const types = schemaTypesOf(node).filter(isOrganizationType);
    if (types.length === 0) continue;
    // 'Organization' / 'LocalBusiness' genel ust turlerdir; varsa daha spesifik olani raporla
    const specific = types.find((t) => t !== 'Organization' && t !== 'LocalBusiness') ?? types[0];
    const m: OrganizationMatch = {
      node,
      type: specific,
      isLocalBusiness: types.some(isLocalBusinessType),
      sameAsCount: sameAsCount(node),
    };
    if (!best || m.sameAsCount > best.sameAsCount) best = m;
  }
  return best;
}
