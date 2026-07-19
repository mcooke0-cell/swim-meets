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
let searchInput, clearSearchBtn, regionSelect, monthSelect, resetFiltersBtn;
let meetsCountElement, lastUpdatedElement, loadingState, errorState, emptyState;
let tableContainer, meetsTableBody, emptyStateResetBtn;

// Initialize Application
async function init() {
  // Bind DOM Elements
  searchInput = document.getElementById('search-input');
  clearSearchBtn = document.getElementById('clear-search-btn');
  regionSelect = document.getElementById('region-select');
  monthSelect = document.getElementById('month-select');
  resetFiltersBtn = document.getElementById('reset-filters-btn');
  meetsCountElement = document.getElementById('meets-count');
  lastUpdatedElement = document.getElementById('last-updated');

  loadingState = document.getElementById('loading-state');
  errorState = document.getElementById('error-state');
  emptyState = document.getElementById('empty-state');
  tableContainer = document.getElementById('table-container');
  meetsTableBody = document.getElementById('meets-table-body');
  emptyStateResetBtn = document.getElementById('empty-state-reset-btn');

  // Set up Event Listeners
  setupEventListeners();

  try {
    // Fetch local JSON data
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
    if (loadingState) loadingState.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';
  } catch (err) {
    console.error('Error fetching meets data:', err);
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) errorState.style.display = 'flex';
  }
}

// Format and Display Scraped Time
function updateLastUpdated(isoString) {
  if (!lastUpdatedElement) return;
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
  if (!regionSelect || !monthSelect) return;

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
  if (meetsCountElement) {
    meetsCountElement.textContent = `${filteredMeets.length} Meet${filteredMeets.length === 1 ? '' : 's'}`;
  }
  
  // Display checks
  if (filteredMeets.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';
    
    // Build Table Rows
    if (meetsTableBody) {
      meetsTableBody.innerHTML = filteredMeets.map(meet => createTableRowHTML(meet)).join('');
    }
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

// Event Listeners Setup
function setupEventListeners() {
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = state.search ? 'flex' : 'none';
      }
      renderMeets();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      state.search = '';
      clearSearchBtn.style.display = 'none';
      renderMeets();
    });
  }

  if (regionSelect) {
    regionSelect.addEventListener('change', (e) => {
      state.selectedRegion = e.target.value;
      renderMeets();
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener('change', (e) => {
      state.selectedMonth = e.target.value;
      renderMeets();
    });
  }

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }

  if (emptyStateResetBtn) {
    emptyStateResetBtn.addEventListener('click', resetFilters);
  }
}

function resetFilters() {
  state.search = '';
  state.selectedRegion = 'all';
  state.selectedMonth = 'all';
  
  // Sync inputs
  if (searchInput) searchInput.value = '';
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  if (regionSelect) regionSelect.value = 'all';
  if (monthSelect) monthSelect.value = 'all';
  
  renderMeets();
}

// Run Init on DOM Content Loaded
document.addEventListener('DOMContentLoaded', init);
