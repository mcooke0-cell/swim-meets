// State Management
let rawMeets = [];
let regions = [];
let meetTypes = [];
let months = [];

const state = {
  search: '',
  selectedRegions: new Set(),
  selectedMeetTypes: new Set(),
  selectedMonths: new Set()
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Locations to highlight in the table view (case-insensitive substring match)
// Feel free to add/remove names in this list.
const HIGHLIGHTED_LOCATIONS = [
  "Millfield",
  "Street",
  "Bodmin",
  "Penzance",
  "Penznance", // Spelling fallback
  "Plymouth",
  "Tiverton",
  "Bristol",
  "Newport",
  "Swansea",
  "Exeter",
  "Taunton",
  "Weston"
];

function shouldHighlightMeet(meet) {
  if (!meet.location) return false;
  const locLower = meet.location.toLowerCase();
  return HIGHLIGHTED_LOCATIONS.some(hl => locLower.includes(hl.toLowerCase()));
}

function getCourseAbbreviation(course) {
  if (!course) return 'TBD';
  const cLower = course.toLowerCase();
  if (cLower.includes('short course') || cLower.includes('25m')) return 'SC';
  if (cLower.includes('long course') || cLower.includes('50m')) return 'LC';
  return course;
}

// DOM Elements
let searchInput, clearSearchBtn, resetFiltersBtn;
let regionCustomSelect, regionTrigger, regionOptions;
let meetTypeCustomSelect, meetTypeTrigger, meetTypeOptions;
let monthCustomSelect, monthTrigger, monthOptions;
let meetsCountElement, lastUpdatedElement, loadingState, errorState, emptyState;
let tableContainer, meetsTableBody, emptyStateResetBtn;

// Initialize Application
async function init() {
  // Bind DOM Elements
  searchInput = document.getElementById('search-input');
  clearSearchBtn = document.getElementById('clear-search-btn');
  resetFiltersBtn = document.getElementById('reset-filters-btn');
  meetsCountElement = document.getElementById('meets-count');
  lastUpdatedElement = document.getElementById('last-updated');

  loadingState = document.getElementById('loading-state');
  errorState = document.getElementById('error-state');
  emptyState = document.getElementById('empty-state');
  tableContainer = document.getElementById('table-container');
  meetsTableBody = document.getElementById('meets-table-body');
  emptyStateResetBtn = document.getElementById('empty-state-reset-btn');

  // Custom Dropdown Elements
  regionCustomSelect = document.getElementById('region-custom-select');
  regionTrigger = document.getElementById('region-trigger');
  regionOptions = document.getElementById('region-options');

  meetTypeCustomSelect = document.getElementById('meet-type-custom-select');
  meetTypeTrigger = document.getElementById('meet-type-trigger');
  meetTypeOptions = document.getElementById('meet-type-options');

  monthCustomSelect = document.getElementById('month-custom-select');
  monthTrigger = document.getElementById('month-trigger');
  monthOptions = document.getElementById('month-options');

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
    
    // Set default selections
    setDefaultFilters();
    
    // Populate dropdown HTML elements
    populateDropdowns();
    
    // Render initial page list
    renderMeets();
    
    // Hide loader
    if (loadingState) loadingState.style.display = 'none';
    
  } catch (error) {
    console.error('Error loading swim meets:', error);
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) errorState.style.display = 'flex';
  }
}

// Convert ISO string date or short text date to a JS Date
function getStartDate(dateString) {
  if (!dateString) return new Date();
  
  // Format matches "24 Jan 2026" or "24-25 Jan 2026" or "24 Jan - 1 Feb 2026"
  const cleanStr = dateString.split('-')[0].trim();
  
  // Parse month and year from string if split didn't contain month
  const parts = cleanStr.split(/\s+/);
  if (parts.length === 1 && !isNaN(Date.parse(cleanStr))) {
    return new Date(cleanStr);
  }
  
  // Try directly parsing
  const parsed = Date.parse(cleanStr);
  if (!isNaN(parsed)) return new Date(parsed);
  
  // Attempt to scan for a year and a month name in the original full string
  let year = new Date().getFullYear();
  const yearMatch = dateString.match(/\b(202\d)\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);
  
  let monthIndex = new Date().getMonth();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (dateString.toLowerCase().includes(MONTH_NAMES[i].toLowerCase().substring(0, 3))) {
      monthIndex = i;
      break;
    }
  }
  
  // Day parsing
  let day = 1;
  const dayMatch = parts[0] ? parts[0].match(/\d+/) : null;
  if (dayMatch) day = parseInt(dayMatch[0], 10);
  
  return new Date(year, monthIndex, day);
}

