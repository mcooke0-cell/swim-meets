// State Management
let rawMeets = [];
let regions = [];
let meetTypes = [];

const state = {
  search: '',
  selectedRegions: new Set(),
  selectedMeetTypes: new Set(),
  holidaysOnly: false
};

// DOM Elements
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const filterToggleBtn = document.getElementById('filter-toggle-btn');
const holidayToggleBtn = document.getElementById('holiday-toggle-btn');
const filtersDrawer = document.getElementById('filters-drawer');
const activeFilterIndicator = document.getElementById('active-filter-indicator');
const resetAllBtn = document.getElementById('reset-all-btn');
const regionChipsContainer = document.getElementById('region-chips-container');
const meetTypeChipsContainer = document.getElementById('meet-type-chips-container');
const meetsCountElement = document.getElementById('meets-count');
const lastUpdatedElement = document.getElementById('last-updated');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const emptyState = document.getElementById('empty-state');
const meetsGrid = document.getElementById('meets-grid');
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
    
    // Render Filter Controls
    renderFilterChips();
    
    // Render Initial List
    renderMeets();
    
    // Transition UI from loading to active
    loadingState.style.display = 'none';
    meetsGrid.style.display = 'grid';
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

// Extract unique regions and types sorted alphabetically
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

// Render dynamic filter chips
function renderFilterChips() {
  // Regions
  regionChipsContainer.innerHTML = '';
  if (regions.length === 0) {
    regionChipsContainer.innerHTML = '<span class="loading-chips">No regions available</span>';
  } else {
    regions.forEach(region => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.textContent = region;
      chip.dataset.value = region;
      chip.addEventListener('click', () => toggleRegion(region, chip));
      regionChipsContainer.appendChild(chip);
    });
  }

  // Meet Types
  meetTypeChipsContainer.innerHTML = '';
  if (meetTypes.length === 0) {
    meetTypeChipsContainer.innerHTML = '<span class="loading-chips">No meet types available</span>';
  } else {
    meetTypes.forEach(type => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.textContent = type;
      chip.dataset.value = type;
      chip.addEventListener('click', () => toggleMeetType(type, chip));
      meetTypeChipsContainer.appendChild(chip);
    });
  }
}

// Handle chip selections
function toggleRegion(region, chipElement) {
  if (state.selectedRegions.has(region)) {
    state.selectedRegions.delete(region);
    chipElement.classList.remove('active');
  } else {
    state.selectedRegions.add(region);
    chipElement.classList.add('active');
  }
  renderMeets();
}

function toggleMeetType(type, chipElement) {
  if (state.selectedMeetTypes.has(type)) {
    state.selectedMeetTypes.delete(type);
    chipElement.classList.remove('active');
  } else {
    state.selectedMeetTypes.add(type);
    chipElement.classList.add('active');
  }
  renderMeets();
}

// Filter and Render Cards
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
    
    // 4. Holidays Filter
    if (state.holidaysOnly) {
      if (!meet.isHoliday) return false;
    }
    
    return true;
  });
  
  // Update Meta Indicators
  meetsCountElement.textContent = `${filteredMeets.length} Meet${filteredMeets.length === 1 ? '' : 's'}`;
  
  const totalFiltersCount = state.selectedRegions.size + state.selectedMeetTypes.size;
  if (totalFiltersCount > 0) {
    activeFilterIndicator.textContent = totalFiltersCount;
    activeFilterIndicator.style.display = 'flex';
    filterToggleBtn.classList.add('active');
  } else {
    activeFilterIndicator.style.display = 'none';
    filterToggleBtn.classList.remove('active');
  }
  
  // Display checks
  if (filteredMeets.length === 0) {
    meetsGrid.style.display = 'none';
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    meetsGrid.style.display = 'grid';
    
    // Build Cards
    meetsGrid.innerHTML = filteredMeets.map(meet => createMeetCardHTML(meet)).join('');
  }
}

// Card Template Builder
function createMeetCardHTML(meet) {
  const isHolidayClass = meet.isHoliday ? 'holiday-card' : '';
  
  const tagsHTML = [];
  if (meet.region) {
    tagsHTML.push(`<span class="card-tag tag-region">${meet.region}</span>`);
  }
  if (meet.meetType) {
    tagsHTML.push(`<span class="card-tag tag-type">${meet.meetType}</span>`);
  }
  if (meet.isHoliday) {
    tagsHTML.push(`<span class="card-tag tag-holiday">🏖️ Holiday</span>`);
  }
  
  const tagsRow = tagsHTML.length > 0 
    ? `<div class="card-tags">${tagsHTML.join('')}</div>` 
    : '';

  const linkHTML = meet.sourceUrl 
    ? `<a href="${meet.sourceUrl}" target="_blank" rel="noopener noreferrer" class="visit-link">
         <span>Info</span>
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
           <polyline points="15 3 21 3 21 9"></polyline>
           <line x1="10" y1="14" x2="21" y2="3"></line>
         </svg>
       </a>`
    : '';

  return `
    <article class="meet-card ${isHolidayClass}">
      <div class="card-header">
        ${tagsRow}
        <h2 class="meet-name">${escapeHTML(meet.name)}</h2>
      </div>
      
      <div class="card-details">
        <div class="detail-item detail-date">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>${escapeHTML(meet.formattedDate || meet.date)}</span>
        </div>
        
        <div class="detail-item detail-location">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          <span>${escapeHTML(meet.location || 'Unknown Location')}</span>
        </div>
        
        <div class="detail-item detail-course">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          <span>${escapeHTML(meet.course || 'Format TBD')}</span>
        </div>
      </div>
      
      <div class="card-footer">
        <span class="level-badge">${escapeHTML(meet.level || 'License TBD')}</span>
        ${linkHTML}
      </div>
    </article>
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

filterToggleBtn.addEventListener('click', () => {
  const isOpen = filtersDrawer.classList.toggle('open');
  filterToggleBtn.setAttribute('aria-expanded', isOpen);
});

holidayToggleBtn.addEventListener('click', () => {
  state.holidaysOnly = !state.holidaysOnly;
  holidayToggleBtn.classList.toggle('active', state.holidaysOnly);
  renderMeets();
});

function resetFilters() {
  state.selectedRegions.clear();
  state.selectedMeetTypes.clear();
  state.holidaysOnly = false;
  
  // Reset DOM states
  holidayToggleBtn.classList.remove('active');
  const activeChips = filtersDrawer.querySelectorAll('.filter-chip.active');
  activeChips.forEach(chip => chip.classList.remove('active'));
  
  renderMeets();
}

resetAllBtn.addEventListener('click', resetFilters);
emptyStateResetBtn.addEventListener('click', () => {
  resetFilters();
  searchInput.value = '';
  state.search = '';
  clearSearchBtn.style.display = 'none';
  renderMeets();
});

// Run Init
init();
