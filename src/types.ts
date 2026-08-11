export interface SwimMeet {
  id: string;
  name: string;
  date: string;
  formattedDate?: string;
  location: string;
  region: string; // e.g. "South West", "London", "North East", "Wales", "Scotland", "GB"
  course: string; // e.g. "Short Course (25m)", "Long Course (50m)", "Unknown"
  level: string;  // e.g. "Level 1", "Level 2", "Level 3", "Level 4", "Unknown"
  meetType: string; // e.g. "Open Meet", "County Championship", "National", "Masters", "Unknown"
  isHoliday?: boolean;
  scrapedAt: string;
  sourceUrl?: string;
}

export interface ScraperConfig {
  maxPages: number;
}
