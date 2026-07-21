import * as cheerio from 'cheerio';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface Term {
  name: string;
  start: Date;
  end: Date;
}

function parseDateStr(str: string, year: number): Date {
  // Remove day of week if present, e.g., "Monday, " or "Monday "
  const clean = str.replace(/^[A-Za-z]+,?\s*/, '').trim();
  const parts = clean.split(/\s+/);
  const day = parseInt(parts[0], 10);
  const monthName = parts[1].replace(/[^A-Za-z]/g, '').toLowerCase();
  
  const months: { [key: string]: number } = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11
  };
  
  const month = months[monthName];
  if (month === undefined) {
    throw new Error(`Unknown month "${monthName}" in date string: "${str}"`);
  }
  return new Date(year, month, day);
}

function parseDateOrRange(str: string, year: number): DateRange {
  const rangeParts = str.split(/\s+to\s+/i);
  if (rangeParts.length === 2) {
    const start = parseDateStr(rangeParts[0], year);
    const end = parseDateStr(rangeParts[1], year);
    return { start, end };
  } else {
    const date = parseDateStr(str, year);
    return { start: date, end: date };
  }
}

export async function fetchTruroTermDates(): Promise<{ terms: Term[]; halfTerms: DateRange[] }> {
  const terms: Term[] = [];
  const halfTerms: DateRange[] = [];
  
  try {
    console.log("[Truro School] Fetching term dates page...");
    const res = await fetch('https://www.truroschool.com/parents/term-dates/');
    if (!res.ok) {
      throw new Error(`Failed to fetch Truro term dates: HTTP status ${res.status}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    
    $('table').each((_, table) => {
      const termHeaderRow = $(table).find('tr').first();
      const termName = termHeaderRow.text().trim().replace(/\s+/g, ' ');
      
      const match = termName.match(/(Autumn|Spring|Summer)\s+Term\s+(\d{4})/i);
      if (!match) return; // Skip non-term tables
      
      const termType = match[1];
      const year = parseInt(match[2], 10);
      
      let termStart: Date | null = null;
      let termEnd: Date | null = null;
      
      $(table).find('tr').slice(1).each((_, tr) => {
        const cells = $(tr).find('td, th').map((__, cell) => $(cell).text().trim().replace(/\s+/g, ' ')).get();
        if (cells.length < 2) return;
        
        const event = cells[0].toLowerCase();
        const dateStr = cells[1];
        
        try {
          if (event.includes('begins') && !event.includes('boarders') && !event.includes('induction')) {
            const range = parseDateOrRange(dateStr, year);
            termStart = range.start;
          } else if (event.includes('end of term')) {
            const range = parseDateOrRange(dateStr, year);
            termEnd = range.end;
          } else if (event.includes('half term')) {
            const range = parseDateOrRange(dateStr, year);
            halfTerms.push(range);
          }
        } catch (err: any) {
          console.warn(`[Truro School] Warning parsing row "${cells[0]} => ${cells[1]}" in ${termName}:`, err.message);
        }
      });
      
      if (termStart && termEnd) {
        terms.push({
          name: termName,
          start: termStart,
          end: termEnd
        });
      } else {
        console.warn(`[Truro School] Could not resolve complete term dates for ${termName}`);
      }
    });
    
    console.log(`[Truro School] Successfully parsed ${terms.length} terms and ${halfTerms.length} half-term holidays.`);
  } catch (err) {
    console.error("[Truro School] Error parsing term dates:", err);
  }
  
  return { terms, halfTerms };
}

export function isSchoolHoliday(date: Date, terms: Term[], halfTerms: DateRange[]): boolean {
  // Normalize date to midnight (00:00:00) for comparison
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const addDays = (baseDate: Date, days: number) => {
    const res = new Date(baseDate.getTime());
    res.setDate(res.getDate() + days);
    return res;
  };

  // 1. Check Half Terms (including prior weekend if half-term starts on a Monday)
  for (const ht of halfTerms) {
    const start = new Date(ht.start.getFullYear(), ht.start.getMonth(), ht.start.getDate());
    const end = new Date(ht.end.getFullYear(), ht.end.getMonth(), ht.end.getDate());
    
    // If half-term starts on a Monday (getDay() === 1), consider the weekend prior (Saturday & Sunday) as holiday
    const effectiveStart = start.getDay() === 1 ? addDays(start, -2) : start;
    
    if (d >= effectiveStart && d <= end) {
      return true;
    }
  }

  // 2. Check Major Holiday periods between and after/before terms
  const sortedTerms = [...terms].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Check if date falls in the holiday period BEFORE the first term
  if (sortedTerms.length > 0) {
    const firstTermStart = new Date(sortedTerms[0].start.getFullYear(), sortedTerms[0].start.getMonth(), sortedTerms[0].start.getDate());
    if (d < firstTermStart) {
      return true;
    }
  }

  // Check gaps between terms
  for (let i = 0; i < sortedTerms.length - 1; i++) {
    const currentTermEnd = new Date(sortedTerms[i].end.getFullYear(), sortedTerms[i].end.getMonth(), sortedTerms[i].end.getDate());
    const nextTermStart = new Date(sortedTerms[i + 1].start.getFullYear(), sortedTerms[i + 1].start.getMonth(), sortedTerms[i + 1].start.getDate());

    const holidayStart = addDays(currentTermEnd, 1);
    const holidayEnd = addDays(nextTermStart, -1);

    // If holidayStart is a Monday (getDay() === 1), include the weekend prior (Saturday & Sunday)
    const effectiveHolidayStart = holidayStart.getDay() === 1 ? addDays(holidayStart, -2) : holidayStart;

    if (d >= effectiveHolidayStart && d <= holidayEnd) {
      return true;
    }
  }

  // Check holiday AFTER the last term
  if (sortedTerms.length > 0) {
    const lastTermEnd = new Date(sortedTerms[sortedTerms.length - 1].end.getFullYear(), sortedTerms[sortedTerms.length - 1].end.getMonth(), sortedTerms[sortedTerms.length - 1].end.getDate());
    const holidayStart = addDays(lastTermEnd, 1);
    const effectiveHolidayStart = holidayStart.getDay() === 1 ? addDays(holidayStart, -2) : holidayStart;

    if (d >= effectiveHolidayStart) {
      return true;
    }
  }

  return false;
}
