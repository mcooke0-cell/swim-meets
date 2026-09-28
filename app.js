// State Management
let rawMeets = [];
let regions = [];
let meetTypes = [];

const state = {
  search: '',
  selectedRegions: new Set(),
  selectedMeetTypes: new Set()
};

function getCourseLength(course) {
  if (!course) return 'TBD';
  const cLower = course.toLowerCase();
  if (cLower.includes('50m') || cLower.includes('long course')) return '50m';
  if (cLower.includes('25m') || cLower.includes('short course')) return '25m';
  return course;
}

// Helper to assign distinct CSS class for meet types
function getMeetTypeClass(meetType) {
  if (!meetType) return 'type-other';
  const tLower = meetType.toLowerCase();
  if (tLower.includes('national')) return 'type-national';
  if (tLower.includes('regional')) return 'type-regional';
  if (tLower.includes('county') || tLower.includes('championship')) return 'type-championship';
  if (tLower.includes('open')) return 'type-open';
  if (tLower.includes('masters')) return 'type-masters';
  if (tLower.includes('club')) return 'type-club';
  if (tLower.includes('league') || tLower.includes('gala')) return 'type-league';
  return 'type-other';
}

// DOM Elements
let searchInput, clearSearchBtn, resetFiltersBtn;
let regionCustomSelect, regionTrigger, regionOptions;
let meetTypeCustomSelect, meetTypeTrigger, meetTypeOptions;
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

  // Set up Event Listeners
  setupEventListeners();

  try {
    // Fetch local JSON data (bypassing browser cache)
    const response = await fetch('./meets.json?v=' + Date.now());
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    rawMeets = data.meets || [];
    
    // Pre-calculate search string for efficiency
    rawMeets.forEach(meet => {
      meet._searchStr = `${meet.name || ''} ${meet.location || ''} ${meet.region || ''} ${meet.meetType || ''}`.toLowerCase();
    });
    
    // Set Metadata
    updateLastUpdated(data.lastUpdated);
    
    // Parse Filter Options
    extractFilterOptions(rawMeets);
    
    // Set default selections: default regions & ALL meet types
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
  
  const cleanStr = dateString.split('-')[0].trim();
  const parts = cleanStr.split(/\s+/);
  if (parts.length === 1 && !isNaN(Date.parse(cleanStr))) {
    return new Date(cleanStr);
  }
  
  const parsed = Date.parse(cleanStr);
  if (!isNaN(parsed)) return new Date(parsed);
  
  const MONTH_NAMES = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];

  let year = new Date().getFullYear();
  const yearMatch = dateString.match(/\b(202\d)\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);
  
  let monthIndex = new Date().getMonth();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (dateString.toLowerCase().includes(MONTH_NAMES[i])) {
      monthIndex = i;
      break;
    }
  }
  
  let day = 1;
  const dayMatch = parts[0] ? parts[0].match(/\d+/) : null;
  if (dayMatch) day = parseInt(dayMatch[0], 10);
  
  return new Date(year, monthIndex, day);
}

// Extract unique regions and meet types sorted
function extractFilterOptions(meets) {
  const regionsSet = new Set();
  const meetTypesSet = new Set();
  
  meets.forEach(meet => {
    if (meet.region) regionsSet.add(meet.region);
    if (meet.meetType) meetTypesSet.add(meet.meetType);
  });
  
  regions = Array.from(regionsSet).sort((a, b) => a.localeCompare(b));
  meetTypes = Array.from(meetTypesSet).sort((a, b) => a.localeCompare(b));
}

function setDefaultFilters() {
  state.selectedRegions.clear();
  state.selectedMeetTypes.clear();

  // 1. Default Regions: select South West, National, GB, England, Scotland, Wales
  const defaultRegionsToSelect = ['south west', 'national', 'gb', 'england', 'scotland', 'wales'];
  regions.forEach(r => {
    if (defaultRegionsToSelect.includes(r.toLowerCase().trim())) {
      state.selectedRegions.add(r);
    }
  });

  // 2. Default Meet Types: select ALL meet types
  meetTypes.forEach(t => {
    state.selectedMeetTypes.add(t);
  });
}

// Populate Custom Dropdown Lists with Quick Actions
function populateDropdowns() {
  // 1. Regions Dropdown
  populateSingleDropdown(
    regionOptions,
    regionTrigger,
    regions,
    state.selectedRegions,
    'Region',
    'Regions'
  );

  // 2. Meet Types Dropdown
  populateSingleDropdown(
    meetTypeOptions,
    meetTypeTrigger,
    meetTypes,
    state.selectedMeetTypes,
    'Meet Type',
    'Meet Types'
  );
}