// Determine Month Name for a meet
function getMeetMonthName(meet) {
  if (!meet.date) return null;
  
  // First, extract the date part (before any year boundary or range)
  const datePart = meet.date.trim();
  
  // Look for full month names
  for (const name of MONTH_NAMES) {
    const reg = new RegExp(`\\b${name}\\b`, 'i');
    if (reg.test(datePart)) {
      return name;
    }
  }
  
  // Try parsing Date
  const parsedDate = getStartDate(meet.date);
  if (parsedDate && !isNaN(parsedDate.getTime())) {
    const monthIndex = parsedDate.getMonth();
    if (monthIndex >= 0 && monthIndex < 12) {
      return MONTH_NAMES[monthIndex];
    }
  }
  
  // Fallback: Check if raw textual date contains month name abbreviation
  const rawLower = datePart.toLowerCase();
  for (const name of MONTH_NAMES) {
    if (rawLower.includes(name.toLowerCase().substring(0, 3))) {
      return name;
    }
  }
  
  return null;
}

// Extract unique regions, meet types, and months sorted
function extractFilterOptions(meets) {
  const regionsSet = new Set();
  const meetTypesSet = new Set();
  const monthsSet = new Set();
  
  meets.forEach(meet => {
    if (meet.region) regionsSet.add(meet.region);
    if (meet.meetType) meetTypesSet.add(meet.meetType);
    
    const monthName = getMeetMonthName(meet);
    if (monthName) monthsSet.add(monthName);
  });
  
  regions = Array.from(regionsSet).sort((a, b) => a.localeCompare(b));
  meetTypes = Array.from(meetTypesSet).sort((a, b) => a.localeCompare(b));
  
  // Sort months chronologically according to MONTH_NAMES index
  months = Array.from(monthsSet).sort((a, b) => {
    return MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b);
  });
}

function setDefaultFilters() {
  // 1. Default Regions: select South West, National, GB, England, Scotland, Wales
  const defaultRegionsToSelect = ['south west', 'national', 'gb', 'england', 'scotland', 'wales'];
  regions.forEach(r => {
    if (defaultRegionsToSelect.includes(r.toLowerCase().trim())) {
      state.selectedRegions.add(r);
    }
  });

  // 2. Default Meet Types: exclude Club Champs and League
  const meetTypesToExclude = ['club champs', 'league'];
  meetTypes.forEach(t => {
    const tLower = t.toLowerCase().trim();
    const shouldExclude = meetTypesToExclude.some(exclude => tLower.includes(exclude));
    if (!shouldExclude) {
      state.selectedMeetTypes.add(t);
    }
  });
}

// Populate Custom Dropdown Lists
function populateDropdowns() {
  // 1. Regions
  if (regionOptions) {
    regionOptions.innerHTML = '';
    regions.forEach(region => {
      const label = document.createElement('label');
      label.className = 'option-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = region;
      
      if (state.selectedRegions.has(region)) {
        checkbox.checked = true;
        label.classList.add('checked');
      }
      
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedRegions.add(region);
          label.classList.add('checked');
        } else {
          state.selectedRegions.delete(region);
          label.classList.remove('checked');
        }
        updateTriggerText(regionTrigger, state.selectedRegions, 'Region', 'Regions');
        renderMeets();
      });
      
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(region));
      regionOptions.appendChild(label);
    });
  }

  // 2. Meet Types
  if (meetTypeOptions) {
    meetTypeOptions.innerHTML = '';
    meetTypes.forEach(type => {
      const label = document.createElement('label');
      label.className = 'option-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = type;
      
      if (state.selectedMeetTypes.has(type)) {
        checkbox.checked = true;
        label.classList.add('checked');
      }
      
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedMeetTypes.add(type);
          label.classList.add('checked');
        } else {
          state.selectedMeetTypes.delete(type);
          label.classList.remove('checked');
        }
        updateTriggerText(meetTypeTrigger, state.selectedMeetTypes, 'Meet Type', 'Meet Types');
        renderMeets();
      });
      
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(type));
      meetTypeOptions.appendChild(label);
    });
  }

  // 3. Months
  if (monthOptions) {
    monthOptions.innerHTML = '';
    months.forEach(month => {
      const label = document.createElement('label');
      label.className = 'option-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = month;
      
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedMonths.add(month);
          label.classList.add('checked');
        } else {
          state.selectedMonths.delete(month);
          label.classList.remove('checked');
        }
        updateTriggerText(monthTrigger, state.selectedMonths, 'Month', 'Months');
        renderMeets();
      });
      
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(month));
      monthOptions.appendChild(label);
    });
  }

  // Initialize trigger text representations
  updateTriggerText(regionTrigger, state.selectedRegions, 'Region', 'Regions');
  updateTriggerText(meetTypeTrigger, state.selectedMeetTypes, 'Meet Type', 'Meet Types');
  updateTriggerText(monthTrigger, state.selectedMonths, 'Month', 'Months');
}

