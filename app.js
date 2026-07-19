// State Management
let rawMeets = [];
let regions = [];
let months = [];

const state = {
  search: '',
  selectedRegion: 'all',
  selectedMonth: 'all'
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// DOM Elements
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const regionSelect = document.getElementById('region-select');
const monthSelect = document.getElementById('month-select');
const resetFiltersBtn = document.getElementById('reset-filters-btn');
const meetsCountElement = document.getElementById('meets-count');
const lastUpdatedElement = document.getElementById('last-updated');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const emptyState = document.getElementById('empty-state');
const tableContainer = document.getElementById('table-container');
const meetsTableBody = document.getElementById('meets-table-body');
const emptyStateResetBtn = document.getElementById('empty-state-reset-btn');

// Initialize Application
async function init() {
  try {
    const response = await fetch('./meets.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    rawMeets = data.meets || [];
    
    // Set Metadata
    updateLastUpdated(data.lastUpdated);
    
    // Parse Filter Options
    extractFilterOptions(rawMeets);
    
    // Populate dropdown HTML elements
    populateDropdowns();
    
    // Render Initial List
    renderMeets();
    
    // Transition UI from loading to active
    loadingState.style.display = 'none';
    tableContainer.style.display = 'block';
  } catch (err) {
    console.error('Error fetching meets data:', err);
    loadingState.style.display = 'none';
    errorState.style.display = 'flex';
  }
}

// Format and Display Scraped Time
function updateLastUpdated(isoString) {
  if (!isoString) {
    lastUpdatedElement.textContent = 'Last updated: unknown';
    return;
  }
  
  try {
    const date = new Date(isoString);
    const options = { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    };
    lastUpdatedElement.textContent = `Last updated: ${date.toLocaleDateString('en-GB', options)}`;
  } catch (e) {
    lastUpdatedElement.textContent = `Last updated: ${isoString}`;
  }
}

// Parse month string from UK format DD/MM/YYYY
function getMeetMonthName(meet) {
  const dateStr = meet.formattedDate || meet.date;
  if (!dateStr) return null;
  
  // Extract first date if it's a range e.g. "16/07/2026 - 22/07/2026"
  const datePart = dateStr.split('-')[0].trim();
  const parts = datePart.split('/');
  
  if (parts.length === 3) {
    const monthIndex = parseInt(parts[1], 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return MONTH_NAMES[monthIndex];
    }
  }
  
  // Fallback: Check if raw textual date contains month name
  const rawLower = datePart.toLowerCase();
  for (const name of MONTH_NAMES) {
    if (rawLower.includes(name.toLowerCase().substring(0, 3))) {
      return name;
    }
  }
  
  return null;
}

// Extract unique regions and months sorted alphabetically/chronologically
function extractFilterOptions(meets) {
  const regionsSet = new Set();
  const monthsSet = new Set();
  
  meets.forEach(meet => {
    if (meet.region) regionsSet.add(meet.region);
    
    const monthName = getMeetMonthName(meet);
    if (monthName) monthsSet.add(monthName);
  });
  
  regions = Array.from(regionsSet).sort((a, b) => a.localeCompare(b));
  
  // Sort months chronologically according to MONTH_NAMES index
  months = Array.from(monthsSet).sort((a, b) => {
    return MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b);
  });
}

// Populate Select Options
function populateDropdowns() {
  // Region Select Options
  regionSelect.innerHTML = '<option value="all">All Regions</option>';
  regions.forEach(region => {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    regionSelect.appendChild(option);
  });

  // Month Select Options
  monthSelect.innerHTML = '<option value="all">All Months</option>';
  months.forEach(month => {
    const option = document.createElement('option');
    option.value = month;
    option.textContent = month;
    monthSelect.appendChild(option);
  });
}

// Filter and Render Table Rows
function renderMeets() {
  const query = state.search.toLowerCase().trim();
  
  // Filter Array
  const filteredMeets = rawMeets.filter(meet => {
    // 1. Search Query
    if (query) {
      const nameMatch = meet.name && meet.name.toLowerCase().includes(query);
      const locMatch = meet.location && meet.location.toLowerCase().includes(query);
      const regionMatch = meet.region && meet.region.toLowerCase().includes(query);
      if (!nameMatch && !locMatch && !regionMatch) return false;
    }
    
    // 2. Region Filter
    if (state.selectedRegion !== 'all') {
      if (!meet.region || meet.region !== state.selectedRegion) return false;
    }
    
    // 3. Month Filter
    if (state.selectedMonth !== 'all') {
      const monthName = getMeetMonthName(meet);
      if (!monthName || monthName !== state.selectedMonth) return false;
    }
    
    return true;
  });
  
  // Update count indicator
  meetsCountElement.textContent = `${filteredMeets.length} Meet${filteredMeets.length === 1 ? '' : 's'}`;
  
  // Display checks
  if (filteredMeets.length === 0) {
    tableContainer.style.display = 'none';
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    tableContainer.style.display = 'block';
    
    // Build Table Rows
    meetsTableBody.innerHTML = filteredMeets.map(meet => createTableRowHTML(meet)).join('');
  }
}

// Build table row HTML with attributes for responsive mobile card views
function createTableRowHTML(meet) {
  const displayDate = meet.formattedDate || meet.date;
  const displayLocation = meet.location || 'TBD';
  const displayRegion = meet.region || 'Unknown';
  const displayCourse = meet.course || 'TBD';
  const displayLevel = meet.level || 'TBD';

  // Link setup
  const visitLinkHTML = meet.sourceUrl 
    ? `<a href="${meet.sourceUrl}" target="_blank" rel="noopener noreferrer" class="visit-link" aria-label="Visit details for ${escapeHTML(meet.name)}">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
           <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
           <polyline points="15 3 21 3 21 9"></polyline>
           <line x1="10" y1="14" x2="21" y2="3"></line>
         </svg>
       </a>`
    : '<span class="text-secondary">-</span>';

  return `
    <tr>
      <td class="col-date" data-label="Date">${escapeHTML(displayDate)}</td>
      <td class="col-meet-name cell-meet-name" data-label="Meet">${escapeHTML(meet.name)}</td>
      <td data-label="Location">
        <div class="col-location-info">
          <span class="location-name">${escapeHTML(displayLocation)}</span>
          <span class="region-tag">${escapeHTML(displayRegion)}</span>
        </div>
      </td>
      <td data-label="Format">
        <div class="col-course-info">
          <span class="course-format">${escapeHTML(displayCourse)}</span>
          <span class="level-badge">${escapeHTML(displayLevel)}</span>
        </div>
      </td>
      <td class="text-center" data-label="Info">${visitLinkHTML}</td>
    </tr>
  `;
}

// Utility to escape HTML output
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Event Listeners
searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  if (state.search) {
    clearSearchBtn.style.display = 'flex';
  } else {
    clearSearchBtn.style.display = 'none';
  }
  renderMeets();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  state.search = '';
  clearSearchBtn.style.display = 'none';
  renderMeets();
  searchInput.focus();
});

regionSelect.addEventListener('change', (e) => {
  state.selectedRegion = e.target.value;
  renderMeets();
});

monthSelect.addEventListener('change', (e) => {
  state.selectedMonth = e.target.value;
  renderMeets();
});

function resetFilters() {
  state.search = '';
  state.selectedRegion = 'all';
  state.selectedMonth = 'all';
  
  // Sync inputs
  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  regionSelect.value = 'all';
  monthSelect.value = 'all';
  
  renderMeets();
}

resetFiltersBtn.addEventListener('click', resetFilters);
emptyStateResetBtn.addEventListener('click', resetFilters);

// Run Init
init();
