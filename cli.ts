import * as fs from 'fs';
import * as path from 'path';
import { SwimmingScraper } from "./src/scraper";
import { SwimMeet, ScraperConfig } from "./src/types";
import { updateGoogleSheet } from "./src/sheets";
import { fetchTruroTermDates, isSchoolHoliday } from "./src/truro";

// Configuration for local crawling
const config: ScraperConfig = {
  maxPages: 50,
  parseMode: 'cheerio'
};

// Helper to parse individual date string components
function parseSingleDate(part: string, defaultYear: string): { day: string; month: string; year: string } | null {
  const clean = part.trim().replace(/\s+/g, ' ');
  
  // Try ISO format: YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return { day: isoMatch[3].padStart(2, '0'), month: isoMatch[2].padStart(2, '0'), year: isoMatch[1] };
  }

  // Try slash format: DD/MM/YY or DD/MM/YYYY
  const slashMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const y = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return { day: slashMatch[1].padStart(2, '0'), month: slashMatch[2].padStart(2, '0'), year: y };
  }

  // Try textual format: e.g. "1stJul 2026", "27 July 2026", "1stJul", "27 July"
  const cleanText = clean.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  
  // Match "DD Month YYYY" or "DD Month"
  const textMatch = cleanText.match(/^(\d{1,2})\s*([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0');
    const monthName = textMatch[2].substring(0, 3).toLowerCase();
    const monthsMap: { [key: string]: string } = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const month = monthsMap[monthName] || '01';
    const year = textMatch[3] || defaultYear;
    return { day, month, year };
  }

  return null;
}

// Helper to convert any meet/PB date format into UK date format: DD/MM/YYYY (or ranges of DD/MM/YYYY)
function convertToUKDateFormat(dateStr: string): string {
  if (!dateStr || dateStr.toLowerCase().includes('ongoing') || dateStr.toLowerCase().includes('tbd')) {
    return dateStr;
  }

  const clean = dateStr.replace(/–/g, '-').replace(/—/g, '-').trim();

  // Determine year if present in the string
  const yearMatch = clean.match(/\b(20\d{2})\b/);
  const detectedYear = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  // If there's a range (separated by -), split and parse both sides
  if (clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 2) {
      const p1 = parseSingleDate(parts[0], detectedYear);
      const p2 = parseSingleDate(parts[1], detectedYear);
      if (p1 && p2) {
        const m1 = p1.month === '01' && !parts[0].match(/[A-Za-z]/) ? p2.month : p1.month;
        return `${p1.day}/${m1}/${p1.year} - ${p2.day}/${p2.month}/${p2.year}`;
      }

      // Fallback: If p1 is null but is just a day number (e.g. "27" in "27 - 31 July 2026")
      const day1Match = parts[0].trim().match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
      if (day1Match && p2) {
        const day1 = day1Match[1].padStart(2, '0');
        return `${day1}/${p2.month}/${p2.year} - ${p2.day}/${p2.month}/${p2.year}`;
      }
    }
  }

  const parsed = parseSingleDate(clean, detectedYear);
  if (parsed) {
    return `${parsed.day}/${parsed.month}/${parsed.year}`;
  }

  return dateStr;
}





// Helper to parse the start date of any range or single date for sorting purposes
function getStartDate(dateStr: string): Date {
  if (!dateStr || dateStr.toLowerCase().includes('ongoing') || dateStr.toLowerCase().includes('tbd')) {
    return new Date(9999, 11, 31);
  }

  const clean = dateStr.replace(/–/g, '-').replace(/—/g, '-').trim();
  
  const months: { [key: string]: number } = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const yearMatch = clean.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : 2026;

  let startPart = clean;
  let endPart = clean;
  if (clean.includes('-')) {
    const parts = clean.split('-');
    startPart = parts[0].trim();
    endPart = parts[1].trim();
  }

  const parsePart = (part: string, defaultMonth?: number): Date | null => {
    const norm = part.replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ').trim();
    
    const numMatch = norm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (numMatch) {
      const d = parseInt(numMatch[1], 10);
      const m = parseInt(numMatch[2], 10) - 1;
      let y = numMatch[3] ? parseInt(numMatch[3], 10) : year;
      if (numMatch[3] && numMatch[3].length === 2) y += 2000;
      return new Date(y, m, d);
    }

    const textMatch = norm.match(/^(\d{1,2})\s*([A-Za-z]+)/i);
    if (textMatch) {
      const d = parseInt(textMatch[1], 10);
      const mStr = textMatch[2].toLowerCase();
      if (months[mStr] !== undefined) {
        return new Date(year, months[mStr], d);
      }
    }

    const justDayMatch = norm.match(/^(\d{1,2})$/);
    if (justDayMatch && defaultMonth !== undefined) {
      const d = parseInt(justDayMatch[1], 10);
      return new Date(year, defaultMonth, d);
    }

    return null;
  };

  const endDateObj = parsePart(endPart);
  const defaultMonth = endDateObj ? endDateObj.getMonth() : undefined;

  const startDateObj = parsePart(startPart, defaultMonth);
  return startDateObj || endDateObj || new Date(9999, 11, 31);
}