function populateSingleDropdown(container, trigger, items, selectedSet, singularLabel, pluralLabel) {
  if (!container) return;
  container.innerHTML = '';

  // Quick Action Bar: Select All / Clear All
  const actionsBar = document.createElement('div');
  actionsBar.className = 'options-actions-bar';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'opt-action-btn';
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    items.forEach(item => selectedSet.add(item));
    syncCheckboxesInContainer(container, selectedSet);
    updateTriggerText(trigger, selectedSet, items.length, singularLabel, pluralLabel);
    renderMeets();
  });

  const divider = document.createElement('span');
  divider.className = 'opt-action-divider';
  divider.textContent = '|';

  const clearAllBtn = document.createElement('button');
  clearAllBtn.type = 'button';
  clearAllBtn.className = 'opt-action-btn';
  clearAllBtn.textContent = 'Clear All';
  clearAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedSet.clear();
    syncCheckboxesInContainer(container, selectedSet);
    updateTriggerText(trigger, selectedSet, items.length, singularLabel, pluralLabel);
    renderMeets();
  });

  actionsBar.appendChild(selectAllBtn);
  actionsBar.appendChild(divider);
  actionsBar.appendChild(clearAllBtn);
  container.appendChild(actionsBar);

  // List Container for scrollable items
  const itemsList = document.createElement('div');
  itemsList.className = 'options-scroll-list';

  items.forEach(item => {
    const label = document.createElement('label');
    label.className = 'option-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = item;
    
    if (selectedSet.has(item)) {
      checkbox.checked = true;
      label.classList.add('checked');
    }
    
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedSet.add(item);
        label.classList.add('checked');
      } else {
        selectedSet.delete(item);
        label.classList.remove('checked');
      }
      updateTriggerText(trigger, selectedSet, items.length, singularLabel, pluralLabel);
      renderMeets();
    });
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(item));
    itemsList.appendChild(label);
  });

  container.appendChild(itemsList);

  // Update initial trigger text
  updateTriggerText(trigger, selectedSet, items.length, singularLabel, pluralLabel);
}

function syncCheckboxesInContainer(container, selectedSet) {
  if (!container) return;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = selectedSet.has(cb.value);
    const label = cb.closest('.option-item');
    if (label) {
      if (cb.checked) {
        label.classList.add('checked');
      } else {
        label.classList.remove('checked');
      }
    }
  });
}