// Update the label text displayed on custom select triggers
function updateTriggerText(triggerElement, selectedSet, singularLabel, pluralLabel) {
  if (!triggerElement) return;
  const textSpan = triggerElement.querySelector('.trigger-text');
  if (!textSpan) return;

  if (selectedSet.size === 0) {
    textSpan.textContent = `All ${pluralLabel}`;
  } else if (selectedSet.size === 1) {
    textSpan.textContent = Array.from(selectedSet)[0];
  } else {
    textSpan.textContent = `${selectedSet.size} ${pluralLabel} selected`;
  }
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
    if (state.selectedRegions.size > 0) {
      if (!meet.region || !state.selectedRegions.has(meet.region)) return false;
    }

    // 3. Meet Type Filter
    if (state.selectedMeetTypes.size > 0) {
      if (!meet.meetType || !state.selectedMeetTypes.has(meet.meetType)) return false;
    }
    
    // 4. Month Filter
    if (state.selectedMonths.size > 0) {
      const monthName = getMeetMonthName(meet);
      if (!monthName || !state.selectedMonths.has(monthName)) return false;
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

  const holidayBadgeHTML = meet.isHoliday 
    ? '<span class="holiday-badge">🏖️ Holiday</span>' 
    : '';

  const highlightClass = shouldHighlightMeet(meet) ? 'highlighted-meet' : '';

  return `
    <tr class="${highlightClass}">
      <td class="col-date" data-label="Date">${escapeHTML(displayDate)}</td>
      <td class="col-meet-name cell-meet-name" data-label="Meet">
        <div class="meet-name-wrapper">
          <span class="meet-name-text">${escapeHTML(meet.name)}</span>
          ${holidayBadgeHTML}
        </div>
      </td>
      <td data-label="Location">
        <div class="col-location-info">
          <span class="location-name">${escapeHTML(displayLocation)}</span>
          <span class="region-tag">${escapeHTML(displayRegion)}</span>
        </div>
      </td>
      <td data-label="Format">
        <div class="col-course-info">
          <span class="course-format">
            <span class="course-desktop">${escapeHTML(displayCourse)}</span>
            <span class="course-mobile">${escapeHTML(getCourseAbbreviation(displayCourse))}</span>
          </span>
          <span class="level-badge">${escapeHTML(displayLevel)}</span>
        </div>
      </td>
      <td data-label="Type">
        <span class="type-tag">${escapeHTML(meet.meetType || 'Other')}</span>
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

  // Dropdown Toggles
  if (regionTrigger) {
    regionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(regionCustomSelect);
    });
  }

  if (meetTypeTrigger) {
    meetTypeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(meetTypeCustomSelect);
    });
  }

  if (monthTrigger) {
    monthTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(monthCustomSelect);
    });
  }

  // Prevent dropdown closing when clicking options
  if (regionOptions) regionOptions.addEventListener('click', (e) => e.stopPropagation());
  if (meetTypeOptions) meetTypeOptions.addEventListener('click', (e) => e.stopPropagation());
  if (monthOptions) monthOptions.addEventListener('click', (e) => e.stopPropagation());

  // Close dropdowns on clicking outside
  document.addEventListener('click', () => {
    closeAllDropdowns();
  });

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }

  if (emptyStateResetBtn) {
    emptyStateResetBtn.addEventListener('click', resetFilters);
  }
}

// Toggle a single dropdown
function toggleDropdown(customSelectElement) {
  if (!customSelectElement) return;
  const isOpen = customSelectElement.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    customSelectElement.classList.add('open');
    const trigger = customSelectElement.querySelector('.select-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

// Close all custom dropdowns
function closeAllDropdowns() {
  const selects = document.querySelectorAll('.custom-select');
  selects.forEach(select => {
    select.classList.remove('open');
    const trigger = select.querySelector('.select-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function resetFilters() {
  state.search = '';
  state.selectedRegions.clear();
  state.selectedMeetTypes.clear();
  state.selectedMonths.clear();
  
  // Sync inputs
  if (searchInput) searchInput.value = '';
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  
  // Uncheck all checkbox inputs in dropdown lists
  const checkboxes = document.querySelectorAll('.options-container input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = false;
    const label = cb.closest('.option-item');
    if (label) label.classList.remove('checked');
  });

  // Reset triggers labels text representation
  updateTriggerText(regionTrigger, state.selectedRegions, 'Region', 'Regions');
  updateTriggerText(meetTypeTrigger, state.selectedMeetTypes, 'Meet Type', 'Meet Types');
  updateTriggerText(monthTrigger, state.selectedMonths, 'Month', 'Months');

  renderMeets();
}

// Update Last Updated indicator
function updateLastUpdated(dateStr) {
  if (lastUpdatedElement && dateStr) {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      lastUpdatedElement.textContent = `Last updated: ${date.toLocaleDateString('en-GB', options)}`;
      return;
    }
    lastUpdatedElement.textContent = `Last updated: ${dateStr}`;
  }
}

// Run Init safely depending on document readyState
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