async function runLocalScraper() {
  console.log("=================================================");
  console.log("      LOCAL SWIM CALENDAR SCAPER CLI INITIALIZED ");
  console.log("=================================================");
  
  const startTime = Date.now();
  const scraper = new SwimmingScraper(config);

  try {
    console.log("[Crawl] Requesting licensed swim meets and school term dates concurrently...");
    
    const [scResult, truroDates] = await Promise.all([
      scraper.scrapeAll(),
      fetchTruroTermDates()
    ]);

    const rawMeets = scResult.meets;


    // Filter meets:
    // 1) Remove where meet type = League, Gala, County, County Championship, Club or Club Champs AND region is not South West
    // 2) Remove where meet type = Disability
    const meets = rawMeets.filter(m => {
      const meetTypeLower = (m.meetType || '').toLowerCase();
      const regionLower = (m.region || '').toLowerCase();

      const targetMeetTypes = ['league', 'gala', 'county', 'county championship', 'club', 'club champs'];
      if (targetMeetTypes.includes(meetTypeLower) && regionLower !== 'south west') {
        return false;
      }

      if (meetTypeLower === 'disability') {
        return false;
      }

      return true;
    });

    // Sort meets: first by date, then region, meet type, course, level, meet name
    meets.sort((a, b) => {
      const dateA = getStartDate(a.date).getTime();
      const dateB = getStartDate(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;

      const regionA = (a.region || '').toLowerCase();
      const regionB = (b.region || '').toLowerCase();
      if (regionA !== regionB) return regionA.localeCompare(regionB);

      const typeA = (a.meetType || '').toLowerCase();
      const typeB = (b.meetType || '').toLowerCase();
      if (typeA !== typeB) return typeA.localeCompare(typeB);

      const courseA = (a.course || '').toLowerCase();
      const courseB = (b.course || '').toLowerCase();
      if (courseA !== courseB) return courseA.localeCompare(courseB);

      const levelA = (a.level || '').toLowerCase();
      const levelB = (b.level || '').toLowerCase();
      if (levelA !== levelB) return levelA.localeCompare(levelB);

      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    console.log(`[Parse] Found ${meets.length} meets.`);

    // 1. Generate meets.json output
    const meetsData = meets.map(m => {
      const startDate = getStartDate(m.date);
      const isHoliday = isSchoolHoliday(startDate, truroDates.terms, truroDates.halfTerms);
      return {
        id: m.id || Math.random().toString(36).substring(2, 9),
        name: m.name,
        date: m.date,
        formattedDate: convertToUKDateFormat(m.date),
        location: m.location,
        region: m.region,
        course: m.course,
        level: m.level,
        meetType: m.meetType,
        isHoliday,
        sourceUrl: m.sourceUrl
      };
    });

    const outputPayload = {
      lastUpdated: new Date().toISOString(),
      meetsCount: meetsData.length,
      meets: meetsData
    };

    const outputPath = path.join(process.cwd(), 'meets.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf8');
    console.log(`[JSON] Saved ${meetsData.length} meets to ${outputPath} successfully!`);

    // 2. Google Sheets Sync (Optional fallback)
    const credentialsPath = path.join(process.cwd(), 'credentials.json');
    const hasCredentials = fs.existsSync(credentialsPath);
    let spreadsheetId = process.env.SPREADSHEET_ID || '';
    const sheetsConfigPath = path.join(process.cwd(), 'sheets_config.json');
    
    if (!spreadsheetId && fs.existsSync(sheetsConfigPath)) {
      try {
        const configData = JSON.parse(fs.readFileSync(sheetsConfigPath, 'utf8'));
        spreadsheetId = configData.spreadsheetId || '';
      } catch (e) {
        console.warn("Failed to parse sheets_config.json:", e);
      }
    }

    if (hasCredentials && spreadsheetId) {
      console.log("[Sheets] Credentials and Spreadsheet ID detected. Starting Google Sheets update...");
      try {
        const meetsHeaders = ['Meet Name', 'Date(s)', 'Course', 'Level', 'Location', 'Region', 'Meet Type', 'School Holiday'];
        const meetsRows = meets.map(m => {
          const startDate = getStartDate(m.date);
          const isHoliday = isSchoolHoliday(startDate, truroDates.terms, truroDates.halfTerms);
          return [
            m.name,
            convertToUKDateFormat(m.date),
            m.course,
            m.level,
            m.location,
            m.region,
            m.meetType,
            isHoliday ? 'Yes' : 'No'
          ];
        });
        console.log(`[Sheets] Overwriting 'Meets' tab with ${meetsRows.length} rows...`);
        await updateGoogleSheet(spreadsheetId, 'Meets', meetsHeaders, meetsRows);
        console.log("[Sheets] Google Sheets update completed successfully! ✨");
      } catch (sheetsErr) {
        console.error("❌ Failed to update Google Sheets:", sheetsErr);
      }
    } else {
      console.log("[Sheets] Skipping Google Sheets update (credentials.json or SPREADSHEET_ID not configured).");
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nLocal run accomplished successfully in ${duration}s! ✨`);
    console.log("=================================================");
  } catch (err) {
    console.error("\n❌ Error during local crawl execution:", err);
    process.exit(1);
  }
}

runLocalScraper();
