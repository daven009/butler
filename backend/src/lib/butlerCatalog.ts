export interface CatalogListing {
  id: string;
  name: string;
  unit: string;
  price: string;
  priceValue: number;
  bed: string;
  bedrooms: number;
  propertyType: string;
  area: string;
  mrt: string;
  mrtStation: string;
  schoolZones: string[];
  petFriendly?: boolean;
  southFacing?: boolean;
  renovated?: boolean;
  highFloor?: boolean;
  commuteDrive?: Record<string, number>;
  tags: string[];
  agent: string;
  phone: string;
  listingUrl?: string;
  cluster: number;
  color: string;
}

export const catalogListings: CatalogListing[] = [
  {
    id: 'L1',
    name: 'Tampines Trilliant',
    unit: '#05-11',
    price: 'S$3,400',
    priceValue: 3400,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'Condo',
    area: 'Tampines',
    mrt: 'Tampines · 4min',
    mrtStation: 'Tampines',
    schoolZones: ['Angsana Primary 1km'],
    petFriendly: true,
    southFacing: true,
    commuteDrive: { 'one-north': 38 },
    tags: ['Pet-friendly', 'Angsana Pri 1km', 'South-facing'],
    agent: 'Rachel Ng',
    phone: '+65 9222 2222',
    cluster: 0,
    color: '#E07A5F'
  },
  {
    id: 'L2',
    name: 'Tampines Court',
    unit: '#12-08',
    price: 'S$3,250',
    priceValue: 3250,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'HDB',
    area: 'Tampines',
    mrt: 'Tampines · 7min',
    mrtStation: 'Tampines',
    schoolZones: ['Angsana Primary 1km'],
    renovated: true,
    commuteDrive: { 'one-north': 40 },
    tags: ['Angsana Pri 1km', 'Renovated'],
    agent: 'Kenneth Soh',
    phone: '+65 9333 3333',
    cluster: 0,
    color: '#E07A5F'
  },
  {
    id: 'L3',
    name: 'Bedok Residences',
    unit: '#09-22',
    price: 'S$3,600',
    priceValue: 3600,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'Condo',
    area: 'Bedok',
    mrt: 'Bedok · 2min',
    mrtStation: 'Bedok',
    schoolZones: [],
    highFloor: true,
    commuteDrive: { 'one-north': 35 },
    tags: ['High floor', 'Sea view'],
    agent: 'Sarah Lim',
    phone: '+65 9444 4444',
    cluster: 1,
    color: '#4C8577'
  },
  {
    id: 'L4',
    name: 'Bedok Grove',
    unit: '#03-05',
    price: 'S$3,150',
    priceValue: 3150,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'HDB',
    area: 'Bedok',
    mrt: 'Bedok · 6min',
    mrtStation: 'Bedok',
    schoolZones: [],
    petFriendly: true,
    renovated: true,
    commuteDrive: { 'one-north': 34 },
    tags: ['Pet-friendly', 'Renovated'],
    agent: 'James Wong',
    phone: '+65 9555 5555',
    cluster: 1,
    color: '#4C8577'
  },
  {
    id: 'L5',
    name: 'Queenstown View',
    unit: '#03-08',
    price: 'S$3,500',
    priceValue: 3500,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'HDB',
    area: 'Queenstown',
    mrt: 'Queenstown · 3min',
    mrtStation: 'Queenstown',
    schoolZones: ['Nanyang Primary 1km'],
    petFriendly: true,
    commuteDrive: { 'one-north': 18 },
    tags: ['Nanyang Pri 1km', 'one-north 18min', 'Pet-friendly'],
    agent: 'Priya Menon',
    phone: '+65 9666 6666',
    cluster: 2,
    color: '#4A6F8C'
  },
  {
    id: 'L6',
    name: 'Commonwealth Towers',
    unit: '#18-04',
    price: 'S$3,800',
    priceValue: 3800,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'Condo',
    area: 'Queenstown',
    mrt: 'Queenstown · 5min',
    mrtStation: 'Queenstown',
    schoolZones: [],
    petFriendly: true,
    highFloor: true,
    commuteDrive: { 'one-north': 12 },
    tags: ['Pool view', 'High floor', 'Pet-friendly'],
    agent: 'Daniel Koh',
    phone: '+65 9777 7777',
    cluster: 2,
    color: '#4A6F8C'
  },
  {
    id: 'L7',
    name: 'Bishan Loft',
    unit: '#10-03',
    price: 'S$3,000',
    priceValue: 3000,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'HDB',
    area: 'Bishan',
    mrt: 'Bishan · 6min',
    mrtStation: 'Bishan',
    schoolZones: ['Nanyang Primary 1km'],
    petFriendly: true,
    commuteDrive: { 'one-north': 29 },
    tags: ['Pet-friendly', 'Nanyang Pri 1km', 'one-north 29min'],
    agent: 'Melissa Yeo',
    phone: '+65 9888 1111',
    cluster: 3,
    color: '#8E6C88'
  },
  {
    id: 'L8',
    name: 'Sky Vue Residences',
    unit: '#15-07',
    price: 'S$3,350',
    priceValue: 3350,
    bed: '3BR',
    bedrooms: 3,
    propertyType: 'Condo',
    area: 'Bishan',
    mrt: 'Bishan · 4min',
    mrtStation: 'Bishan',
    schoolZones: ['Nanyang Primary 1km'],
    highFloor: true,
    commuteDrive: { 'one-north': 26 },
    tags: ['High floor', 'Nanyang Pri 1km'],
    agent: 'Alicia Tan',
    phone: '+65 9888 2222',
    listingUrl: 'https://www.propertyguru.com.sg/property-for-rent?market=residential&listing_type=rent&freetext=Sky%20Vue%20Residences',
    cluster: 3,
    color: '#8E6C88'
  }
];
