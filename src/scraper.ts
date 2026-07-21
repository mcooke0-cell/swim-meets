import * as cheerio from 'cheerio';
import { SwimMeet, ScrapeLog, ScraperConfig } from './types';

export class SwimmingScraper {
  private config: ScraperConfig = {
    maxPages: 3,
    parseMode: 'cheerio'
  };



  constructor(config?: Partial<ScraperConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  // Fetch HTML page with realistic headers and optional timeout
  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(15000) // 15s timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: HTTP status ${response.status}`);
    }
    return await response.text();
  }

  // Clean meet name - drop the licence number appearing at the end
  public cleanMeetName(rawName: string): string {
    let cleanName = rawName.replace(/\s+/g, ' ').trim();
    // Licence number format at the end: e.g. " - 4WM261286" or " 4WM261286"
    // Standard format: [0-9][A-Za-z]{2}\d+
    cleanName = cleanName.replace(/\s*-\s*\d[A-Za-z]{2}\d+$/i, '').trim();
    cleanName = cleanName.replace(/\s+\d[A-Za-z]{2}\d+$/i, '').trim();
    return cleanName;
  }

  // Parses an event date string into a Date object representing the end date of the event
  public getEventEndDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Normalize string
    const cleanStr = dateStr
      .replace(/\s+/g, ' ')
      .replace(/–/g, '-')
      .replace(/—/g, '-')
      .trim();

    // If there's a range, split and take the last part (end date of event)
    const parts = cleanStr.split('-');
    const lastPart = parts[parts.length - 1].trim();

    // Find year
    const yearMatch = lastPart.match(/\b(20\d{2})\b/) || cleanStr.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    // Find month
    const MONTHS_MAP: { [key: string]: number } = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11
    };
    const MONTHS_KEYS = Object.keys(MONTHS_MAP).sort((a, b) => b.length - a.length);

    let monthIdx = -1;
    const lastPartLower = lastPart.toLowerCase();
    for (const key of MONTHS_KEYS) {
      if (lastPartLower.includes(key)) {
        monthIdx = MONTHS_MAP[key];
        break;
      }
    }

    if (monthIdx === -1) {
      const cleanStrLower = cleanStr.toLowerCase();
      for (const key of MONTHS_KEYS) {
        if (cleanStrLower.includes(key)) {
          monthIdx = MONTHS_MAP[key];
          break;
        }
      }
    }

    if (monthIdx === -1) {
      return null;
    }

    // Find day of the month
    const numbers = lastPart.match(/\d+/g) || [];
    const otherNumbers = numbers.filter(n => parseInt(n, 10) !== year);

    let day: number;
    if (otherNumbers.length > 0) {
      day = parseInt(otherNumbers[otherNumbers.length - 1], 10);
    } else {
      const allNumbers = cleanStr.match(/\d+/g) || [];
      const allOtherNumbers = allNumbers.filter(n => parseInt(n, 10) !== year);
      if (allOtherNumbers.length > 0) {
        day = parseInt(allOtherNumbers[allOtherNumbers.length - 1], 10);
      } else {
        day = new Date(year, monthIdx + 1, 0).getDate();
      }
    }

    return new Date(year, monthIdx, day);
  }

  // Filters out events that are dated before today's date, or have unknown/tbd/unparseable dates
  public filterOlderThanToday(meets: SwimMeet[]): SwimMeet[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return meets.filter(m => {
      const endDate = this.getEventEndDate(m.date);
      if (endDate === null) {
        return false;
      }
      return endDate >= today;
    });
  }

  // Deconstruct concatenated region strings into separate fields: region, course, level, meetType
  public deconstructConcatenatedFields(inputText: string): {
    region: string;
    course: string;
    level: string;
    meetType: string;
  } {
    let region = "";
    let course = "";
    let level = "";
    let meetType = "";

    const text = inputText.replace(/\s+/g, ' ').trim();
    const textLower = text.toLowerCase();

    // 1. Detect Level: look for lvl, level, l + space + digit
    const levelMatch = text.match(/(?:level|lvl|l)\s*([1-4])/i);
    if (levelMatch) {
      level = `Level ${levelMatch[1]}`;
    } else {
      // Look for individual numbers 1 to 4 surrounded by boundaries
      const digitMatch = text.match(/\b([1-4])\b/);
      if (digitMatch) {
        level = `Level ${digitMatch[1]}`;
      }
    }

    // 2. Detect Course
    if (textLower.includes('50m') || textLower.includes('long course') || textLower.includes(' lc ') || textLower.endsWith(' lc') || textLower.startsWith('lc ')) {
      course = "Long Course (50m)";
    } else if (textLower.includes('25m') || textLower.includes('short course') || textLower.includes(' sc ') || textLower.endsWith(' sc') || textLower.startsWith('sc ')) {
      course = "Short Course (25m)";
    }

    // 3. Detect Region
    const regionMap: { [key: string]: string } = {
      'east midlands': 'East Midlands',
      'East Midland': 'East Midlands',
      'west midlands': 'West Midlands',
      'london': 'London',
      'north east': 'North East',
      'north west': 'North West',
      'south east': 'South East',
      'south west': 'South West',
      'east region': 'East',
      'yorkshire': 'Yorkshire',
      'scotland': 'Scotland',
      'wales': 'Wales',
    };

    for (const [key, value] of Object.entries(regionMap)) {
      if (textLower.includes(key)) {
        region = value;
        break;
      }
    }

    if (!region) {
      const tokens = text.split(/[\/\s,\-\|]+/);
      const abbrevMap: { [key: string]: string } = {
        'EM': 'East Midlands',
        'WM': 'West Midlands',
        'LO': 'London',
        'NE': 'North East',
        'NW': 'North West',
        'SE': 'South East',
        'SW': 'South West',
        'ER': 'East',
        'YO': 'Yorkshire',
        'SCO': 'Scotland',
        'WAL': 'Wales'
      };
      for (const token of tokens) {
        const cleanToken = token.toUpperCase().trim();
        if (abbrevMap[cleanToken]) {
          region = abbrevMap[cleanToken];
          break;
        }
      }
    }

    // 4. Detect Meet Type
    if (textLower.includes('club champ') || textLower.includes('club championship')) {
      meetType = "Club Champs";
    } else if (textLower.includes('open meet') || textLower.includes('open')) {
      meetType = "Open Meet";
    } else if (textLower.includes('league')) {
      meetType = "League";
    } else if (textLower.includes('county')) {
      meetType = "County Championship";
    } else if (textLower.includes('national')) {
      meetType = "National Meet";
    }

    return {
      region: region || "Unknown",
      course: course || "Unknown",
      level: level || "Unknown",
      meetType: meetType || "Unknown"
    };
  }

  // Clean town/city string to remove any concatenated labels/values
  public cleanTownCity(val: string): string {
    let clean = val.replace(/\s+/g, ' ').trim();
    // Strip trailing strings matching common header fields or labels appearing in details boxes
    // e.g. "EveshamLevel:4" -> "Evesham", "LondonLevel:4" -> "London", "ManchesterLevel 3" -> "Manchester"
    clean = clean.replace(/(?:Level|Course|Region|Number|Contact|Email)[:\s\d-]+.*$/i, '').trim();
    return clean;
  }


  // Fetch meet details Town/City from licensing meet page
  public async fetchTownCity(detailUrl: string): Promise<string | null> {
    try {
      const response = await fetch(detailUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) return null;
      const html = await response.text();
      const $ = cheerio.load(html);

      // Special override for swimming.org details page
      if (detailUrl.includes('swimming.org')) {
        const addressEl = $('p.address');
        if (addressEl.length > 0) {
          const htmlContent = addressEl.html() || '';
          const parts = htmlContent.split(/<br\s*\/?>/i).map(x => cheerio.load(x).text().trim()).filter(Boolean);
          if (parts.length >= 3) {
            const lastPart = parts[parts.length - 1];
            const hasPostcode = /[A-Z0-9]{2,4}\s?[A-Z0-9]{3}/i.test(lastPart);
            if (hasPostcode && parts.length >= 3) {
              return parts[parts.length - 3];
            } else {
              return parts[parts.length - 2];
            }
          } else if (parts.length > 0) {
            return parts[0];
          }
        }
      }

      let townCity: string | null = null;

      // 1. Check description list structure <dl> <dt>Town/City:</dt> <dd>Value</dd>
      $('dt').each((_, el) => {
        const text = $(el).text().replace(/:/g, '').trim().toLowerCase();
        if (text === 'town/city' || text === 'town / city' || text.includes('town/city') || text.includes('town or city') || text === 'town' || text === 'city') {
          const nextD = $(el).next('dd');
          if (nextD.length > 0) {
            const rawVal = nextD.text();
            const val = this.cleanTownCity(rawVal);
            if (val && val.length > 1 && val.length < 50 && !val.toLowerCase().includes('level')) {
              townCity = val;
              return false; // Break
            }
          }
        }
      });

      if (townCity) return townCity;

      // 2. Fallback check in table cells or generic elements
      $('td, th, span, div, p').each((_, el) => {
        const text = $(el).text().replace(/:/g, '').trim().toLowerCase();
        if (text === 'town/city' || text === 'town / city' || text.includes('town/city') || text.includes('town or city') || text === 'town' || text === 'city') {
          // If the text itself has the value like "Town/City: London" inside a single element
          const directText = $(el).text().replace(/\s+/g, ' ').trim();
          const pmatch = directText.match(/(?:Town\/City|Town\s+or\s+City|Town|City)\s*:\s*([^:\r\n]+)/i);
          if (pmatch && pmatch[1]) {
            const val = this.cleanTownCity(pmatch[1]);
            if (val && val.length > 1 && val.length < 50 && !val.toLowerCase().includes('level')) {
              townCity = val;
              return false;
            }
          }

          const nextCell = $(el).next();
          if (nextCell.length > 0) {
            const val = this.cleanTownCity(nextCell.text());
            if (val && val.length > 1 && val.length < 50 && !val.toLowerCase().includes('level')) {
              townCity = val;
              return false; // Break
            }
          }
          const parentTr = $(el).closest('tr');
          if (parentTr.length > 0) {
            const cells = parentTr.find('td');
            if (cells.length >= 2) {
              const val = this.cleanTownCity($(cells[1]).text());
              if (val && val.length > 1 && val.length < 50 && !val.toLowerCase().includes('level')) {
                townCity = val;
                return false;
              }
            }
          }
        }
      });

      if (townCity) return townCity;

      // 3. Spaced boundary fallback line-by-line parsing to avoid element-merging issues (e.g. "EveshamLevel:4")
      const lines = html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length - 1; i++) {
        const lineClean = lines[i].replace(/:/g, '').trim().toLowerCase();
        if (lineClean === 'town/city' || lineClean === 'town or city' || lineClean === 'town' || lineClean === 'city') {
          const nextVal = this.cleanTownCity(lines[i + 1]);
          if (nextVal && !nextVal.includes(':') && nextVal.length > 1 && nextVal.length < 50 && !nextVal.toLowerCase().includes('level')) {
            return nextVal;
          }
        }
      }

      return null;
    } catch (err) {
      console.warn(`Failed fetching subpage details from ${detailUrl}:`, err);
      return null;
    }
  }

  // Dynamic selector-free table parser
  public parseWithCheerio(html: string, baseUrl: string): SwimMeet[] {
    const $ = cheerio.load(html);
    const meets: SwimMeet[] = [];

    // Find all tables on the page
    $('table').each((tableIdx, tableEl) => {
      const rows = $(tableEl).find('tr');
      if (rows.length < 2) return;

      // Scan rows to discover headers fuzzy-matching our columns
      let dateIdx = -1;
      let nameIdx = -1;
      let locationIdx = -1;
      let regionIdx = -1;
      let courseIdx = -1;
      let levelIdx = -1;
      let typeIdx = -1;

      // Inspect first few rows to look for header strings
      const headerRowsToCheck = Math.min(rows.length, 3);
      for (let r = 0; r < headerRowsToCheck; r++) {
        const cells = $(rows[r]).find('th, td');
        cells.each((cIdx, cellEl) => {
          const text = $(cellEl).text().trim().toLowerCase();

          if (text.includes('date') || text.includes('when')) dateIdx = cIdx;
          else if (text.includes('meet name') || text.includes('licensed meet') || (text.includes('meet') && text.includes('name')) || text.includes('title')) nameIdx = cIdx;
          else if (text.includes('location') || text.includes('venue') || text.includes('pool') || text.includes('address')) locationIdx = cIdx;
          else if (text.includes('region') || text.includes('county') || text.includes('county/region') || text.includes('assoc')) regionIdx = cIdx;
          else if (text.includes('course') || text.includes('pool size') || text.includes('length')) courseIdx = cIdx;
          else if (text.includes('level') || text.includes('grade')) levelIdx = cIdx;
          else if (text.includes('type') || text.includes('category') || text.includes('classification')) typeIdx = cIdx;
        });

        // If we matched at least 3 indicators, we identified the table!
        if (dateIdx !== -1 && nameIdx !== -1 && (courseIdx !== -1 || levelIdx !== -1)) {
          break; // Found headers, stop checking alternate header rows
        }
      }

      // Fallback: If no headers were matched explicitly, let's map columns by a standard default
      if (dateIdx === -1 || nameIdx === -1) {
        const sampleCells = $(rows[Math.min(rows.length - 1, 2)]).find('td');
        if (sampleCells.length >= 5) {
          dateIdx = 0;
          levelIdx = 1;
          courseIdx = 2;
          regionIdx = 3;
          nameIdx = 4;
          locationIdx = 5;
          typeIdx = 6;
        } else {
          return;
        }
      }

      // Loop through data rows (skip the detected header rows)
      rows.each((rIdx, rowEl) => {
        const thCount = $(rowEl).find('th').length;
        if (thCount > 0 || rIdx === 0) return;

        const cells = $(rowEl).find('td');
        if (cells.length < 4) return;

        const date = dateIdx !== -1 && dateIdx < cells.length ? $(cells[dateIdx]).text().trim() : '';
        const rawName = nameIdx !== -1 && nameIdx < cells.length ? $(cells[nameIdx]).text().trim() : '';
        const location = locationIdx !== -1 && locationIdx < cells.length ? $(cells[locationIdx]).text().trim() : 'Unknown Venue';
        const rawRegionCell = regionIdx !== -1 && regionIdx < cells.length ? $(cells[regionIdx]).text().trim() : '';
        const course = courseIdx !== -1 && courseIdx < cells.length ? $(cells[courseIdx]).text().trim() : '';
        const level = levelIdx !== -1 && levelIdx < cells.length ? $(cells[levelIdx]).text().trim() : '';
        const meetType = typeIdx !== -1 && typeIdx < cells.length ? $(cells[typeIdx]).text().trim() : '';

        // Extract meet details link to fetch individual Town/City next step
        let sourceUrl = '';
        const anchor = $(cells[nameIdx]).find('a');
        if (anchor.length > 0) {
          const href = anchor.attr('href') || '';
          if (href) {
            sourceUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
          }
        } else {
          $(rowEl).find('a').each((_, aEl) => {
            const h = $(aEl).attr('href') || '';
            const text = $(aEl).text().toLowerCase();
            if (h && (text.includes('info') || text.includes('website') || text.includes('link') || text.includes('view') || text.includes('meet'))) {
              sourceUrl = h.startsWith('http') ? h : new URL(h, baseUrl).toString();
            }
          });
        }

        // Clean meet name
        const cleanName = this.cleanMeetName(rawName);
        if (!cleanName || cleanName.toLowerCase() === 'meet name' || cleanName.length < 3) return;

        let finalRegion = 'Unknown';
        let finalCourse = 'Unknown';
        let finalLevel = 'Unknown';
        let finalMeetType = 'Unknown';

        // Check if we have a table with Region/Level combined column
        // We look for cells[regionIdx] or cells[3] as combined Cell
        const combinedCellIdx = (regionIdx !== -1) ? regionIdx : 3;
        const regionCell = combinedCellIdx < cells.length ? $(cells[combinedCellIdx]) : null;

        if (regionCell && (regionCell.html() || '').includes('<br')) {
          const html = regionCell.html() || '';
          const textWithNewlines = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
          const parts = textWithNewlines.split('\n').map(p => p.trim()).filter(Boolean);

          if (parts[0]) {
            finalRegion = parts[0].replace(/\s+Region\b/i, '').trim();
          }
          if (parts[1]) {
            const courseL = parts[1].toLowerCase();
            if (courseL.includes('short') || courseL.includes('25')) {
              finalCourse = 'Short Course (25m)';
            } else if (courseL.includes('long') || courseL.includes('50')) {
              finalCourse = 'Long Course (50m)';
            } else {
              finalCourse = parts[1];
            }
          }
          if (parts[2]) {
            finalLevel = parts[2];
          }
          if (parts[3]) {
            finalMeetType = parts[3];
          }
        } else {
          // Fallback if there are separate columns or clean text
          const rawRegionCell = regionIdx !== -1 && regionIdx < cells.length ? $(cells[regionIdx]).text().trim() : '';
          const courseVal = courseIdx !== -1 && courseIdx < cells.length ? $(cells[courseIdx]).text().trim() : '';
          const levelVal = levelIdx !== -1 && levelIdx < cells.length && levelIdx !== regionIdx ? $(cells[levelIdx]).text().trim() : '';
          const typeVal = typeIdx !== -1 && typeIdx < cells.length ? $(cells[typeIdx]).text().trim() : '';

          finalRegion = rawRegionCell.replace(/\s+Region\b/i, '').trim() || 'Unknown';

          if (courseVal) {
            const courseL = courseVal.toLowerCase();
            if (courseL.includes('25') || courseL.includes('short') || courseL.includes('sc')) {
              finalCourse = 'Short Course (25m)';
            } else if (courseL.includes('50') || courseL.includes('long') || courseL.includes('lc')) {
              finalCourse = 'Long Course (50m)';
            } else {
              finalCourse = courseVal;
            }
          }

          finalLevel = levelVal || 'Unknown';
          finalMeetType = typeVal || 'Unknown';

          // If the region cell was actually concatenated but didn't have br
          if (rawRegionCell.includes('/') || rawRegionCell.split(' ').length > 2 || !rawRegionCell) {
            const deconstructed = this.deconstructConcatenatedFields(rawRegionCell || cleanName);
            if (deconstructed.region) finalRegion = deconstructed.region;
            if (deconstructed.course) finalCourse = deconstructed.course;
            if (deconstructed.level) finalLevel = deconstructed.level;
            if (deconstructed.meetType) finalMeetType = deconstructed.meetType;
          }
        }

        const id = `${cleanName}-${date}`.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

        const finalLocation = location || 'Unknown Venue';

        meets.push({
          id,
          name: cleanName,
          date: date || 'Ongoing/TBD',
          location: finalLocation,
          region: finalRegion || 'England',
          course: finalCourse,
          level: finalLevel,
          meetType: finalMeetType,
          scrapedAt: new Date().toISOString()
        } as any);

        // Keep temporary link on object for scraper pipeline details fetching
        if (sourceUrl) {
          (meets[meets.length - 1] as any).sourceUrl = sourceUrl;
        }
      });
    });

    return meets;
  }



  public async fetchAboutPageNationalEvents(): Promise<SwimMeet[]> {
    const urls = [
      'https://www.swimming.org/sport/about-the-national-summer-meet/',
      'https://www.swimming.org/sport/about-the-national-winter-championships/',
      'https://www.swimming.org/sport/about-the-national-county-team-championships/'
    ];

    const meets: SwimMeet[] = [];

    await Promise.all(urls.map(async (url) => {
      try {
        console.log(`[Scraper] Retrieving event from about-page: ${url}`);
        const html = await this.fetchPage(url);
        const $ = cheerio.load(html);

        // Remove script, style, head, header, footer, etc.
        $('script, style, head, header, footer, nav, svg, form, iframe, noscript').remove();

        const lines = $('body').html()
          ?.replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>|<\/div>|<\/li>|<\/h1>|<\/h2>|<\/h3>|<\/h4>|<\/tr>/gi, '\n')
          .replace(/<[^>]+>/g, '\n')
          .split('\n')
          .map(l => l.replace(/\xA0/g, ' ').trim())
          .filter(Boolean) || [];

        let name = '';
        let rawDate = '';
        let rawVenue = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim().toLowerCase().replace(/:$/, '');

          if (line === 'event') {
            if (i + 1 < lines.length) {
              name = lines[i + 1].replace(/^:\s*/i, '').trim();
            }
          }
          if (line === 'when' || line === 'date') {
            if (i + 1 < lines.length) {
              rawDate = lines[i + 1].replace(/^:\s*/i, '').trim();
            }
          }
          if (line === 'venue') {
            if (i + 1 < lines.length) {
              const nextVal = lines[i + 1].trim();
              if (nextVal === ':') {
                if (i + 2 < lines.length) {
                  rawVenue = lines[i + 2].trim();
                }
              } else {
                rawVenue = nextVal.replace(/^:\s*/i, '').trim();
                if (i + 2 < lines.length && (lines[i + 2].trim().startsWith(',') || lines[i + 2].toLowerCase().includes('sheffield'))) {
                  rawVenue += ' ' + lines[i + 2].trim();
                }
              }
            }
          }
        }

        if (!name) {
          name = $('h1').first().text().replace(/\s+/g, ' ').trim() || 'Swim England National Event';
        }

        // Clean meet name a bit
        name = this.cleanMeetName(name);

        const date = this.parseAboutPageDates(rawDate);

        let location = 'Unknown Venue';
        if (rawVenue) {
          const v = rawVenue.trim();
          if (v && v !== ':') {
            location = v;
          }
        }
        if (location.toLowerCase().includes('ponds forge') && location.toLowerCase().includes('sheffield')) {
          location = 'Ponds Forge International Sports Centre, Sheffield';
        }

        // Course evaluation
        let course = 'Unknown';
        if (name.toLowerCase().includes('(25m)') || name.toLowerCase().includes('short course') || name.toLowerCase().includes('county') || url.includes('winter') || url.includes('county')) {
          course = 'Short Course (25m)';
        } else if (name.toLowerCase().includes('(50m)') || name.toLowerCase().includes('long course') || url.includes('summer')) {
          course = 'Long Course (50m)';
        }

        // Level details
        let level = 'Unknown';
        if (course.includes('25m')) {
          level = 'Level 2';
        } else if (course.includes('50m')) {
          level = 'Level 1';
        }

        const id = `swimeng-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
          .replace(/--+/g, '-')
          .replace(/(^-|-$)+/g, '');

        meets.push({
          id,
          name,
          date,
          location,
          region: 'England',
          course,
          level,
          meetType: 'National',
          scrapedAt: new Date().toISOString()
        } as any);

      } catch (err) {
        console.error(`Error processing about page ${url}:`, err);
      }
    }));

    return meets;
  }

  public async fetchScottishEvents(): Promise<SwimMeet[]> {
    const apiQueryUrl = 'https://live-scotswim-full.ocs-software.com/wp-json/wp/v2/events?per_page=100';
    const meets: SwimMeet[] = [];

    try {
      console.log(`[Scraper] Retrieving Scottish Swimming events from API: ${apiQueryUrl}`);
      const response = await this.fetchPage(apiQueryUrl);
      const events = JSON.parse(response) as any[];

      for (const ev of events) {
        const acf = ev.acf || {};
        const title = acf.title || (ev.title && ev.title.rendered) || '';
        if (!title) continue;

        // Verify if tagged/discipline matches Swimming
        const disciplines = acf.discipline || [];
        const discSelect = acf.discipline_select || '';

        const hasSwimmingDiscipline =
          disciplines.map((d: string) => d.toLowerCase()).includes('swimming') ||
          discSelect.toLowerCase() === 'swimming';

        // We are only interested in events that tagged as Swimming, not others
        if (!hasSwimmingDiscipline) {
          continue;
        }

        const dates = acf.dates || '';
        const parsedDate = this.parseAboutPageDates(dates);

        const venue = acf.venue || '';
        const location = venue.trim() || 'Unknown Venue';

        // Course evaluation
        let course = 'Unknown';
        let level = 'Unknown';

        const textToAnalyze = `${title} ${ev.content?.rendered || ''}`.toLowerCase();
        if (textToAnalyze.includes('short course') || textToAnalyze.includes('25m')) {
          course = 'Short Course (25m)';
          level = 'Level 2';
        } else if (textToAnalyze.includes('long course') || textToAnalyze.includes('50m')) {
          course = 'Long Course (50m)';
          level = 'Level 1';
        }

        const cleanName = this.cleanMeetName(title);
        const id = `scotswim-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${parsedDate.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
          .replace(/--+/g, '-')
          .replace(/(^-|-$)+/g, '');

        meets.push({
          id,
          name: cleanName,
          date: parsedDate,
          location,
          region: 'Scotland', // set region to Scotland
          course,
          level,
          meetType: 'National',
          sourceUrl: ev.link || 'https://www.scottishswimming.com/events/national-events',
          scrapedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Error fetching Scottish Swimming events:', err);
    }

    return meets;
  }

  // Fetch Aquatics GB swimming events from https://www.aquaticsgb.com/browse-sport/swimming/
  public async fetchAquaticsGBEvents(): Promise<SwimMeet[]> {
    const mainUrl = 'https://www.aquaticsgb.com/browse-sport/swimming/';
    const meets: SwimMeet[] = [];
    try {
      console.log(`[Scraper] Retrieving Aquatics GB events from: ${mainUrl}`);
      const html = await this.fetchPage(mainUrl);
      const $ = cheerio.load(html);

      const eventLinks: { url: string; text: string }[] = [];
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/events-and-tickets/') && href !== '/events-and-tickets/') {
          const fullUrl = href.startsWith('http') ? href : `https://www.aquaticsgb.com${href}`;
          if (!eventLinks.some(link => link.url === fullUrl)) {
            eventLinks.push({ url: fullUrl, text: $(el).text().replace(/\s+/g, ' ').trim() });
          }
        }
      });

      console.log(`[Scraper] Found ${eventLinks.length} candidate Aquatics GB event URLs.`);

      for (const item of eventLinks) {
        try {
          console.log(`[Scraper] Processing Aquatics GB subpage: ${item.url}`);
          let pageHtml = '';
          let isSuccess = false;
          try {
            pageHtml = await this.fetchPage(item.url);
            isSuccess = true;
          } catch (fetchErr: any) {
            console.log(`[Scraper] Subpage ${item.url} is not available. Proceeding with fallback parsing.`);
          }

          let name = '';
          let dateStr = '';
          let location = '';
          let course = 'Unknown';
          let level = 'Unknown';

          if (isSuccess && pageHtml) {
            const $sub = cheerio.load(pageHtml);
            const h1Text = $sub('h1').text().replace(/\s+/g, ' ').trim();
            name = h1Text.replace('#AquaticsGB', '').trim();

            const bodyText = $sub('body').text().replace(/\s+/g, ' ');

            // Find dates in subpage context (e.g. "16 Jul 2026 — 22 Jul 2026" or similar)
            const dateRangeRegex = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\s*[-—–]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i;
            const matchRange = bodyText.match(dateRangeRegex);
            if (matchRange) {
              dateStr = `${matchRange[1]} ${matchRange[2]} ${matchRange[3]} - ${matchRange[4]} ${matchRange[5]} ${matchRange[6]}`;
            } else {
              const cleanTextDates = bodyText.match(new RegExp("(\\d{1,2})(?:st|nd|rd|th)?\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+([A-Za-z]{3,9})\\s+(20\\d{2})", "i"));
              if (cleanTextDates) {
                dateStr = `${cleanTextDates[1]}-${cleanTextDates[2]} ${cleanTextDates[3]} ${cleanTextDates[4]}`;
              } else {
                const individualDateRegex = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i;
                const matchIndividual = bodyText.match(individualDateRegex);
                if (matchIndividual) {
                  dateStr = `${matchIndividual[1]} ${matchIndividual[2]} ${matchIndividual[3]}`;
                }
              }
            }

            if (dateStr) {
              dateStr = this.parseAboutPageDates(dateStr);
            } else {
              dateStr = 'Ongoing/TBD';
            }

            // Find course configuration
            const courseHeading = $sub('h3').filter((_, el) => $sub(el).text().trim().toLowerCase() === 'course');
            if (courseHeading.length > 0) {
              const courseVal = courseHeading.next().text().trim();
              if (courseVal.includes('25')) {
                course = 'Short Course (25m)';
                level = 'Level 2';
              } else {
                course = 'Long Course (50m)';
                level = 'Level 1';
              }
            } else {
              if (bodyText.toLowerCase().includes('short course') || bodyText.toLowerCase().includes('25m')) {
                course = 'Short Course (25m)';
                level = 'Level 2';
              }
            }

            // Find Location (Venue)
            const pondsForgeH3 = $sub('h3').filter((_, el) => $sub(el).text().toLowerCase().includes('ponds forge'));
            if (pondsForgeH3.length > 0) {
              location = $sub(pondsForgeH3).text().replace(/\s+/g, ' ').trim();
            } else {
              const locationMatch = bodyText.match(/(?:at the|heading to)\s+([\w\s]+(?:Centre|Centre in|ISC|Pool|Complex)[\w\s,]*?)(?:\s+from|\s+in|\s+heading|\s+bringing|\s+with|\.)/i);
              if (locationMatch && locationMatch[1]) {
                location = locationMatch[1].replace(/\s+/g, ' ').trim();
              } else {
                if (bodyText.includes('London Aquatics Centre')) {
                  location = 'London Aquatics Centre';
                } else if (bodyText.includes('Ponds Forge')) {
                  location = 'Ponds Forge International Sports Centre, Sheffield';
                }
              }
            }
          }

          // Fallbacks for failed or thin subpage crawls
          if (!name) {
            const parts = item.text.split('2026');
            if (parts.length > 1) {
              name = (parts[0].trim() + ' 2026').trim();
              location = parts[1].trim();
            } else {
              name = item.text || 'Aquatics GB Event';
            }
          }

          if (!location) {
            if (item.url.includes('london')) {
              location = 'London Aquatics Centre';
            } else if (item.url.includes('ponds-forge')) {
              location = 'Ponds Forge International Sports Centre, Sheffield';
            } else {
              location = 'TBD';
            }
          }

          if (!dateStr) {
            dateStr = 'Ongoing/TBD';
          }

          const id = `aqgb-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dateStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
            .replace(/--+/g, '-')
            .replace(/(^-|-$)+/g, '');

          meets.push({
            id,
            name,
            date: dateStr,
            location,
            region: 'GB', // Set region to GB as requested
            course,
            level,
            meetType: 'National',
            sourceUrl: item.url,
            scrapedAt: new Date().toISOString()
          });

        } catch (subErr) {
          console.error(`[Scraper] Error parsing Aquatics GB subpage ${item.url}:`, subErr);
        }
      }
    } catch (err) {
      console.error('[Scraper] Error retrieving Aquatics GB events:', err);
    }

    return meets;
  }

  public async fetchGoogleCalendars(): Promise<SwimMeet[]> {
    const urls = [
      'https://calendar.google.com/calendar/ical/88e25b5e901f73664ee5db21cd9c994e899294a60bdb007aefef12875d0dbfa1@group.calendar.google.com/public/basic.ics'
    ];

    const meets: SwimMeet[] = [];

    for (const url of urls) {
      let fetchedSuccessfully = false;
      let icsText = '';

      // 1. Direct fetch
      try {
        console.log(`[Scraper] Fetching iCal calendar: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
            'Accept': 'text/calendar,text/plain,*/*'
          },
          signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
          icsText = await response.text();
          fetchedSuccessfully = true;
          console.log(`[Scraper] Successfully fetched iCal calendar directly: ${url}`);
        } else {
          console.warn(`[Scraper] Direct fetch of iCal failed with status ${response.status}. trying proxy...`);
        }
      } catch (directErr: any) {
        console.warn(`[Scraper] Direct fetch of iCal errored: ${directErr.message || directErr}. trying proxy...`);
      }

      // 2. Proxy fetch fallback
      if (!fetchedSuccessfully) {
        try {
          const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
          console.log(`[Scraper] Proxy fetch of iCal: ${proxyUrl}`);
          const response = await fetch(proxyUrl, {
            signal: AbortSignal.timeout(10000)
          });
          if (response.ok) {
            icsText = await response.text();
            fetchedSuccessfully = true;
            console.log(`[Scraper] Successfully fetched iCal via proxy for ${url}`);
          } else {
            console.warn(`[Scraper] Proxy fetch failed with status ${response.status}.`);
          }
        } catch (proxyErr: any) {
          console.warn(`[Scraper] Proxy fetch failed with error: ${proxyErr.message || proxyErr}`);
        }
      }

      // 3. Process
      if (fetchedSuccessfully && icsText && icsText.includes('BEGIN:VCALENDAR')) {
        try {
          const parsedMeets = this.parseIcsData(icsText, url);
          console.log(`[Scraper] Retrieved ${parsedMeets.length} valid meets from ${url}`);
          meets.push(...parsedMeets);
        } catch (parseErr) {
          console.error(`[Scraper] Failed to parse ics iCal content:`, parseErr);
        }
      }
    }

    return meets;
  }


  public async fetchMastersEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    let page = 1;

    while (true) {
      const url = `https://www.swimming.org/calendar/disciplines/masters-swimming/page/${page}/`;
      try {
        console.log(`[Scraper] Fetching Masters Swimming events from page ${page}: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          console.log(`[Scraper] Completed crawling. No more pages found at page ${page}.`);
          break;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const pageEvents: SwimMeet[] = [];

        $('.event-item').each((_, el) => {
          const titleEl = $(el).find('h2 a');
          const name = titleEl.text().trim();
          const sourceUrl = titleEl.attr('href') || '';

          if (!name || !sourceUrl) return;

          const timeEl = $(el).find('time.text-muted');
          const rawDateStr = timeEl.text().trim().replace(/\s+/g, ' ');
          const datetime = timeEl.attr('datetime') || '';

          // Parse year
          const yearMatch = datetime.match(/^(\d{4})/);
          const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

          // Standardize date using help function
          let cleanDateStr = rawDateStr.replace(/(?:sun|mon|tue|wed|thu|fri|sat)\s*/gi, '').trim();
          const dateParts = cleanDateStr.split('-').map(p => p.trim());
          if (dateParts.length === 2 && dateParts[0] === dateParts[1]) {
            cleanDateStr = dateParts[0];
          }
          const finalDateStr = `${cleanDateStr} ${year}`.replace(/\s+/g, ' ').trim();

          // Extract region/location
          let region = 'National';
          $(el).find('.event-locations-container a').each((_, rel) => {
            const regText = $(rel).text().trim();
            if (regText) {
              region = regText;
            }
          });

          // Course determination (Long Course, Short Course, Open Water)
          let course = 'Short Course';
          const catsText = $(el).find('.event-categories-container').text().toLowerCase();
          const nameLower = name.toLowerCase();

          if (nameLower.includes('short course') || nameLower.includes('25m') || catsText.includes('short course') || catsText.includes('25m')) {
            course = 'Short Course (25m)';
          } else if (nameLower.includes('long course') || nameLower.includes('50m') || catsText.includes('long course') || catsText.includes('50m')) {
            course = 'Long Course (50m)';
          } else if (nameLower.includes('open water') || catsText.includes('open water')) {
            course = 'Open Water';
          }

          // Generate stable id from sourceUrl slug
          const slugMatch = sourceUrl.match(/\/all\/([^/]+)\/?$/) || sourceUrl.match(/\/([^/]+)\/?$/);
          const slug = slugMatch ? slugMatch[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const id = `masters-${slug}`;

          pageEvents.push({
            id,
            name,
            date: finalDateStr,
            location: 'Unknown Venue', // will be fetched by Details API
            region,
            course,
            level: 'Masters',
            meetType: 'Masters',
            sourceUrl,
            scrapedAt: new Date().toISOString()
          });
        });

        if (pageEvents.length === 0) {
          console.log(`[Scraper] Found 0 events on page ${page}, stopping.`);
          break;
        }

        console.log(`[Scraper] Retrieved ${pageEvents.length} events from page ${page}.`);
        meets.push(...pageEvents);
        page++;

        // Small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (err: any) {
        console.error(`[Scraper] Error fetching/parsing Masters page ${page}:`, err);
        break;
      }
    }

    return meets;
  }

  public parseIcsData(icsText: string, sourceUrl: string): SwimMeet[] {
    const meets: SwimMeet[] = [];

    const unfoldedText = icsText.replace(/\r?\n[ \t]/g, '');
    const lines = unfoldedText.split(/\r?\n/);

    let currentEvent: any = null;
    let inEvent = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      if (trimmedLine === 'BEGIN:VEVENT') {
        currentEvent = {};
        inEvent = true;
        continue;
      }

      if (trimmedLine === 'END:VEVENT') {
        if (inEvent && currentEvent) {
          const meet = this.processIcsEvent(currentEvent, sourceUrl);
          if (meet) {
            meets.push(meet);
          }
        }
        currentEvent = null;
        inEvent = false;
        continue;
      }

      if (inEvent && currentEvent) {
        const colonIdx = trimmedLine.indexOf(':');
        if (colonIdx === -1) continue;
        const keyPart = trimmedLine.substring(0, colonIdx).trim().toUpperCase();
        const value = trimmedLine.substring(colonIdx + 1).trim();
        const propertyName = keyPart.split(';')[0];

        if (propertyName === 'SUMMARY') {
          currentEvent.summary = value;
        } else if (propertyName === 'DTSTART') {
          currentEvent.dtstart = value;
        } else if (propertyName === 'DTEND') {
          currentEvent.dtend = value;
        } else if (propertyName === 'LOCATION') {
          currentEvent.location = value;
        } else if (propertyName === 'DESCRIPTION') {
          currentEvent.description = value;
        }
      }
    }

    return meets;
  }

  private unescapeIcsString(str: string): string {
    if (!str) return '';
    return str
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/gi, '\n')
      .trim();
  }

  private shouldExcludeIcsEvent(summary: string): boolean {
    const s = summary.toLowerCase();

    const excludePatterns = [
      /committee/i,
      /annual\s+general\s+meeting/i,
      /\bagm\b/i,
      /\ba\.g\.m\.\b/i,
      /values/i,
      /vision/i,
      /forum/i,
      /\bmeeting\b/i,
      /\bmeetings\b/i,
      /nasl/i,
      /open\s+water/i,
      /para/i
    ];

    return excludePatterns.some(pattern => pattern.test(s));
  }

  private parseIcsDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const m = dateStr.match(/^(\d{4})(\d{2})(\d{1,2})/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      return new Date(year, month, day);
    }
    return null;
  }

  private formatIcsDates(start: Date, end: Date | null): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const suffix = (day: number) => {
      if (day >= 11 && day <= 13) return day + 'th';
      switch (day % 10) {
        case 1: return day + 'st';
        case 2: return day + 'nd';
        case 3: return day + 'rd';
        default: return day + 'th';
      }
    };

    const sy = start.getFullYear();
    const sm = months[start.getMonth()];
    const sd = start.getDate();

    if (!end) {
      return `${suffix(sd)} ${sm} ${sy}`;
    }

    let adjustedEnd = new Date(end);
    const isSameDayOrAllDaySingleDay = (adjustedEnd.getTime() - start.getTime() === 24 * 60 * 60 * 1000) && start.getHours() === 0 && adjustedEnd.getHours() === 0;
    if (isSameDayOrAllDaySingleDay) {
      return `${suffix(sd)} ${sm} ${sy}`;
    } else if (start.getHours() === 0 && adjustedEnd.getHours() === 0 && adjustedEnd.getTime() > start.getTime()) {
      adjustedEnd = new Date(adjustedEnd.getTime() - 24 * 60 * 60 * 1000);
    }

    const ey = adjustedEnd.getFullYear();
    const em = months[adjustedEnd.getMonth()];
    const ed = adjustedEnd.getDate();

    if (sy === ey) {
      if (sm === em) {
        if (sd === ed) {
          return `${suffix(sd)} ${sm} ${sy}`;
        }
        return `${suffix(sd)} ${sm} - ${suffix(ed)} ${em} ${sy}`;
      }
      return `${suffix(sd)} ${sm} - ${suffix(ed)} ${em} ${sy}`;
    }
    return `${suffix(sd)} ${sm} ${sy} - ${suffix(ed)} ${em} ${ey}`;
  }

  private processIcsEvent(event: any, sourceUrl: string): SwimMeet | null {
    const rawSummary = this.unescapeIcsString(event.summary || '');
    if (!rawSummary) return null;

    if (this.shouldExcludeIcsEvent(rawSummary)) {
      console.log(`[Scraper] Excluding iCal event (matched exclusion rule): ${rawSummary}`);
      return null;
    }

    const startStr = event.dtstart;
    const endStr = event.dtend;
    if (!startStr) return null;

    const startDate = this.parseIcsDate(startStr);
    const endDate = endStr ? this.parseIcsDate(endStr) : null;
    if (!startDate) return null;

    const formattedDate = this.formatIcsDates(startDate, endDate);
    const name = this.cleanMeetName(rawSummary);

    const description = this.unescapeIcsString(event.description || '');
    let location = this.unescapeIcsString(event.location || '');
    if (!location) {
      location = 'TBD';
    }

    const textToAnalyze = `${rawSummary} ${description} ${location}`;
    const attrs = this.deconstructConcatenatedFields(textToAnalyze);

    const region = 'South West';

    const cleanIdBase = `${name}-${formattedDate}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `ical-${cleanIdBase}`
      .replace(/--+/g, '-')
      .replace(/(^-|-$)+/g, '');

    return {
      id,
      name,
      date: formattedDate,
      location,
      region,
      course: attrs.course,
      level: attrs.level,
      meetType: attrs.meetType,
      sourceUrl,
      scrapedAt: new Date().toISOString()
    };
  }



  private parseAboutPageDates(dateStr: string): string {
    if (!dateStr) return 'Ongoing/TBD';

    const monthsMap: { [key: string]: string } = {
      'january': 'Jan', 'february': 'Feb', 'march': 'Mar', 'april': 'Apr', 'may': 'May', 'june': 'Jun',
      'july': 'Jul', 'august': 'Aug', 'september': 'Sep', 'october': 'Oct', 'november': 'Nov', 'december': 'Dec',
      'jan': 'Jan', 'feb': 'Feb', 'mar': 'Mar', 'apr': 'Apr', 'jun': 'Jun', 'jul': 'Jul', 'aug': 'Aug',
      'sep': 'Sep', 'oct': 'Oct', 'nov': 'Nov', 'dec': 'Dec'
    };

    let cleanStr = dateStr.replace(/\s+/g, ' ').replace(/–/g, '-').replace(/—/g, '-').trim();

    // Normalize duplicate years: "16 Jul 2026 - 22 Jul 2026" -> "16 Jul - 22 Jul 2026"
    cleanStr = cleanStr.replace(/\b(20\d{2})\b\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+\1\b/g, (match, y, day, month) => {
      return `- ${day} ${month} ${y}`;
    });

    const yearMatch = cleanStr.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : '2026';

    const suffix = (d: string) => {
      const day = parseInt(d, 10);
      if (isNaN(day)) return d;
      if (day >= 11 && day <= 13) return day + 'th';
      switch (day % 10) {
        case 1: return day + 'st';
        case 2: return day + 'nd';
        case 3: return day + 'rd';
        default: return day + 'th';
      }
    };

    // 27 July - 1 August 2026
    const rangeDiffMonths = cleanStr.match(/(\d{1,2})\s+([A-Za-z]+)\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(?:20\d{2})/i);
    if (rangeDiffMonths) {
      const d1 = rangeDiffMonths[1];
      const m1 = monthsMap[rangeDiffMonths[2].toLowerCase()] || 'Jul';
      const d2 = rangeDiffMonths[3];
      const m2 = monthsMap[rangeDiffMonths[4].toLowerCase()] || 'Aug';
      return `${suffix(d1)}${m1} - ${suffix(d2)}${m2} ${year}`;
    }

    // 10 - 13 December 2026
    const rangeSameMonth = cleanStr.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(?:20\d{2})/i);
    if (rangeSameMonth) {
      const d1 = rangeSameMonth[1];
      const d2 = rangeSameMonth[2];
      const m = monthsMap[rangeSameMonth[3].toLowerCase()] || 'Dec';
      return `${suffix(d1)}${m} - ${suffix(d2)}${m} ${year}`;
    }

    // Sunday 4 October 2026
    const singleMatch = cleanStr.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*(\d{1,2})\s+([A-Za-z]+)\s+(?:20\d{2})/i);
    if (singleMatch) {
      const day = singleMatch[1];
      const m = monthsMap[singleMatch[2].toLowerCase()] || 'Oct';
      return `${suffix(day)}${m} ${year}`;
    }

    return cleanStr;
  }



  // Orchestrate scraping process across multiple directories and pagination pages
  public async scrapeAll(): Promise<{ meets: SwimMeet[]; log: ScrapeLog }> {
    const startTime = Date.now();
    let totalPages = 0;
    const allMeets: SwimMeet[] = [];
    const baseUri = 'https://www.swimmingresults.org/licensed_meets/';

    let scrapeMethod: 'cheerio' = 'cheerio';
    let scrapeError: string | undefined;

    try {
      // Step 1: Fetch first page
      totalPages++;
      const firstPageHtml = await this.fetchPage(baseUri);

      // Run standard cheerio
      const firstPageMeets = this.parseWithCheerio(firstPageHtml, baseUri);
      allMeets.push(...firstPageMeets);

      // Step 2: Determine total pages dynamically from the text e.g. "Page 1 of 17"
      let totalPagesOnSite = 1;
      const pageMatch = firstPageHtml.match(/page\s+\d+\s+of\s+(\d+)/i);
      if (pageMatch && pageMatch[1]) {
        totalPagesOnSite = parseInt(pageMatch[1], 10);
      }

      // Respect maxPages limit if defined in config, but default to scanning all available pages
      const maxPagesToScrape = Math.min(totalPagesOnSite, this.config.maxPages || 50, 50);

      const pageUrls: string[] = [];
      for (let p = 2; p <= maxPagesToScrape; p++) {
        pageUrls.push(`https://www.swimmingresults.org/licensed_meets/index.php?page=${p}&region=P&level=P&month=P&year=P`);
      }

      // Helper to fetch Swimming Results pagination pages in polite chunks
      const fetchPageChunked = async (urls: string[]): Promise<SwimMeet[]> => {
        const results: SwimMeet[] = [];
        const chunkSize = 5;
        for (let i = 0; i < urls.length; i += chunkSize) {
          const chunk = urls.slice(i, i + chunkSize);
          const pages = await Promise.all(chunk.map(async (url) => {
            try {
              totalPages++;
              console.log(`[Scraper] Scraping page: ${url}`);
              const pageHtml = await this.fetchPage(url);
              return this.parseWithCheerio(pageHtml, url);
            } catch (err) {
              console.error(`Error scraping pagination page ${url}:`, err);
              return [];
            }
          }));
          for (const pageMeets of pages) {
            results.push(...pageMeets);
          }
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        return results;
      };

      console.log(`[Scraper] Dynamic pagination detected. Capturing all ${maxPagesToScrape} available pages on Swimming Results...`);

      // Fetch all sources concurrently to optimize performance
      const [
        licensedPaginationMeets,
        aboutPageMeets,
        scottishMeets,
        aquaticsMeets,
        calendarMeets,
        mastersMeets
      ] = await Promise.all([
        fetchPageChunked(pageUrls),
        (async () => {
          try {
            console.log("[Scraper] Fetching additional events from Swimming.org about pages...");
            const meets = await this.fetchAboutPageNationalEvents();
            console.log(`[Scraper] Retrieved ${meets.length} events from about-pages.`);
            return meets;
          } catch (err) {
            console.error("Error fetching about-page events:", err);
            return [];
          }
        })(),
        (async () => {
          try {
            console.log("[Scraper] Fetching Scottish Swimming national events...");
            const meets = await this.fetchScottishEvents();
            console.log(`[Scraper] Retrieved ${meets.length} events from Scottish Swimming.`);
            return meets;
          } catch (err) {
            console.error("Error fetching Scottish Swimming events:", err);
            return [];
          }
        })(),
        (async () => {
          try {
            console.log("[Scraper] Fetching Aquatics GB swimming events...");
            const meets = await this.fetchAquaticsGBEvents();
            console.log(`[Scraper] Retrieved ${meets.length} events from Aquatics GB.`);
            return meets;
          } catch (err) {
            console.error("Error fetching Aquatics GB events:", err);
            return [];
          }
        })(),
        (async () => {
          try {
            console.log("[Scraper] Fetching public Google Calendar iCal feeds...");
            const meets = await this.fetchGoogleCalendars();
            console.log(`[Scraper] Retrieved ${meets.length} events from Google Calendars.`);
            return meets;
          } catch (err) {
            console.error("Error fetching Google Calendar feeds:", err);
            return [];
          }
        })(),
        (async () => {
          try {
            console.log("[Scraper] Fetching Masters Swimming events from Swimming.org...");
            const meets = await this.fetchMastersEvents();
            console.log(`[Scraper] Retrieved ${meets.length} events from Masters Swimming.`);
            return meets;
          } catch (err) {
            console.error("Error fetching Masters Swimming events:", err);
            return [];
          }
        })()
      ]);

      allMeets.push(
        ...licensedPaginationMeets,
        ...aboutPageMeets,
        ...scottishMeets,
        ...aquaticsMeets,
        ...calendarMeets,
        ...mastersMeets
      );

    } catch (err: any) {
      scrapeError = err.message || String(err);
      console.error('Core scraper execution failed:', err);
    }

    // De-duplicate meets based on generated meet name hashes
    const uniqueMeetsMap = new Map<string, SwimMeet>();
    allMeets.forEach(m => {
      uniqueMeetsMap.set(m.id, m);
    });

    const dedupedMeets = Array.from(uniqueMeetsMap.values());
    const finalMeets = this.filterOlderThanToday(dedupedMeets);

    // Identify meets needing a fetch
    const meetsToFetch = finalMeets.filter(m =>
      (!m.location || m.location === 'Unknown Venue' || m.location === 'TBD' || m.location === 'Unknown') &&
      (m as any).sourceUrl && (m as any).sourceUrl.startsWith('http') &&
      !(m as any).sourceUrl.includes('calendar.google.com') &&
      !(m as any).sourceUrl.includes('.ics')
    );

    console.log(`[Scraper] Found ${meetsToFetch.length} meets needing location fetch. Fetching all items in parallel chunks...`);

    const detailConcurrency = 8;

    for (let i = 0; i < meetsToFetch.length; i += detailConcurrency) {
      const chunk = meetsToFetch.slice(i, i + detailConcurrency);
      await Promise.all(chunk.map(async (meet) => {
        const detailUrl = (meet as any).sourceUrl;
        if (detailUrl) {
          console.log(`[Details API] Fetching meet details page for town/city: ${detailUrl}`);
          const townCity = await this.fetchTownCity(detailUrl);
          if (townCity) {
            meet.location = townCity;
          } else {
            meet.location = 'Unknown Venue';
          }
        }
      }));
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const durationMs = Date.now() - startTime;

    const log: ScrapeLog = {
      timestamp: new Date().toISOString(),
      success: !scrapeError && finalMeets.length > 0,
      pagesScraped: totalPages,
      itemsFound: finalMeets.length,
      durationMs,
      method: scrapeMethod,
      error: scrapeError
    };

    return { meets: finalMeets, log };
  }
}

