import * as cheerio from 'cheerio';
import { SwimMeet, ScraperConfig } from './types';
import { MONTH_ABBREV_TO_INDEX, MONTH_INDEX_TO_ABBREV } from './constants';

export class SwimmingScraper {
  private config: ScraperConfig = {
    maxPages: 3
  };

  constructor(config?: Partial<ScraperConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  // Fetch HTML page with realistic headers and optional timeout
  private async fetchPage(url: string, retries = 2): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch page: HTTP status ${response.status}`);
        }
        return await response.text();
      } catch (err) {
        if (attempt < retries) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[Scraper] Fetch attempt ${attempt + 1} failed for ${url}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
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
    const MONTHS_KEYS = Object.keys(MONTH_ABBREV_TO_INDEX).sort((a, b) => b.length - a.length);

    let monthIdx = -1;
    const lastPartLower = lastPart.toLowerCase();
    for (const key of MONTHS_KEYS) {
      if (lastPartLower.includes(key)) {
        monthIdx = MONTH_ABBREV_TO_INDEX[key];
        break;
      }
    }

    if (monthIdx === -1) {
      const cleanStrLower = cleanStr.toLowerCase();
      for (const key of MONTHS_KEYS) {
        if (cleanStrLower.includes(key)) {
          monthIdx = MONTH_ABBREV_TO_INDEX[key];
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
      'scotswim': 'Scotland',
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
        'EA': 'East',
        'YO': 'Yorkshire',
        'SC': 'Scotland',
        'WA': 'Wales'
      };
      for (const token of tokens) {
        if (abbrevMap[token]) {
          region = abbrevMap[token];
          break;
        }
      }
    }

    // 4. Detect Meet Type
    if (textLower.includes('club champ') || textLower.includes('time trial') || textLower.includes('club championship')) {
      meetType = "Club Champs";
    } else if (textLower.includes('league') || textLower.includes('arena league') || textLower.includes('diddy league') || textLower.includes('inter club') || textLower.includes('interclub') || textLower.includes('nasl')) {
      meetType = "League";
    } else if (textLower.includes('county') || textLower.includes('county champ')) {
      meetType = "County Championship";
    } else if (textLower.includes('regional') || textLower.includes('region champ')) {
      meetType = "Regional Championship";
    } else if (textLower.includes('national') || textLower.includes('winter champ') || textLower.includes('summer meet')) {
      meetType = "National";
    } else if (textLower.includes('masters')) {
      meetType = "Masters";
    } else {
      meetType = "Open Meet";
    }

    return { region, course, level, meetType };
  }

  // Parses HTML tables from Swimming Results pages using Cheerio
  public parseWithCheerio(html: string, sourceUrl: string): SwimMeet[] {
    const meets: SwimMeet[] = [];
    const $ = cheerio.load(html);

    // Look for rows in tables on licensed_meets index page
    $('tr').each((_, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 3) {
        const rawDate = $(cells[0]).text().trim();
        const rawName = $(cells[1]).text().trim();
        const rawConcat = $(cells[2]).text().trim();

        // Ensure date matches basic pattern (e.g., contains numbers/months) and is not header row
        if (rawDate && rawName && !rawDate.toLowerCase().includes('date') && !rawName.toLowerCase().includes('meet')) {
          const name = this.cleanMeetName(rawName);
          const fields = this.deconstructConcatenatedFields(rawConcat);

          // Extract link if available
          const link = $(cells[1]).find('a').attr('href');
          let fullLink = sourceUrl;
          if (link) {
            fullLink = new URL(link, sourceUrl).href;
          }

          // Generate stable deterministic ID based on cleaned name and date
          const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${rawDate.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
            .replace(/--+/g, '-')
            .replace(/(^-|-$)+/g, '');

          meets.push({
            id,
            name,
            date: rawDate,
            location: 'Unknown Venue',
            region: fields.region || 'UK',
            course: fields.course || 'Unknown',
            level: fields.level || 'Unknown',
            meetType: fields.meetType || 'Open Meet',
            scrapedAt: new Date().toISOString(),
            sourceUrl: fullLink
          });
        }
      }
    });

    return meets;
  }

  // Scrapes Swimming.org About pages for major national events
  public async fetchAboutPageNationalEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    const aboutPages = [
      {
        url: 'https://www.swimming.org/sport/about-the-national-summer-meet/',
        name: 'Swim England National Summer Meet'
      },
      {
        url: 'https://www.swimming.org/sport/about-the-national-winter-championships/',
        name: 'Swim England National Winter Championships'
      },
      {
        url: 'https://www.swimming.org/sport/about-the-national-county-team-championships/',
        name: 'Swim England National County Team Championships'
      }
    ];

    for (const item of aboutPages) {
      try {
        console.log(`[Scraper] Retrieving event from about-page: ${item.url}`);
        const html = await this.fetchPage(item.url);
        const $ = cheerio.load(html);

        let dateStr = '';
        let locationStr = 'Ponds Forge, Sheffield';

        // Search for date patterns inside paragraph or heading elements
        $('p, h2, h3, div').each((_, el) => {
          const text = $(el).text().trim();
          if (!dateStr && (text.includes('2025') || text.includes('2026')) && (text.includes('August') || text.includes('December') || text.includes('October') || text.includes('July'))) {
            if (text.length < 150) {
              dateStr = text;
            }
          }
        });

        if (!dateStr) {
          dateStr = 'TBD';
        }

        const id = `about-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-');

        meets.push({
          id,
          name: item.name,
          date: dateStr,
          location: locationStr,
          region: 'National',
          course: item.name.includes('Winter') ? 'Short Course (25m)' : 'Long Course (50m)',
          level: 'Level 1',
          meetType: 'National',
          sourceUrl: item.url,
          scrapedAt: new Date().toISOString()
        });
      } catch (err) {
        console.error(`Error scraping about page ${item.url}:`, err);
      }
    }

    return meets;
  }

  // Scrapes Scottish Swimming Events API / website
  public async fetchScottishEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    try {
      const url = 'https://live-scotswim-full.ocs-software.com/wp-json/wp/v2/events?per_page=100';
      console.log(`[Scraper] Retrieving Scottish Swimming events from API: ${url}`);

      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return meets;

      const events = await response.json();
      if (Array.isArray(events)) {
        for (const ev of events) {
          const title = ev.title?.rendered || ev.name || '';
          if (!title) continue;

          const dateStr = ev.event_date || ev.date || 'TBD';
          const locationStr = ev.venue || ev.location || 'Scotland';

          const id = `scotswim-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-');

          meets.push({
            id,
            name: title,
            date: dateStr,
            location: locationStr,
            region: 'Scotland',
            course: title.toLowerCase().includes('short course') ? 'Short Course (25m)' : (title.toLowerCase().includes('long course') ? 'Long Course (50m)' : 'Unknown'),
            level: title.toLowerCase().includes('national') ? 'Level 1' : 'Level 2',
            meetType: title.toLowerCase().includes('national') ? 'National' : 'Open Meet',
            sourceUrl: ev.link || 'https://www.scottishswimming.com/',
            scrapedAt: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.error('Error fetching Scottish Swimming events:', err);
    }
    return meets;
  }

  // Scrapes Aquatics GB swimming events
  public async fetchAquaticsGBEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    try {
      const url = 'https://www.aquaticsgb.com/browse-sport/swimming/';
      console.log(`[Scraper] Retrieving Aquatics GB events from: ${url}`);
      const html = await this.fetchPage(url);
      const $ = cheerio.load(html);

      // Find event links
      const candidateUrls: string[] = [];
      $('a[href*="/events-and-tickets/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !candidateUrls.includes(href)) {
          const full = href.startsWith('http') ? href : new URL(href, url).href;
          candidateUrls.push(full);
        }
      });

      console.log(`[Scraper] Found ${candidateUrls.length} candidate Aquatics GB event URLs.`);

      for (const eventUrl of candidateUrls.slice(0, 5)) {
        try {
          console.log(`[Scraper] Processing Aquatics GB subpage: ${eventUrl}`);
          const subHtml = await this.fetchPage(eventUrl);
          const $sub = cheerio.load(subHtml);

          const title = $sub('h1').first().text().trim() || $sub('title').text().replace(/\|.*/, '').trim();
          if (!title) continue;

          let dateStr = 'TBD';
          $sub('p, time, div').each((_, el) => {
            const txt = $sub(el).text().trim();
            if (!dateStr || dateStr === 'TBD') {
              if ((txt.includes('2025') || txt.includes('2026')) && (txt.includes('April') || txt.includes('May') || txt.includes('July') || txt.includes('August') || txt.includes('March'))) {
                if (txt.length < 100) dateStr = txt;
              }
            }
          });

          let locationStr = 'London Aquatics Centre';
          const subText = $sub.text();
          if (subText.includes('Ponds Forge') || subText.includes('Sheffield')) {
            locationStr = 'Ponds Forge, Sheffield';
          } else if (subText.includes('Tollcross') || subText.includes('Glasgow')) {
            locationStr = 'Tollcross International Swimming Centre, Glasgow';
          } else if (subText.includes('Sandwell')) {
            locationStr = 'Sandwell Aquatics Centre, Birmingham';
          }

          const id = `aquaticsgb-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-');

          meets.push({
            id,
            name: title,
            date: dateStr,
            location: locationStr,
            region: 'GB',
            course: title.toLowerCase().includes('short course') ? 'Short Course (25m)' : 'Long Course (50m)',
            level: 'Level 1',
            meetType: 'National',
            sourceUrl: eventUrl,
            scrapedAt: new Date().toISOString()
          });
        } catch (err) {
          console.warn(`[Scraper] Subpage ${eventUrl} is not available. Proceeding with fallback parsing.`);
        }
      }
    } catch (err) {
      console.error('Error fetching Aquatics GB events:', err);
    }

    return meets;
  }

  // Parse raw iCal feed text into SwimMeet objects
  public parseICalEvents(icalText: string, sourceUrl: string): SwimMeet[] {
    const meets: SwimMeet[] = [];
    const eventBlocks = icalText.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split('END:VEVENT')[0];

      // Extract Summary (Event Name)
      const summaryMatch = block.match(/SUMMARY:(.*?)(\r?\n(?![ \t])|$)/s);
      let summary = summaryMatch ? summaryMatch[1].replace(/\r?\n[ \t]/g, '').trim() : '';
      if (!summary) continue;

      // Exclusion filter rules
      const summaryLower = summary.toLowerCase();
      if (
        summaryLower.includes('committee') ||
        summaryLower.includes('board') ||
        summaryLower.includes('meeting') ||
        summaryLower.includes('agm') ||
        summaryLower.includes('feedback') ||
        summaryLower.includes('wash up') ||
        summaryLower.includes('fundraising') ||
        summaryLower.includes('para training') ||
        summaryLower.includes('event team') ||
        summaryLower.includes('taster') ||
        summaryLower.includes('save the date') ||
        summaryLower.includes('provisional:') ||
        summaryLower.includes('postponed:') ||
        summaryLower.includes('inter club') ||
        summaryLower.includes('interclub') ||
        summaryLower.includes('nasl') ||
        summaryLower.includes('national open water') ||
        summaryLower.includes('open water') ||
        summaryLower.includes('se swr') ||
        summaryLower.includes('swim england south west')
      ) {
        console.log(`[Scraper] Excluding iCal event (matched exclusion rule): ${summary}`);
        continue;
      }

      // Extract DTSTART
      const dtstartMatch = block.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
      // Extract DTEND
      const dtendMatch = block.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);

      let formattedDate = 'TBD';
      let dateText = 'TBD';

      if (dtstartMatch) {
        const sYear = dtstartMatch[1].substring(0, 4);
        const sMonth = dtstartMatch[1].substring(4, 6);
        const sDay = dtstartMatch[1].substring(6, 8);

        const startObj = new Date(parseInt(sYear, 10), parseInt(sMonth, 10) - 1, parseInt(sDay, 10));

        if (dtendMatch) {
          const eYear = dtendMatch[1].substring(0, 4);
          const eMonth = dtendMatch[1].substring(4, 6);
          const eDayRaw = parseInt(dtendMatch[1].substring(6, 8), 10);

          // iCal DTEND for full-day events is exclusive, so subtract 1 day for inclusive end date
          const endObj = new Date(parseInt(eYear, 10), parseInt(eMonth, 10) - 1, eDayRaw - 1);

          if (startObj.getTime() === endObj.getTime()) {
            // Single day event
            const dayNum = startObj.getDate();
            const monthStr = MONTH_INDEX_TO_ABBREV[startObj.getMonth()];
            dateText = `${dayNum}th ${monthStr} ${sYear}`;
            formattedDate = `${String(dayNum).padStart(2, '0')}/${sMonth}/${sYear}`;
          } else {
            // Multi-day event
            const sDayNum = startObj.getDate();
            const eDayNum = endObj.getDate();
            const sMonthStr = MONTH_INDEX_TO_ABBREV[startObj.getMonth()];
            const eMonthStr = MONTH_INDEX_TO_ABBREV[endObj.getMonth()];

            if (startObj.getMonth() === endObj.getMonth()) {
              dateText = `${sDayNum}th - ${eDayNum}th ${sMonthStr} ${sYear}`;
            } else {
              dateText = `${sDayNum}th ${sMonthStr} - ${eDayNum}th ${eMonthStr} ${sYear}`;
            }
            formattedDate = `${String(sDayNum).padStart(2, '0')}/${sMonth}/${sYear} - ${String(eDayNum).padStart(2, '0')}/${String(endObj.getMonth() + 1).padStart(2, '0')}/${eYear}`;
          }
        } else {
          const dayNum = startObj.getDate();
          const monthStr = MONTH_INDEX_TO_ABBREV[startObj.getMonth()];
          dateText = `${dayNum}th ${monthStr} ${sYear}`;
          formattedDate = `${String(dayNum).padStart(2, '0')}/${sMonth}/${sYear}`;
        }
      }

      // Extract LOCATION
      const locMatch = block.match(/LOCATION:(.*?)(\r?\n(?![ \t])|$)/s);
      let location = locMatch ? locMatch[1].replace(/\r?\n[ \t]/g, '').replace(/\\,/g, ',').trim() : 'Unknown Venue';
      if (!location) location = 'Unknown Venue';

      // Determine level / course from title
      let course = 'Unknown';
      let level = 'Level 3';
      if (summaryLower.includes('level 1') || summaryLower.includes('lvl 1') || summaryLower.includes('l1')) level = 'Level 1';
      if (summaryLower.includes('level 2') || summaryLower.includes('lvl 2') || summaryLower.includes('l2')) level = 'Level 2';
      if (summaryLower.includes('level 4') || summaryLower.includes('lvl 4') || summaryLower.includes('l4')) level = 'Level 4';

      if (summaryLower.includes('50m') || summaryLower.includes('long course')) course = 'Long Course (50m)';
      if (summaryLower.includes('25m') || summaryLower.includes('short course')) course = 'Short Course (25m)';

      let meetType = 'Open Meet';
      if (summaryLower.includes('county') || summaryLower.includes('ccasa')) meetType = 'County Championship';
      if (summaryLower.includes('masters')) meetType = 'Masters';
      if (summaryLower.includes('development') || summaryLower.includes('sprints')) meetType = 'Development Meet';

      const id = `ical-${summary.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dateText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        .replace(/--+/g, '-')
        .replace(/(^-|-$)+/g, '');

      meets.push({
        id,
        name: summary,
        date: dateText,
        formattedDate,
        location,
        region: 'South West',
        course,
        level,
        meetType,
        sourceUrl,
        scrapedAt: new Date().toISOString()
      });
    }

    return meets;
  }

  // Scrapes public Google Calendar iCal feeds
  public async fetchGoogleCalendars(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    const calendarUrls = [
      'https://calendar.google.com/calendar/ical/88e25b5e901f73664ee5db21cd9c994e899294a60bdb007aefef12875d0dbfa1@group.calendar.google.com/public/basic.ics'
    ];

    for (const calUrl of calendarUrls) {
      try {
        console.log(`[Scraper] Fetching iCal calendar: ${calUrl}`);
        const response = await fetch(calUrl, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          console.warn(`[Scraper] Failed to fetch iCal feed: HTTP ${response.status}`);
          continue;
        }
        const text = await response.text();
        const calMeets = this.parseICalEvents(text, calUrl);
        console.log(`[Scraper] Retrieved ${calMeets.length} valid meets from ${calUrl}`);
        meets.push(...calMeets);
      } catch (err) {
        console.error(`Error fetching Google Calendar ${calUrl}:`, err);
      }
    }

    return meets;
  }

  // Scrapes Masters Swimming event calendar from Swimming.org
  public async fetchMastersEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const url = `https://www.swimming.org/calendar/disciplines/masters-swimming/page/${page}/`;
        console.log(`[Scraper] Fetching Masters Swimming events from page ${page}: ${url}`);

        try {
          const html = await this.fetchPage(url);
          const $ = cheerio.load(html);

          let foundOnPage = 0;
          $('article, div.c-card, div.c-event-card, li.c-calendar-list__item, div.post').each((_, el) => {
            const titleEl = $(el).find('h2, h3, h4, .c-card__title, .c-event-card__title, a').first();
            const title = titleEl.text().trim();
            const link = titleEl.attr('href') || $(el).find('a').attr('href');

            const dateEl = $(el).find('.c-card__date, .c-event-card__date, time, .date').first();
            const dateStr = dateEl.text().trim();

            const locEl = $(el).find('.c-card__location, .c-event-card__location, .location').first();
            const locStr = locEl.text().trim();

            if (title && title.length > 3 && !title.toLowerCase().includes('calendar') && !title.toLowerCase().includes('discipline')) {
              foundOnPage++;

              const fullLink = link ? (link.startsWith('http') ? link : `https://www.swimming.org${link}`) : url;
              const id = `masters-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-');

              // Avoid duplicates on page
              if (!meets.some(m => m.id === id)) {
                meets.push({
                  id,
                  name: title,
                  date: dateStr || 'TBD',
                  location: locStr || 'Unknown Venue',
                  region: 'UK',
                  course: title.toLowerCase().includes('short course') ? 'Short Course' : (title.toLowerCase().includes('long course') ? 'Long Course' : 'Unknown'),
                  level: 'Masters',
                  meetType: 'Masters',
                  sourceUrl: fullLink,
                  scrapedAt: new Date().toISOString()
                });
              }
            }
          });

          // Fallback parsing if card selector produced nothing
          if (foundOnPage === 0) {
            $('a[href*="/calendar/all/"]').each((_, el) => {
              const link = $(el).attr('href');
              const title = $(el).text().trim();
              if (title && title.length > 5 && link) {
                foundOnPage++;
                const fullLink = link.startsWith('http') ? link : `https://www.swimming.org${link}`;
                const id = `masters-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-');

                if (!meets.some(m => m.id === id)) {
                  meets.push({
                    id,
                    name: title,
                    date: 'TBD',
                    location: 'Unknown Venue',
                    region: 'UK',
                    course: title.toLowerCase().includes('short course') ? 'Short Course' : (title.toLowerCase().includes('long course') ? 'Long Course' : 'Unknown'),
                    level: 'Masters',
                    meetType: 'Masters',
                    sourceUrl: fullLink,
                    scrapedAt: new Date().toISOString()
                  });
                }
              }
            });
          }

          console.log(`[Scraper] Retrieved ${foundOnPage} events from page ${page}.`);
          if (foundOnPage === 0 || page >= 4) {
            hasMore = false;
          } else {
            page++;
          }
        } catch (err) {
          console.log(`[Scraper] Completed crawling. No more pages found at page ${page}.`);
          hasMore = false;
        }
      }
    } catch (err) {
      console.error('Error fetching Masters Swimming events:', err);
    }

    return meets;
  }

  // Scrapes details page to extract town/city location
  public async fetchTownCity(detailsUrl: string): Promise<string | null> {
    try {
      const html = await this.fetchPage(detailsUrl);
      const $ = cheerio.load(html);

      let townCity: string | null = null;

      // 1. Search for table row with label "Town/City" or "Town" or "Venue" or "Location"
      $('tr, div, p, li').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.includes('Town/City') || text.includes('Town:') || text.includes('Venue:') || text.includes('Location:')) {
          const parts = text.split(/[:\t\n]+/);
          if (parts.length >= 2) {
            const val = parts[1].replace(/Venue|Town|City|Location/gi, '').trim();
            if (val && val.length > 2 && val.length < 60 && !val.includes('http')) {
              townCity = val;
            }
          }
        }
      });

      // 2. Search for explicit input/span with town value
      if (!townCity) {
        const townInput = $('input[name*="town" i], input[name*="city" i], span.town, td.town').first();
        if (townInput.length > 0) {
          const val = townInput.val() || townInput.text();
          if (typeof val === 'string' && val.trim().length > 2) {
            townCity = val.trim();
          }
        }
      }

      // Clean up venue text if found
      if (townCity) {
        townCity = (townCity as string).replace(/[^a-zA-Z0-9\s,\.-]/g, '').trim();
        if (townCity.length > 0) {
          return townCity;
        }
      }
    } catch (err) {
      // Fail silently and return null on fetch/parse errors
    }

    return null;
  }

  // Fetch Swim Wales events from JustGo API
  public async fetchSwimWalesEvents(): Promise<SwimMeet[]> {
    const meets: SwimMeet[] = [];
    const url = 'https://SwimWales.JustGo.com/workbench/public/event/DataService.ashx';

    try {
      console.log('[Scraper] Retrieving Swim Wales events from JustGo API...');

      const parseJustGoDate = (dateStr?: string): string => {
        if (!dateStr) return 'Ongoing/TBD';
        const match = dateStr.match(/\/Date\((\d+)\)\//);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          const d = new Date(timestamp);
          const dayNum = d.getDate();
          const monthNum = d.getMonth();
          const year = d.getFullYear();
          const monthStr = MONTH_INDEX_TO_ABBREV[monthNum] || 'Jan';

          const suffix = (n: number) => {
            if (n > 3 && n < 21) return n + 'th';
            switch (n % 10) {
              case 1: return n + 'st';
              case 2: return n + 'nd';
              case 3: return n + 'rd';
              default: return n + 'th';
            }
          };
          return `${suffix(dayNum)} ${monthStr} ${year}`;
        }
        return 'Ongoing/TBD';
      };

      let page = 1;
      while (true) {
        const commandObj = [{
          Id: 1,
          Service: 'GDE',
          Method: 'FetchObjectsPublic',
          Arguments: ['Event', JSON.stringify({ Method: 'FindEvents', PageNumber: page, pageNumber: page })]
        }];

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body: 'commands=' + encodeURIComponent(JSON.stringify(commandObj)),
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          console.warn(`[Scraper] Swim Wales API returned HTTP ${res.status}`);
          break;
        }

        const text = await res.text();
        const parsed = JSON.parse(text);
        if (!parsed[0] || !parsed[0].Result || !parsed[0].Result.Result || !parsed[0].Result.Result.Data) {
          break;
        }

        const rawEvents = parsed[0].Result.Result.Data as any[];
        if (rawEvents.length === 0) break;

        for (const item of rawEvents) {
          const name = (item.EventName || '').trim();
          if (!name) continue;

          const category = (item.EventCategory || '').toLowerCase();
          const nameLower = name.toLowerCase();
          // Exclude non-meet sessions (induction, meetings, workshops, courses, training, etc.)
          if (category.includes('session') || category.includes('course') || category.includes('meeting') || category.includes('training') ||
              nameLower.includes('induction') || nameLower.includes('workshop') || nameLower.includes('webinar') || nameLower.includes('teaching') || nameLower.includes('learn to swim')) {
            continue;
          }

          const startDateStr = parseJustGoDate(item.Starts);
          const endDateStr = parseJustGoDate(item.Ends);

          let date = startDateStr;
          if (startDateStr !== endDateStr && startDateStr !== 'Ongoing/TBD' && endDateStr !== 'Ongoing/TBD') {
            const startParts = startDateStr.split(' ');
            const endParts = endDateStr.split(' ');
            if (startParts[2] === endParts[2] && startParts[1] === endParts[1]) {
              date = `${startParts[0]} - ${endParts[0]} ${endParts[1]} ${endParts[2]}`;
            } else {
              date = `${startDateStr} - ${endDateStr}`;
            }
          }

          let location = 'Unknown Venue';
          if (item.Address && item.Address.Town) {
            const town = item.Address.Town.trim();
            location = town.charAt(0).toUpperCase() + town.slice(1).toLowerCase();
          } else if (item.Location && item.Location !== 'Virtual' && !item.Location.endsWith('.jpg') && !item.Location.endsWith('.png')) {
            location = item.Location;
          }

          let course = 'Unknown';
          let level = 'Unknown';
          const textToAnalyze = `${name} ${item.EventCategory || ''}`.toLowerCase();
          if (textToAnalyze.includes('short course') || textToAnalyze.includes('25m')) {
            course = 'Short Course (25m)';
            level = 'Level 2';
          } else if (textToAnalyze.includes('long course') || textToAnalyze.includes('50m')) {
            course = 'Long Course (50m)';
            level = 'Level 1';
          }

          const id = `swimwales-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
            .replace(/--+/g, '-')
            .replace(/(^-|-$)+/g, '');

          meets.push({
            id,
            name,
            date,
            location,
            region: 'Wales',
            course,
            level,
            meetType: item.EventCategory?.includes('National') ? 'National' : (item.EventCategory || 'Open Meet'),
            sourceUrl: item.Directlink || 'https://www.swimwales.org/events/',
            scrapedAt: new Date().toISOString()
          });
        }

        page++;
      }

      console.log(`[Scraper] Retrieved ${meets.length} events from Swim Wales.`);
    } catch (err) {
      console.error('Error fetching Swim Wales events:', err);
    }

    return meets;
  }

  // Orchestrate scraping process across multiple directories and pagination pages
  public async scrapeAll(): Promise<{ meets: SwimMeet[] }> {
    const startTime = Date.now();
    let totalPages = 0;
    const allMeets: SwimMeet[] = [];
    const baseUri = 'https://www.swimmingresults.org/licensed_meets/';

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
        const chunkSize = 8;
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
        mastersMeets,
        welshMeets
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
        })(),
        (async () => {
          try {
            console.log("[Scraper] Fetching Swim Wales events...");
            const meets = await this.fetchSwimWalesEvents();
            console.log(`[Scraper] Retrieved ${meets.length} events from Swim Wales.`);
            return meets;
          } catch (err) {
            console.error("Error fetching Swim Wales events:", err);
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
        ...mastersMeets,
        ...welshMeets
      );

    } catch (err) {
      console.error('Core scraper execution failed:', err);
    }

    // 1. Normalize Meet Types across all sources (e.g., set meetType to 'Masters' if name contains 'masters')
    this.normalizeMeetTypes(allMeets);

    // 2. Initial deduplication by exact ID
    const uniqueMeetsMap = new Map<string, SwimMeet>();
    allMeets.forEach(m => {
      uniqueMeetsMap.set(m.id, m);
    });

    // 3. Smart fuzzy deduplication (overlapping dates, name similarity, location compatibility; favoring swimming.org)
    const dedupedMeets = this.deduplicateMeets(Array.from(uniqueMeetsMap.values()));
    const finalMeets = this.filterOlderThanToday(dedupedMeets);

    // Identify meets needing a fetch
    const meetsToFetch = finalMeets.filter(m =>
      (!m.location || m.location === 'Unknown Venue' || m.location === 'TBD' || m.location === 'Unknown') &&
      m.sourceUrl && m.sourceUrl.startsWith('http') &&
      !m.sourceUrl.includes('calendar.google.com') &&
      !m.sourceUrl.includes('.ics')
    );

    console.log(`[Scraper] Found ${meetsToFetch.length} meets needing location fetch. Fetching all items in parallel chunks...`);

    const detailConcurrency = 10;

    for (let i = 0; i < meetsToFetch.length; i += detailConcurrency) {
      const chunk = meetsToFetch.slice(i, i + detailConcurrency);
      await Promise.all(chunk.map(async (meet) => {
        const detailUrl = meet.sourceUrl;
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

    return { meets: finalMeets };
  }

  // Normalizes meet type fields based on meet name keywords
  public normalizeMeetTypes(meets: SwimMeet[]): void {
    meets.forEach(m => {
      if (m.name && /\bmasters\b/i.test(m.name) && m.meetType !== 'Masters') {
        m.meetType = 'Masters';
      }
    });
  }

  // Tokenize meet name into core keywords for fuzzy matching
  private extractCoreTokens(name: string): string[] {
    if (!name) return [];
    const cleaned = name
      .toLowerCase()
      .replace(/\b(202\d|203\d)\b/g, '')
      .replace(/\b\d+(th|st|nd|rd)\b/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const noiseWords = new Set([
      'meet', 'open', 'championship', 'championships', 'champs', 'gala', 'annual',
      'short', 'course', 'long', 'level', 'lvl', 'l1', 'l2', 'l3', 'l4', 'sc', 'lc',
      '25m', '50m', 'swimming', 'club', 'asa', 'se', 'sesw', 'sw', 'gb', 'uk',
      '1st', '2nd', '3rd', '4th', '5th'
    ]);

    const tokens = cleaned
      .split(/\s+/)
      .filter(t => t.length > 1 && !noiseWords.has(t));

    return Array.from(new Set(tokens)).sort();
  }

  // Parse start date from meet object for proximity checking
  private getMeetStartDate(meet: SwimMeet): Date | null {
    if (meet.formattedDate) {
      const parts = meet.formattedDate.split('-')[0].trim();
      const match = parts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        return new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10));
      }
    }
    return this.getEventEndDate(meet.date);
  }

  // Smart deduplication prioritizing swimming.org sourced entries
  public deduplicateMeets(meets: SwimMeet[]): SwimMeet[] {
    const result: SwimMeet[] = [];

    const getSourcePriority = (m: SwimMeet): number => {
      const url = (m.sourceUrl || '').toLowerCase();
      if (url.includes('swimming.org')) return 3; // Highest priority for swimming.org
      if (url.includes('swimmingresults.org') || url.includes('justgo.com') || url.includes('aquaticsgb.com') || url.includes('scotswim')) return 2;
      return 1; // Lowest priority for iCal/generic
    };

    for (const current of meets) {
      const currentTokens = this.extractCoreTokens(current.name);
      const currentStartDate = this.getMeetStartDate(current);

      let duplicateIndex = -1;

      for (let i = 0; i < result.length; i++) {
        const existing = result[i];
        const existingTokens = this.extractCoreTokens(existing.name);
        const existingStartDate = this.getMeetStartDate(existing);

        // 1. Check Date Match / Proximity (within 2 days in same year/month)
        let datesOverlap = false;
        if (currentStartDate && existingStartDate) {
          const diffDays = Math.abs(currentStartDate.getTime() - existingStartDate.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays <= 2) {
            datesOverlap = true;
          }
        } else if (current.formattedDate && existing.formattedDate && current.formattedDate === existing.formattedDate) {
          datesOverlap = true;
        }

        if (!datesOverlap) continue;

        // 2. Check Region Match / Compatibility
        if (current.region && existing.region &&
            current.region !== 'Unknown' && existing.region !== 'Unknown' &&
            current.region.toLowerCase() !== existing.region.toLowerCase()) {
          continue;
        }

        // 3. Check Name Similarity
        let namesMatch = false;
        const currentTokenStr = currentTokens.join(' ');
        const existingTokenStr = existingTokens.join(' ');

        if (currentTokenStr && existingTokenStr && currentTokenStr === existingTokenStr) {
          namesMatch = true;
        } else if (currentTokens.length >= 2 && existingTokens.length >= 2) {
          const intersection = currentTokens.filter(t => existingTokens.includes(t));
          const union = new Set([...currentTokens, ...existingTokens]);
          const jaccard = intersection.length / union.size;

          if (jaccard >= 0.6 || (intersection.length >= 2 && (intersection.length === currentTokens.length || intersection.length === existingTokens.length))) {
            namesMatch = true;
          }
        } else if (currentTokens.length === 1 && existingTokens.length === 1 && currentTokens[0] === existingTokens[0]) {
          namesMatch = true;
        }

        if (datesOverlap && namesMatch) {
          duplicateIndex = i;
          break;
        }
      }

      if (duplicateIndex !== -1) {
        const existing = result[duplicateIndex];
        const currentPriority = getSourcePriority(current);
        const existingPriority = getSourcePriority(existing);

        if (currentPriority > existingPriority) {
          // Replace existing with current (swimming.org favored), enrich location/course/level if existing had better info
          if ((!current.location || current.location === 'Unknown Venue' || current.location === 'TBD' || current.location.length < existing.location.length) &&
              existing.location && existing.location !== 'Unknown Venue' && existing.location !== 'TBD') {
            current.location = existing.location;
          }
          if ((!current.course || current.course === 'Unknown') && existing.course && existing.course !== 'Unknown') {
            current.course = existing.course;
          }
          if ((!current.level || current.level === 'Unknown') && existing.level && existing.level !== 'Unknown') {
            current.level = existing.level;
          }
          result[duplicateIndex] = current;
          console.log(`[Dedup] Replaced "${existing.name}" (${existing.id}) with higher priority swimming.org entry "${current.name}" (${current.id})`);
        } else {
          // Keep existing, enrich existing with current info if better
          if ((!existing.location || existing.location === 'Unknown Venue' || existing.location === 'TBD' || existing.location.length < current.location.length) &&
              current.location && current.location !== 'Unknown Venue' && current.location !== 'TBD') {
            existing.location = current.location;
          }
          if ((!existing.course || existing.course === 'Unknown') && current.course && current.course !== 'Unknown') {
            existing.course = current.course;
          }
          if ((!existing.level || existing.level === 'Unknown') && current.level && current.level !== 'Unknown') {
            existing.level = current.level;
          }
          console.log(`[Dedup] Kept existing priority entry "${existing.name}" (${existing.id}), skipped duplicate "${current.name}" (${current.id})`);
        }
      } else {
        result.push(current);
      }
    }

    return result;
  }
}
