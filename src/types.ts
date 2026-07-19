export interface SwimMeet {
  id: string;
  name: string;
  date: string;
  location: string;
  region: string;
  course: string; // e.g. "Short Course (25m)", "Long Course (50m)"
  level: string; // e.g. "Level 1", "Level 2", etc.
  meetType: string; // e.g. "Open Meet", "Club Champs"
  scrapedAt: string;
  sourceUrl?: string;
}


export interface ScrapeLog {
  timestamp: string;
  success: boolean;
  pagesScraped: number;
  itemsFound: number;
  durationMs: number;
  method: 'cheerio';
  error?: string;
}

export interface ScraperConfig {
  maxPages: number;
  parseMode: 'cheerio';
}

