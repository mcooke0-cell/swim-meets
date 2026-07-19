import { google } from 'googleapis';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Clears the specified range/tab in Google Sheets and overwrites it with new data.
 * @param spreadsheetId Google Spreadsheet ID
 * @param range Sheet/Tab name (e.g., 'Meets')
 * @param headers Column header strings
 * @param rows Double array of sheet rows
 */
export async function updateGoogleSheet(
  spreadsheetId: string,
  range: string,
  headers: string[],
  rows: any[][]
): Promise<void> {
  const credentialsPath = path.join(process.cwd(), 'credentials.json');
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Credentials file not found at ${credentialsPath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  let sheetId: number | undefined;

  // 1. Try to delete and recreate the sheet to clear all old formatting, rules, and filters
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === range);
    if (existingSheet) {
      sheetId = existingSheet.properties?.sheetId;
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteSheet: {
                  sheetId,
                },
              },
            ],
          },
        });
        
        // Re-create the sheet
        const addResult = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: range,
                  },
                },
              },
            ],
          },
        });
        sheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
      } catch (delErr) {
        // If delete fails (e.g. it is the only sheet in the document), fallback to clearing values
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range,
        });
      }
    } else {
      // If it doesn't exist, create it
      const addResult = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: range,
                },
              },
            },
          ],
        },
      });
      sheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
    }
  } catch (err) {
    console.warn(`[Sheets] Recreate sheet failed for '${range}', falling back to clear values:`, err);
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });
  }

  // 2. Prepare the values payload (header row + data rows)
  const values = [headers, ...rows];

  // 3. Write new values to the sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values,
    },
  });

  // Update spreadsheet locale to en_GB to ensure correct UK English date parsing
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSpreadsheetProperties: {
              properties: {
                locale: 'en_GB',
              },
              fields: 'locale',
            },
          },
        ],
      },
    });
  } catch (localeErr) {
    console.warn(`[Sheets] Failed to set spreadsheet locale:`, localeErr);
  }

  // 4. Resolve sheetId if needed and apply filters/formatting
  try {
    if (sheetId === undefined) {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === range);
      sheetId = sheet?.properties?.sheetId;
    }

    if (sheetId !== undefined) {
      const totalRows = values.length;
      const totalCols = headers.length;

      const criteria: { [key: string]: any } = {};
      if (range === 'Meets') {
        // Column index 6 is 'Meet Type'
        criteria['6'] = {
          hiddenValues: ['Club Champs'],
        };
      }

      const batchRequests: any[] = [
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: totalRows,
                startColumnIndex: 0,
                endColumnIndex: totalCols,
              },
              criteria,
            },
          },
        },
      ];

      // If the tab is 'Meets', add conditional formatting to highlight rows that are school holidays (Column H, index 7 is "Yes")
      if (range === 'Meets' && totalRows > 1) {
        batchRequests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 1, // Skip header row
                  endRowIndex: totalRows,
                  startColumnIndex: 0,
                  endColumnIndex: totalCols,
                },
              ],
              booleanRule: {
                condition: {
                  type: 'CUSTOM_FORMULA',
                  values: [
                    {
                      userEnteredValue: '=$H2="Yes"',
                    },
                  ],
                },
                format: {
                  backgroundColor: {
                    red: 0.98,
                    green: 0.92,
                    blue: 0.84, // Soft orange/peach highlight
                  },
                },
              },
            },
            index: 0,
          },
        });
      }


      // Auto-resize all columns for best fit
      batchRequests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: totalCols,
          },
        },
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: batchRequests,
        },
      });
      console.log(`[Sheets] Applied filters/formatting for tab '${range}' successfully.`);
    }
  } catch (err) {
    console.warn(`[Sheets] Failed to apply filters/formatting for tab '${range}':`, err);
  }
}
