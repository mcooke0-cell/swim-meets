import * as fs from 'fs';
import * as path from 'path';
import { SwimmingScraper } from "./src/scraper";
import { ScraperConfig } from "./src/types";
import { fetchTruroTermDates, isSchoolHoliday } from "./src/truro";
import { MONTH_ABBREV_TO_PAD, MONTH_ABBREV_TO_INDEX } from "./src/constants";

// Configuration for local crawling
const config: ScraperConfig = {
  maxPages: 50
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
  const cleanText = clean.replace(/(\d+)(st|nd|rd|th)/gi, '$1 ');
  
  // Match "DD Month YYYY" or "DD Month"
  const textMatch = cleanText.match(/^(\d{1,2})\s*([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0');
    const monthName = textMatch[2].substring(0, 3).toLowerCase();
    const month = MONTH_ABBREV_TO_PAD[monthName] || '01';
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
  
  const months = MONTH_ABBREV_TO_INDEX;

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
    const norm = part.replace(/(\d+)(st|nd|rd|th)/gi, '$1 ').replace(/\s+/g, ' ').trim();
    
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
    
    const [{ meets: rawMeets }, truroDates] = await Promise.all([
      scraper.scrapeAll(),
      fetchTruroTermDates()
    ]);



    // Filter meets:
    // 1) Remove where meet type = League, Gala, County, County Championship, Club or Club Champs AND region is not South West
    // 2) Remove where meet type = Disability
    // 3) Remove where meet name contains "open water" (case-insensitive)
    // 4) Swim Wales: remove anything that doesn't contain championship, or contains poolside accreditation in the name
    const meets = rawMeets.filter(m => {
      const nameLower = (m.name || '').toLowerCase();
      if (nameLower.includes('open water')) {
        return false;
      }

      const meetTypeLower = (m.meetType || '').toLowerCase();
      const regionLower = (m.region || '').toLowerCase();

      if (m.id?.startsWith('swimwales-') || regionLower === 'wales') {
        if (
          !nameLower.includes('championship') ||
          nameLower.includes('poolside accreditation') ||
          nameLower.includes('club championship') ||
          nameLower.includes('club champ') ||
          nameLower.includes('closed championship') ||
          nameLower.includes('closed champ')
        ) {
          return false;
        }
      }

      const targetMeetTypes = ['league', 'gala', 'county', 'county championship', 'club', 'club champs'];
      if (targetMeetTypes.includes(meetTypeLower) && regionLower !== 'south west') {
        return false;
      }

      if (meetTypeLower === 'disability') {
        return false;
      }

      return true;
    });

    // 5) Deduplicate external calendars (Swim Wales JustGo, Scottish Swimming, and Cornwall iCal)
    // against swimming.org / swimmingresults.org events:
    // Where duplicates are spotted, always retain the swimming.org / swimmingresults.org data.
    const isExternalMeet = (meet: { id?: string }) => {
      const id = meet.id || '';
      return id.startsWith('swimwales-') || id.startsWith('scotswim-') || id.startsWith('ical-');
    };

    const normalizeEventName = (str: string) => {
      return (str || '').toLowerCase()
        .replace(/short course/g, 'sc')
        .replace(/long course/g, 'lc')
        .replace(/carn brea[, &]+helston/g, 'cbhsc')
        .replace(/carn brea/g, 'cbhsc')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const dedupedMeets = meets.filter(m => {
      if (!isExternalMeet(m)) {
        return true;
      }

      const mDate = getStartDate(m.date);
      const mNameNorm = normalizeEventName(m.name);
      const mLocationNorm = normalizeEventName(m.location);
      const mRegionLower = (m.region || '').toLowerCase();

      const hasDuplicate = meets.some(other => {
        if (other.id === m.id || isExternalMeet(other)) {
          return false;
        }

        const otherDate = getStartDate(other.date);
        const diffDays = Math.abs(mDate.getTime() - otherDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 2) {
          return false;
        }

        const otherNameNorm = normalizeEventName(other.name);
        const otherLocationNorm = normalizeEventName(other.location);
        const otherRegionLower = (other.region || '').toLowerCase();

        // 1. Wales (JustGo vs swimming.org)
        if (m.id?.startsWith('swimwales-')) {
          const bothWales = (mNameNorm.includes('wales') || mRegionLower === 'wales') &&
                            (otherNameNorm.includes('wales') || otherRegionLower === 'wales');
          if (bothWales) {
            if (mNameNorm.includes('north') && otherNameNorm.includes('north')) return true;
            if (mNameNorm.includes('west') && otherNameNorm.includes('west')) return true;
            if (
              (mNameNorm.includes('east') && (otherNameNorm.includes('east') || otherNameNorm.includes('south east'))) ||
              (mNameNorm.includes('south east') && otherNameNorm.includes('east'))
            ) return true;
            if (mNameNorm.includes('winter') && otherNameNorm.includes('winter')) return true;
            if (mNameNorm.includes('masters') && otherNameNorm.includes('masters')) return true;
            if (mNameNorm.includes('national') && otherNameNorm.includes('national')) return true;
          }
        }

        // 2. Scotland (Scottish Swimming vs swimming.org)
        if (m.id?.startsWith('scotswim-')) {
          const bothScot = (mNameNorm.includes('scot') || mRegionLower === 'scotland') &&
                           (otherNameNorm.includes('scot') || otherRegionLower === 'scotland');
          if (bothScot) {
            if (mNameNorm.includes('sc') && otherNameNorm.includes('sc')) return true;
            if (mNameNorm.includes('age group') && otherNameNorm.includes('age group')) return true;
            if (mNameNorm.includes('league') && otherNameNorm.includes('league')) return true;
            if (mNameNorm.includes('national') && otherNameNorm.includes('national')) return true;
            if (mNameNorm.includes('championship') && otherNameNorm.includes('championship')) return true;
          }
        }

        // 3. Cornwall (Google Calendar iCal vs swimming.org)
        if (m.id?.startsWith('ical-')) {
          // CBHSC / Carn Brea
          if (mNameNorm.includes('cbhsc') && otherNameNorm.includes('cbhsc')) {
            return true;
          }
          // NCD / Newquay
          if (
            (mNameNorm.includes('newquay') || mNameNorm.includes('ncd')) &&
            (otherNameNorm.includes('newquay') || otherNameNorm.includes('ncd'))
          ) {
            return true;
          }
          // Cornwall County Championships / CCASA
          if (
            (mNameNorm.includes('cornwall') || mNameNorm.includes('ccasa')) &&
            (otherNameNorm.includes('cornwall') || otherNameNorm.includes('ccasa'))
          ) {
            return true;
          }
          // Same Cornwall venue / town and matching meet type/event
          const cornwallTowns = ['bodmin', 'penzance', 'truro', 'redruth', 'helston', 'newquay', 'st austell', 'bude', 'saltash'];
          const sharedTown = cornwallTowns.find(t => mLocationNorm.includes(t) && otherLocationNorm.includes(t));
          if (sharedTown) {
            if (mNameNorm.includes('open') && otherNameNorm.includes('open')) return true;
            if (mNameNorm.includes('invitational') && otherNameNorm.includes('invitational')) return true;
            if (mNameNorm.includes('sprint') && otherNameNorm.includes('sprint')) return true;
            if (mNameNorm.includes('championship') && otherNameNorm.includes('championship')) return true;
          }
        }

        return false;
      });

      return !hasDuplicate;
    });

    // Sort meets: first by date, then region, meet type, course, level, meet name
    dedupedMeets.sort((a, b) => {
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

    console.log(`[Parse] Found ${dedupedMeets.length} meets.`);

    // 1. Generate meets.json output
    const meetsData = dedupedMeets.map(m => {
      const startDate = getStartDate(m.date);
      const isHoliday = isSchoolHoliday(startDate, truroDates.terms, truroDates.halfTerms);
      return {
        id: m.id || Math.random().toString(36).substring(2, 9),
        name: m.name,
        date: m.date,
        formattedDate: convertToUKDateFormat(m.date),
        location: m.location,
        region: (m.region || '').trim().toLowerCase() === 'east midland' ? 'East Midlands' : m.region,
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

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nLocal run accomplished successfully in ${duration}s! ✨`);
    console.log("=================================================");
  } catch (err) {
    console.error("\n❌ Error during local crawl execution:", err);
    process.exit(1);
  }
}

runLocalScraper();