// Update the label text displayed on custom select triggers
function updateTriggerText(triggerElement, selectedSet, totalCount, singularLabel, pluralLabel) {
  if (!triggerElement) return;
  const textSpan = triggerElement.querySelector('.trigger-text');
  if (!textSpan) return;

  if (selectedSet.size === 0 || (totalCount > 0 && selectedSet.size === totalCount)) {
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
    if (query && !meet._searchStr.includes(query)) {
      return false;
    }
    
    // 2. Region Filter: if active and not selecting all, check match
    if (state.selectedRegions.size > 0 && state.selectedRegions.size < regions.length) {
      if (!meet.region || !state.selectedRegions.has(meet.region)) return false;
    }

    // 3. Meet Type Filter: if active and not selecting all, check match
    if (state.selectedMeetTypes.size > 0 && state.selectedMeetTypes.size < meetTypes.length) {
      if (!meet.meetType || !state.selectedMeetTypes.has(meet.meetType)) return false;
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

// Parse dates into Google Calendar format (YYYYMMDD/YYYYMMDD with exclusive end date)
function parseDatesForGoogleCal(rawDateStr, formattedDate) {
  let startDate = null;
  let endDate = null;

  if (formattedDate) {
    const parts = formattedDate.split('-').map(s => s.trim());
    const parseDDMMYYYY = (str) => {
      const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) {
        return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
      return null;
    };

    if (parts.length === 2) {
      startDate = parseDDMMYYYY(parts[0]);
      endDate = parseDDMMYYYY(parts[1]);
    } else if (parts.length === 1) {
      startDate = parseDDMMYYYY(parts[0]);
      endDate = startDate;
    }
  }

  if (!startDate || isNaN(startDate.getTime())) {
    startDate = getStartDate(rawDateStr);
  }
  if (!endDate || isNaN(endDate.getTime())) {
    endDate = getStartDate(rawDateStr);
  }

  if (!startDate || isNaN(startDate.getTime())) {
    startDate = new Date();
  }
  if (!endDate || isNaN(endDate.getTime()) || endDate < startDate) {
    endDate = startDate;
  }

  // Exclusive end date for all-day Google Calendar template
  const exclusiveEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);

  const formatYYYYMMDD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };

  return {
    start: formatYYYYMMDD(startDate),
    end: formatYYYYMMDD(exclusiveEnd)
  };
}

// Generate Google Calendar Link ensuring Swim flare is triggered
function generateGoogleCalendarUrl(meet) {
  let title = meet.name || 'Swim Meet';
  if (!/swim/i.test(title)) {
    title = `Swim Meet: ${title}`;
  }

  const dateRange = parseDatesForGoogleCal(meet.date, meet.formattedDate);
  const locationStr = [meet.location, meet.region].filter(b => b && b !== 'Unknown' && b !== 'Unknown Venue' && b !== 'TBD').join(', ') || 'UK';

  const detailsText = [
    `🏊 ${meet.name}`,
    `📍 Venue: ${meet.location || 'TBD'} (${meet.region || 'UK'})`,
    `🏊 Format: ${getCourseLength(meet.course)} | ${meet.level || 'TBD'}`,
    `🏷️ Meet Type: ${meet.meetType || 'Open Meet'}`,
    meet.sourceUrl ? `🔗 Details: ${meet.sourceUrl}` : ''
  ].filter(Boolean).join('\n');

  const baseUrl = 'https://calendar.google.com/calendar/render';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${dateRange.start}/${dateRange.end}`,
    details: detailsText,
    location: locationStr
  });

  return `${baseUrl}?${params.toString()}`;
}

// Build table row HTML with attributes for desktop table & responsive mobile cards
function createTableRowHTML(meet) {
  const displayDate = meet.formattedDate || meet.date;
  const displayLocation = meet.location || 'TBD';
  const displayRegion = meet.region || 'Unknown';
  const displayCourse = getCourseLength(meet.course);
  const displayLevel = meet.level || 'TBD';
  const typeClass = getMeetTypeClass(meet.meetType);

  const googleCalUrl = generateGoogleCalendarUrl(meet);

  const calendarLinkHTML = `
    <a href="${escapeHTML(googleCalUrl)}" target="_blank" rel="noopener noreferrer" class="gcal-icon-btn" title="Add to Google Calendar" aria-label="Add ${escapeHTML(meet.name)} to Google Calendar">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <line x1="12" y1="14" x2="12" y2="18"></line>
        <line x1="10" y1="16" x2="14" y2="16"></line>
      </svg>
    </a>
  `;

  const holidayBadgeHTML = meet.isHoliday 
    ? '<span class="holiday-badge" title="Falls within school holiday period">🏖️ Holiday</span>' 
    : '';

  const meetNameHTML = meet.sourceUrl
    ? `<a href="${escapeHTML(meet.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="meet-name-link" title="Open official event source">${escapeHTML(meet.name)}</a>`
    : `<span class="meet-name-text">${escapeHTML(meet.name)}</span>`;

  return `
    <tr class="${meet.isHoliday ? 'row-holiday' : ''}">
      <td class="col-date" data-label="Date">
        <span class="date-badge">${escapeHTML(displayDate)}</span>
      </td>
      <td class="col-meet-name cell-meet-name" data-label="Meet">
        <div class="meet-name-wrapper">
          ${meetNameHTML}
          ${holidayBadgeHTML}
        </div>
      </td>
      <td class="col-location" data-label="Location">
        <div class="col-location-info">
          <span class="location-name">${escapeHTML(displayLocation)}</span>
          <span class="region-tag">${escapeHTML(displayRegion)}</span>
        </div>
      </td>
      <td class="col-format" data-label="Format">
        <div class="col-course-info">
          <span class="course-format">${escapeHTML(displayCourse)}</span>
          <span class="level-badge">${escapeHTML(displayLevel)}</span>
        </div>
      </td>
      <td class="col-type" data-label="Type">
        <span class="type-tag ${typeClass}">${escapeHTML(meet.meetType || 'Other')}</span>
      </td>
      <td class="text-center col-actions" data-label="Calendar">
        ${calendarLinkHTML}
      </td>
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

  // Prevent dropdown closing when clicking inside options
  if (regionOptions) regionOptions.addEventListener('click', (e) => e.stopPropagation());
  if (meetTypeOptions) meetTypeOptions.addEventListener('click', (e) => e.stopPropagation());

  // Close dropdowns on clicking outside
  document.addEventListener('click', () => {
    closeAllDropdowns();
  });

  // Close dropdowns on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
    }
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
  
  // Re-apply default selections
  setDefaultFilters();
  
  // Sync search inputs
  if (searchInput) searchInput.value = '';
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  
  // Sync checkboxes in dropdown lists
  syncCheckboxesInContainer(regionOptions, state.selectedRegions);
  syncCheckboxesInContainer(meetTypeOptions, state.selectedMeetTypes);

  // Reset triggers label text
  updateTriggerText(regionTrigger, state.selectedRegions, regions.length, 'Region', 'Regions');
  updateTriggerText(meetTypeTrigger, state.selectedMeetTypes, meetTypes.length, 'Meet Type', 'Meet Types');

  renderMeets();
}

// Update Last Updated indicator
function updateLastUpdated(dateStr) {
  if (lastUpdatedElement && dateStr) {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
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
