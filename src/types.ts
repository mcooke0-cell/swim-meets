export interface Meet {
  id: string;
  name: string;
  venue: string;
  course: 'Short Course' | 'Long Course' | 'Open Water' | 'Unknown';
  dateStart: string;
  dateEnd: string;
  county: string;
  country: string;
  promoter: string;
  level: string;
  closingDate?: string;
  url?: string;
  schedule?: string;
  isNational: boolean;
  isRegional: boolean;
  isCounty: boolean;
  source: 'swimming.org' | 'cornwall' | 'scotland' | 'wales';
}

export interface ScraperResult {
  meets: Meet[];
  scrapedAt: string;
  stats: {
    total: number;
    byCountry: Record<string, number>;
  };
}
