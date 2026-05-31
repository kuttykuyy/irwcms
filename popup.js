// ============= LICENSE SERVER CONFIGURATION =============
const LICENSE_SERVER_URL = 'https://irwcms.primerp.in';
const CURRENT_VERSION = '12.1';
// ==========================================================

// In-memory cache — avoids storage round-trip on every API call after first load
let _cachedDeviceId = null;

function getDeviceId() {
  if (_cachedDeviceId) return Promise.resolve(_cachedDeviceId);
  return new Promise((resolve) => {
    chrome.storage.local.get(['deviceId'], (result) => {
      if (result.deviceId) {
        _cachedDeviceId = result.deviceId;
        resolve(_cachedDeviceId);
      } else {
        _cachedDeviceId = 'DEV-' + (crypto.randomUUID
          ? crypto.randomUUID()
          : (Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9)));
        chrome.storage.local.set({ deviceId: _cachedDeviceId });
        resolve(_cachedDeviceId);
      }
    });
  });
}

// Speed settings mapping: slider value -> delay in ms (labels updated via translations)
const SPEED_SETTINGS = {
  1: { delay: 500, labelKey: 'verySlow' },
  2: { delay: 200, labelKey: 'slow' },
  3: { delay: 100, labelKey: 'medium' },
  4: { delay: 50, labelKey: 'fast' },
  5: { delay: 20, labelKey: 'veryFast' },
  6: { delay: 1, labelKey: 'instant' }  // 1ms - maximum speed
};
let currentFillDelay = 100; // Default medium speed

// Append Mode - for adding rows after existing data
let selectedAppendMode = false;  // false = Replace mode (default), true = Append mode
let existingRowsCount = 0;       // Count of existing rows in the form

// Check license on load
document.addEventListener('DOMContentLoaded', () => {
  initLanguageSelector();
  loadSavedLanguage();
  checkLicense();
  scanIRWCMSPage();
  initSpeedControl();
  initAppendModeHandlers();
  initTabs();
  checkForUpdates();
  initUpdateBanner();
});

// Clean up live intervals when the side panel is hidden or closed
document.addEventListener('visibilitychange', () => {
  if (document.hidden && unlimitedCountdownInterval) {
    clearInterval(unlimitedCountdownInterval);
    unlimitedCountdownInterval = null;
  }
});

// Initialize update banner close button
function initUpdateBanner() {
  const closeBtn = document.getElementById('updateClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const banner = document.getElementById('updateBanner');
      if (banner) banner.classList.remove('show');
      // Remember dismissed version for 24 hours
      chrome.storage.local.set({ 
        updateDismissed: true, 
        updateDismissedAt: Date.now() 
      });
    });
  }
}

// Compare version strings (e.g., "11.0" vs "11.1")
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

// Check for extension updates
async function checkForUpdates() {
  try {
    // Check if update was dismissed recently (within 24 hours)
    const stored = await chrome.storage.local.get(['updateDismissed', 'updateDismissedAt']);
    if (stored.updateDismissed && stored.updateDismissedAt) {
      const hoursAgo = (Date.now() - stored.updateDismissedAt) / (1000 * 60 * 60);
      if (hoursAgo < 24) return;
    }
    
    const response = await fetch(`${LICENSE_SERVER_URL}/api/version`);
    if (!response.ok) return;
    
    const data = await response.json();
    const latestVersion = data.latest_version;
    
    // Update version badge
    const versionBadge = document.getElementById('versionBadge');
    if (versionBadge) {
      versionBadge.textContent = `v${CURRENT_VERSION}`;
    }
    
    // Check if update is needed
    if (compareVersions(CURRENT_VERSION, latestVersion) < 0) {
      const banner = document.getElementById('updateBanner');
      const message = document.getElementById('updateMessage');
      const link = document.getElementById('updateLink');
      
      if (banner && message) {
        message.textContent = `Update available: v${latestVersion}`;
        if (link && data.download_url) {
          link.href = LICENSE_SERVER_URL + data.download_url;
        }
        banner.classList.add('show');
      }
    }
  } catch (err) {
    console.log('Version check failed:', err);
  }
}

// Initialize Tab Switching
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // Update content visibility
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// Initialize Append Mode UI handlers
function initAppendModeHandlers() {
  const appendModeBtn = document.getElementById('appendModeBtn');
  const replaceModeBtn = document.getElementById('replaceModeBtn');
  
  if (appendModeBtn) {
    appendModeBtn.addEventListener('click', () => {
      selectedAppendMode = true;
      updateAppendModeUI();
      console.log('IRWCMS Auto-Fill: Append mode selected');
    });
  }
  
  if (replaceModeBtn) {
    replaceModeBtn.addEventListener('click', () => {
      selectedAppendMode = false;
      updateAppendModeUI();
      console.log('IRWCMS Auto-Fill: Replace mode selected');
    });
  }
}

// Update Append Mode button UI based on selection
function updateAppendModeUI() {
  const appendModeBtn = document.getElementById('appendModeBtn');
  const replaceModeBtn = document.getElementById('replaceModeBtn');
  if (!appendModeBtn || !replaceModeBtn) return;
  const fillModeHint = document.getElementById('fillModeHint');
  
  if (selectedAppendMode) {
    // Append mode selected
    appendModeBtn.style.background = '#22c55e';
    appendModeBtn.style.boxShadow = '0 0 10px rgba(34,197,94,0.5)';
    replaceModeBtn.style.background = '#9ca3af';
    replaceModeBtn.style.boxShadow = 'none';
    if (fillModeHint) {
      fillModeHint.innerHTML = `<strong style="color:#22c55e;">➕ APPEND:</strong> Your ${parsedData?.length || 0} rows will be added after row ${existingRowsCount}`;
    }
  } else {
    // Replace mode selected
    replaceModeBtn.style.background = '#f59e0b';
    replaceModeBtn.style.boxShadow = '0 0 10px rgba(245,158,11,0.5)';
    appendModeBtn.style.background = '#9ca3af';
    appendModeBtn.style.boxShadow = 'none';
    if (fillModeHint) {
      fillModeHint.innerHTML = `<strong style="color:#f59e0b;">🔄 REPLACE:</strong> Will fill starting from row 1 (existing data unchanged)`;
    }
  }
}

// Check for existing rows in the measurement form
async function checkExistingRows() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('ircep.gov.in') && !tab?.url?.includes('irwcms.primerp.in')) {
      return 0;
    }
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        // Count existing rows in the measurement table
        const tbody = document.querySelector('#datatabody, #datatable tbody, table.datatable tbody, .measurement-table tbody');
        if (tbody) {
          const rows = tbody.querySelectorAll('tr');
          let validRows = 0;
          rows.forEach(row => {
            const inputs = row.querySelectorAll('input[type="text"], input:not([type])');
            const hasData = Array.from(inputs).some(inp => inp.value && inp.value.trim() !== '');
            if (hasData) {
              validRows++;
            }
          });
          return validRows;
        }
        
        // Fallback: check any table with measurement-like structure
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const tbody = table.querySelector('tbody');
          if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            if (rows.length > 0) {
              const firstRow = rows[0];
              if (firstRow.querySelector('input[name="disc"], input[placeholder*="Particulars" i]')) {
                return rows.length;
              }
            }
          }
        }
        return 0;
      }
    });
    
    // Get max from all frames
    const count = Math.max(...results.map(r => r?.result || 0), 0);
    existingRowsCount = count;
    
    // Show/hide append mode section based on existing rows AND account type
    // Append mode is only available for Account (personal accounts)
    const appendModeSection = document.getElementById('appendModeSection');
    const existingRowCountEl = document.getElementById('existingRowCount');
    const appendAfterRowEl = document.getElementById('appendAfterRow');
    
    // Check if this is a personal (Account) account
    const storageData = await new Promise(resolve => {
      chrome.storage.local.get(['is_personal'], resolve);
    });
    const isPersonalAccount = storageData.is_personal !== false; // default true if not set
    
    if (appendModeSection && count > 0 && isPersonalAccount) {
      // Only show append mode for Account accounts
      appendModeSection.style.display = 'block';
      if (existingRowCountEl) existingRowCountEl.textContent = count;
      if (appendAfterRowEl) appendAfterRowEl.textContent = count;
      // Default to append mode when existing rows detected
      selectedAppendMode = true;
      updateAppendModeUI();
      console.log('IRWCMS Auto-Fill: Detected', count, 'existing rows - Append mode enabled (Account)');
    } else if (appendModeSection) {
      appendModeSection.style.display = 'none';
      selectedAppendMode = false;
      if (count > 0 && !isPersonalAccount) {
        console.log('IRWCMS Auto-Fill: Append mode not available for Account accounts');
      }
    }
    
    return count;
  } catch (e) {
    console.log('IRWCMS Auto-Fill: Could not check existing rows:', e);
    return 0;
  }
}

// Initialize language selector
function initLanguageSelector() {
  const langBtn = document.getElementById('currentLangBtn');
  const langDropdown = document.getElementById('langDropdown');
  const langOptions = document.querySelectorAll('.lang-option');
  
  // Toggle dropdown
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langDropdown.classList.toggle('show');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    langDropdown.classList.remove('show');
  });
  
  // Language selection
  langOptions.forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = option.getAttribute('data-lang');
      setLanguage(lang);
      langDropdown.classList.remove('show');
      
      // Update active state
      langOptions.forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
    });
  });
  
  // Set initial active state
  chrome.storage.local.get(['language'], (result) => {
    const savedLang = result.language || 'en';
    langOptions.forEach(opt => {
      if (opt.getAttribute('data-lang') === savedLang) {
        opt.classList.add('active');
      }
    });
  });
}

// Account fixed speed (500ms)
const DEPARTMENT_FIXED_DELAY = 500;

// Initialize speed control slider
function initSpeedControl() {
  const slider = document.getElementById('speedSlider');
  const valueLabel = document.getElementById('speedValue');
  const speedControlDiv = document.querySelector('.speed-control');
  
  // Check account type and show/hide speed controls
  chrome.storage.local.get(['fillSpeed', 'is_personal'], (result) => {
    const isPersonal = result.is_personal;
    
    if (isPersonal === false) {
      // Account: Hide speed controls, use fixed 500ms
      if (speedControlDiv) {
        speedControlDiv.innerHTML = `
          <div class="speed-label">
            <span data-i18n="fillSpeed">Fill Speed:</span>
            <span class="speed-value" style="color: #94a3b8;">Fixed (Standard)</span>
          </div>
          <div style="padding: 8px 0; color: #64748b; font-size: 12px;">
            ⚡ Account uses optimized standard speed for reliability
          </div>
        `;
      }
      currentFillDelay = DEPARTMENT_FIXED_DELAY;
    } else {
      // Account: Show speed controls
      let savedSpeed = result.fillSpeed || 3;
      // Ensure speed is within valid range (1-6)
      if (savedSpeed < 1 || savedSpeed > 6 || !SPEED_SETTINGS[savedSpeed]) {
        savedSpeed = 3; // Default to medium
      }
      slider.value = savedSpeed;
      updateSpeedLabel(savedSpeed);
      currentFillDelay = SPEED_SETTINGS[savedSpeed].delay;
      
      slider.addEventListener('input', (e) => {
        let speed = parseInt(e.target.value);
        // Ensure speed is within valid range (1-6)
        if (speed < 1 || speed > 6 || !SPEED_SETTINGS[speed]) {
          speed = 3;
        }
        updateSpeedLabel(speed);
        currentFillDelay = SPEED_SETTINGS[speed].delay;
        chrome.storage.local.set({ fillSpeed: speed });
      });
    }
  });
  
  function updateSpeedLabel(speed) {
    // Ensure speed is valid
    if (!SPEED_SETTINGS[speed]) {
      speed = 3;
    }
    // Use translation if available, fallback to English
    const labelKey = SPEED_SETTINGS[speed].labelKey;
    valueLabel.textContent = typeof t === 'function' ? t(labelKey) : labelKey;
  }
}

// Update speed control visibility based on account type
function updateSpeedControlForAccountType(isPersonal) {
  const speedControlDiv = document.querySelector('.speed-control');
  
  if (isPersonal === false) {
    // Account: Fixed speed
    if (speedControlDiv) {
      speedControlDiv.innerHTML = `
        <div class="speed-label">
          <span data-i18n="fillSpeed">Fill Speed:</span>
          <span class="speed-value" style="color: #94a3b8;">Fixed (Standard)</span>
        </div>
        <div style="padding: 8px 0; color: #64748b; font-size: 12px;">
          ⚡ Account uses optimized standard speed for reliability
        </div>
      `;
    }
    currentFillDelay = DEPARTMENT_FIXED_DELAY;
  } else {
    // Account: Show adjustable slider
    if (speedControlDiv) {
      speedControlDiv.innerHTML = `
        <div class="speed-label">
          <span data-i18n="fillSpeed">Fill Speed:</span>
          <span id="speedValue" class="speed-value">Normal</span>
        </div>
        <input type="range" id="speedSlider" min="1" max="6" value="3" class="speed-slider">
        <div class="speed-hints">
          <span>🐢</span>
          <span>⚡</span>
        </div>
      `;
      
      // Local function to update speed display
      function updateSpeedDisplay(speed) {
        const speedValueEl = document.getElementById('speedValue');
        if (speedValueEl && SPEED_SETTINGS[speed]) {
          const labelKey = SPEED_SETTINGS[speed].labelKey;
          speedValueEl.textContent = typeof t === 'function' ? t(labelKey) : labelKey;
          currentFillDelay = SPEED_SETTINGS[speed].delay;
        }
      }
      
      // Re-attach slider event listener
      const slider = document.getElementById('speedSlider');
      if (slider) {
        chrome.storage.local.get(['fillSpeed'], (result) => {
          let savedSpeed = result.fillSpeed !== undefined ? result.fillSpeed : 3;
          // Ensure speed is within valid range (1-6)
          if (savedSpeed < 1 || savedSpeed > 6 || !SPEED_SETTINGS[savedSpeed]) {
            savedSpeed = 3;
          }
          slider.value = savedSpeed;
          updateSpeedDisplay(savedSpeed);
        });
        slider.addEventListener('input', (e) => {
          let speed = parseInt(e.target.value, 10);
          // Ensure speed is within valid range (1-6)
          if (speed < 1 || speed > 6 || !SPEED_SETTINGS[speed]) {
            speed = 3;
          }
          updateSpeedDisplay(speed);
          chrome.storage.local.set({ fillSpeed: speed });
        });
      }
    }
  }
}

// Global flag for stop fill
let fillStopped = false;

// Scan IRWCMS page for logged-in user info
async function scanIRWCMSPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('ircep.gov.in')) return;
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const info = {};
        // Look for common user info patterns
        const bodyText = document.body.innerText;
        const allText = bodyText || '';
        
        // Find logged in user name/email (SSO format)
        const userSpans = document.querySelectorAll('span, div, td, label');
        userSpans.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 3 && text.length < 100) {
            if (text.toLowerCase().includes('welcome') || 
                text.toLowerCase().includes('logged in') ||
                text.toLowerCase().includes('user:') ||
                text.toLowerCase().includes('name:')) {
              info.userText = text;
            }
          }
        });
        
        // Extract Railway Official name from header - multiple formats supported:
        // Format 1: "Welcome K VENKATESH (SSE/Works/B-1/GOC)"
        // Format 2: "Welcome A Magesh (SSE/PW/SVKS) | | | SSO"
        // Format 3: Just "Welcome NAME (DESIGNATION)"
        
        // Try multiple patterns to capture railway official name
        let railwayOfficialMatch = allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]+?)\s*\(([^)]+)\)/i);
        if (!railwayOfficialMatch) {
          // Try without parentheses - just "Welcome NAME"
          railwayOfficialMatch = allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]{2,30})(?:\s*\||$|\s{2,})/i);
        }
        
        if (railwayOfficialMatch) {
          info.railwayOfficialName = railwayOfficialMatch[1].trim().replace(/\s+/g, ' ');
          info.railwayOfficialDesignation = railwayOfficialMatch[2]?.trim() || '';
          info.userText = info.railwayOfficialDesignation 
            ? `${info.railwayOfficialName} (${info.railwayOfficialDesignation})` 
            : info.railwayOfficialName;
          console.log('Railway Official detected:', info.railwayOfficialName, info.railwayOfficialDesignation);
        }
        
        // Extract IRWCMS email from SSO format "Welcome A Magesh (SSE/PW/SVKS) | | | SSO"
        const ssoMatch = allText.match(/Welcome\s+([^(|]+)\s*(?:\([^)]+\))?\s*\|\s*\|\s*\|\s*SSO/i);
        if (ssoMatch) {
          info.userText = ssoMatch[0].trim();
          // Extract name from SSO format as well
          const nameMatch = ssoMatch[1].trim();
          if (nameMatch && !info.railwayOfficialName) {
            info.railwayOfficialName = nameMatch;
            console.log('Railway Official from SSO:', info.railwayOfficialName);
          }
          // Try to extract email from header text
          const emailMatch = allText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (emailMatch) info.irwcmsEmail = emailMatch[1];
        }
        
        // Fallback: Look for welcome text in likely containers only (avoid full DOM walk)
        if (!info.railwayOfficialName) {
          const candidates = document.querySelectorAll('header, nav, .navbar, .header, #header, td, span, div.user-info, div.welcome');
          for (const el of candidates) {
            const text = el.innerText?.trim() || '';
            if (text.toLowerCase().startsWith('welcome') && text.length < 100 && text.length > 8) {
              const welcomeMatch = text.match(/Welcome\s+([A-Za-z][A-Za-z\s.]+?)(?:\s*\(([^)]+)\)|$)/i);
              if (welcomeMatch && welcomeMatch[1]) {
                info.railwayOfficialName = welcomeMatch[1].trim().replace(/\s+/g, ' ');
                info.railwayOfficialDesignation = welcomeMatch[2]?.trim() || '';
                console.log('Railway Official from fallback:', info.railwayOfficialName);
                break;
              }
            }
          }
        }
        
        // Extract Contractor Name
        const contractorMatch = allText.match(/Name of Contractor[:\s]*([A-Z0-9\s\-&.,()]+?)(?:\s{2,}|Agreement Number|Situation|Date of|Name of Work)/i);
        if (contractorMatch) {
          info.contractorName = contractorMatch[1].trim();
        }
        if (!info.contractorName) {
          const cells = document.querySelectorAll('td');
          for (let i = 0; i < cells.length; i++) {
            const prevText = cells[i].innerText?.toLowerCase() || '';
            if (prevText.includes('name of contractor') && cells[i+1]) {
              info.contractorName = cells[i+1].innerText?.trim();
              break;
            }
          }
        }
        
        // Extract Agreement Number (e.g., SR/TPJ/Civil/2023/0071)
        const agreementMatch = allText.match(/Agreement\s*(?:Number|No\.?)\s*[:\s]*([A-Za-z0-9\/\-]+)/i);
        if (agreementMatch) {
          info.agreementNo = agreementMatch[1].trim();
        }
        // Also check table cells near "Agreement Number" label
        if (!info.agreementNo) {
          const cells = document.querySelectorAll('td');
          for (let i = 0; i < cells.length; i++) {
            const cellText = cells[i].innerText?.trim().toLowerCase() || '';
            if (cellText.includes('agreement number') || cellText === 'agreement number:') {
              // Check next cell or next sibling
              const nextCell = cells[i].nextElementSibling || cells[i+1];
              if (nextCell && nextCell.innerText?.trim()) {
                info.agreementNo = nextCell.innerText.trim();
                break;
              }
            }
          }
        }
        // Fallback: Look for pattern like XX/XXX/Word/YYYY/NNNN in nearby text
        if (!info.agreementNo) {
          const patternMatch = allText.match(/([A-Z]{2,}\/[A-Z]{2,}\/[A-Za-z]+\/\d{4}\/\d+)/);
          if (patternMatch) {
            info.agreementNo = patternMatch[1].trim();
          }
        }
        
        // Extract Measurement Number - check input fields first
        const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const input of allInputs) {
          const val = input.value?.trim();
          // Look for measurement number pattern: digits followed by slashes with alphanumerics
          if (val && val.match(/^\d{10,}\/[A-Z]+\/[A-Z]+\/[A-Z]+/i)) {
            info.measurementNo = val;
            break;
          }
        }
        
        // Also check table cells near "Measurement No" label
        if (!info.measurementNo) {
          const labels = document.querySelectorAll('td, th, span, label');
          for (const label of labels) {
            const text = label.innerText?.toLowerCase() || '';
            if (text.includes('measurement no') || text.includes('measurement number')) {
              // Check for input field within or next to this element
              const input = label.querySelector('input') || label.parentElement?.querySelector('input');
              if (input && input.value?.trim()) {
                info.measurementNo = input.value.trim();
                break;
              }
              // Check next sibling for input
              let nextEl = label.nextElementSibling;
              while (nextEl) {
                const sibInput = nextEl.querySelector ? nextEl.querySelector('input') : null;
                if (sibInput && sibInput.value?.trim()) {
                  info.measurementNo = sibInput.value.trim();
                  break;
                }
                if (nextEl.tagName === 'INPUT' && nextEl.value?.trim()) {
                  info.measurementNo = nextEl.value.trim();
                  break;
                }
                if (nextEl.tagName === 'TD' && nextEl.querySelector('input')) {
                  info.measurementNo = nextEl.querySelector('input').value?.trim();
                  break;
                }
                nextEl = nextEl.nextElementSibling;
              }
              if (info.measurementNo) break;
              
              // Fallback: check link or text
              const link = label.querySelector('a');
              if (link && link.textContent.trim().length > 5) {
                info.measurementNo = link.textContent.trim();
                break;
              }
            }
          }
        }
        
        // Final regex fallback
        if (!info.measurementNo) {
          const measurementMatch = allText.match(/Measurement No[.:\s]*(\d{10,}[A-Z0-9\/\-]+)/i);
          if (measurementMatch) info.measurementNo = measurementMatch[1].trim();
        }
        
        // Check header area
        const header = document.querySelector('header, .header, #header, nav, .navbar');
        if (header) info.headerText = header.innerText?.substring(0, 500);
        
        // Check for any certificate/DSC related text
        if (allText.includes('Certificate') || allText.includes('DSC')) {
          const match = allText.match(/Certificate[:\s]*([\w\d-]+)/i);
          if (match) info.certificate = match[1];
        }
        
        // Get page title
        info.pageTitle = document.title;
        
        return info;
      }
    });
    
    // Merge results across all frames — prefer the frame with the most data
    const mergedInfo = (results || [])
      .map(r => r?.result)
      .filter(Boolean)
      .reduce((best, curr) => {
        const score = v => Object.values(v).filter(Boolean).length;
        return score(curr) > score(best) ? curr : best;
      }, {});

    if (Object.keys(mergedInfo).length > 0) {
      const info = mergedInfo;
      console.log('IRWCMS Page Info (merged):', info);
      
      // Store railway official name if detected (for use in fill API)
      if (info.railwayOfficialName) {
        chrome.storage.local.set({ 
          railway_official_name: info.railwayOfficialName,
          railway_official_designation: info.railwayOfficialDesignation || ''
        });
      }
      
      // Get stored contractor name for matching
      chrome.storage.local.get(['contractor_name', 'is_railway'], (stored) => {
        const storedContractor = stored.contractor_name?.toUpperCase().trim();
        const pageContractor = info.contractorName?.toUpperCase().trim();
        const isContractorMatched = storedContractor && pageContractor && 
          (storedContractor === pageContractor || 
           pageContractor.includes(storedContractor) || 
           storedContractor.includes(pageContractor));
        const isRailway = stored.is_railway;
        
        const debugDiv = document.createElement('div');
        debugDiv.id = 'irwcmsDebug';
        debugDiv.style.cssText = 'background:#1e293b;color:#e2e8f0;padding:10px 12px;margin:8px 16px;border-radius:8px;font-size:12px;';
        
        let html = '<div style="font-weight:600;color:#a78bfa;margin-bottom:6px;">📋 Detected from IRWCMS</div>';
        
        // Railway Official Name (for railway accounts)
        if (info.railwayOfficialName) {
          const designation = info.railwayOfficialDesignation ? ` (${info.railwayOfficialDesignation})` : '';
          html += `<div style="margin-bottom:4px;">
            <span style="color:#94a3b8;font-size:11px;">🚂 Railway Official:</span>
            <div style="color:#06b6d4;font-weight:600;margin-top:2px;">${info.railwayOfficialName}${designation}</div>
          </div>`;
        }
        
        // Contractor name with matched badge (for non-railway accounts)
        if (info.contractorName) {
          const matchBadge = isContractorMatched
            ? '<span style="background:#22c55e;color:white;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:6px;">✓ Matched</span>'
            : '';
          // Use a placeholder then set textContent to avoid XSS from page-extracted name
          const safeId = 'contractorNameText_' + Date.now();
          html += `<div style="margin-bottom:4px;">
            <span style="color:#94a3b8;font-size:11px;">Name of Contractor (as per LOA):</span>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
              <span id="${safeId}" style="color:#22c55e;font-weight:600;"></span>${matchBadge}
            </div>
          </div>`;
          // Schedule safe text assignment after HTML is inserted into DOM
          setTimeout(() => {
            const el = document.getElementById(safeId);
            if (el) el.textContent = info.contractorName;
          }, 0);
        }
        
        // Agreement number - with overflow handling
        if (info.agreementNo) {
          html += `<div style="margin-bottom:4px;">
            <span style="color:#94a3b8;">Agreement No:</span>
            <div style="color:#38bdf8;font-weight:500;font-size:11px;word-break:break-all;margin-top:2px;">${info.agreementNo}</div>
          </div>`;
        }
        
        // Email with match status
        if (info.irwcmsEmail) {
          html += `<div style="margin-bottom:4px;">
            <span style="color:#94a3b8;">Email:</span>
            <span style="color:#fbbf24;word-break:break-all;"> ${info.irwcmsEmail}</span>
          </div>`;
        }
        
        // Show user info if available (fallback when no specific info found)
        if (info.userText && !info.contractorName && !info.irwcmsEmail && !info.railwayOfficialName) {
          html += `<div style="color:#94a3b8;font-size:11px;">${info.userText}</div>`;
        }
        
        if (info.contractorName || info.agreementNo || info.irwcmsEmail || info.userText || info.railwayOfficialName) {
          debugDiv.innerHTML = html;
          document.querySelector('.container')?.appendChild(debugDiv);
        }
      });
    }
  } catch (err) {
    console.log('Could not scan IRWCMS page:', err);
  }
}

async function verifyWithServer(licenseKey, includeSessionToken = false) {
  try {
    const deviceId = await getDeviceId();
    const body = {
      license_key: licenseKey,
      device_id: deviceId
    };
    
    // Include session token if checking existing session
    if (includeSessionToken) {
      const stored = await chrome.storage.local.get(['sessionToken']);
      if (stored.sessionToken) {
        body.session_token = stored.sessionToken;
      }
    }
    
    const response = await fetch(`${LICENSE_SERVER_URL}/api/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    
    // Store new session token if provided
    if (data.success && data.session_token) {
      await chrome.storage.local.set({ sessionToken: data.session_token });
    }
    
    // Handle session expired
    if (data.session_expired) {
      await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
      showStatus('⚠️ License active on another device. Please login again.', 'error');
    }
    
    return data;
  } catch (err) {
    console.error('License server error:', err);
    return { success: false, message: 'Network error - check your connection' };
  }
}

async function loginWithEmail(email) {
  try {
    const deviceId = await getDeviceId();
    const stored = await chrome.storage.local.get(['sessionToken']);
    
    const body = {
      email: email,
      device_id: deviceId
    };
    
    if (stored.sessionToken) {
      body.session_token = stored.sessionToken;
    }
    
    const response = await fetch(`${LICENSE_SERVER_URL}/api/verify-email/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });
    
    // Check for non-JSON responses (server errors)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Server returned non-JSON response:', response.status);
      return { success: false, message: 'Server error - please try again later' };
    }
    
    const data = await response.json();
    
    // Store new session token if provided
    if (data.success && data.session_token) {
      await chrome.storage.local.set({ sessionToken: data.session_token });
    }
    
    // Handle session expired
    if (data.session_expired) {
      await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
      showStatus('⚠️ License active on another device. Please login again.', 'error');
    }
    
    return data;
  } catch (err) {
    console.error('Email login error:', err);
    return { success: false, message: 'Network error - check your connection' };
  }
}

async function loginWithDSC(dscToken) {
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${LICENSE_SERVER_URL}/api/dsc-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dsc_token: dscToken,
        device_id: deviceId
      })
    });
    
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('DSC login error:', err);
    return { success: false, message: 'Network error - check your connection' };
  }
}

function checkLicense() {
  chrome.storage.local.get(['licenseKey', 'licenseVerified', 'licenseUses', 'usageData', 'creditBalance'], (result) => {
    if (result.licenseVerified && result.licenseKey) {
      // Already verified locally - allow offline usage
      showLicenseActive(result.licenseKey, result.licenseUses);
      // Show stored usage data (new pricing) or credit balance (legacy)
      if (result.usageData) {
        updateCreditsDisplay(result.usageData);
      } else if (result.creditBalance !== undefined) {
        updateCreditsDisplay(result.creditBalance);
      }
    } else {
      showLicenseInactive();
    }
  });
}

function showLicenseActive(key, uses) {
  document.getElementById('licenseStatus').textContent = '✓ Activated';
  document.getElementById('licenseStatus').className = 'license-status license-active';
  document.getElementById('licenseInputArea').style.display = 'none';
  document.getElementById('licenseActiveArea').style.display = 'block';
  document.getElementById('mainContent').classList.add('visible');
  
  // Show user info
  chrome.storage.local.get(['loginEmail', 'licenseKey', 'is_personal', 'contractor_name', 'is_superuser', 'usageData'], (result) => {
    // Fallback: read is_superuser from usageData if not set at top level (for users upgrading from older versions)
    if (result.is_superuser === undefined && result.usageData && result.usageData.is_superuser) {
      result.is_superuser = result.usageData.is_superuser;
      // Persist to top level for future
      chrome.storage.local.set({ is_superuser: true });
    }
    const userEmailEl = document.getElementById('userEmail');
    const licenseTypeEl = document.getElementById('licenseType');
    
    if (result.loginEmail) {
      userEmailEl.textContent = '● ' + result.loginEmail;
    } else {
      userEmailEl.textContent = '🔑 ' + (result.licenseKey || key).substring(0, 12) + '...';
    }
    
    // Show license type (trial or paid)
    const isTrial = (result.licenseKey || key).startsWith('TRIAL-');
    const isPersonal = result.is_personal;
    const isSuperuser = result.is_superuser || false;
    
    // Update license type badge with new compact classes
    licenseTypeEl.className = 'user-type';
    if (isTrial && !isSuperuser) {
      licenseTypeEl.classList.add('type-trial');
      licenseTypeEl.textContent = '🎁 TRIAL';
    } else if (isSuperuser) {
      licenseTypeEl.classList.add('type-superuser');
      licenseTypeEl.textContent = '👑 SUPERUSER';
    } else {
      licenseTypeEl.classList.add('type-paid');
      licenseTypeEl.textContent = isPersonal ? '👤 Contractor' : '🏢 Dept';
    }
    
    // Show contractor name if available
    const contractorNameEl = document.getElementById('contractorNameDisplay');
    if (contractorNameEl && result.contractor_name) {
      contractorNameEl.innerHTML = `<span style="color:#6b7280;">📋</span> ${result.contractor_name}`;
      contractorNameEl.style.display = 'block';
    } else if (contractorNameEl) {
      contractorNameEl.style.display = 'none';
    }
    
    // ===== TRIAL: Disable Excel upload, allow only Measurement Builder =====
    // Superusers are NOT restricted, even if they have a TRIAL- key
    updateExcelAccessForTrial(isTrial && !isSuperuser);
  });
  
  // Hide uses count - single device license
  const usesInfo = document.getElementById('usesInfo');
  if (usesInfo) {
    usesInfo.style.display = 'none';
  }
}

function showLicenseInactive() {
  document.getElementById('licenseStatus').textContent = '⚠ Not Activated';
  document.getElementById('licenseStatus').className = 'license-status license-inactive';
  document.getElementById('licenseInputArea').style.display = 'block';
  document.getElementById('licenseActiveArea').style.display = 'none';
  document.getElementById('mainContent').classList.remove('visible');
  
  const usesInfo = document.getElementById('usesInfo');
  if (usesInfo) usesInfo.style.display = 'none';
}

// ===== TRIAL: Disable/enable Excel upload based on trial status =====
function updateExcelAccessForTrial(isTrial) {
  const uploadTab = document.querySelector('[data-tab="upload"]');
  const cloudTab = document.querySelector('[data-tab="cloud"]');
  const tabUploadContent = document.getElementById('tab-upload');
  const fileInputEl = document.getElementById('fileInput');
  const fillBtnEl = document.getElementById('fillBtn');
  
  // Remove any existing trial overlay
  const existingOverlay = document.getElementById('trialExcelOverlay');
  if (existingOverlay) existingOverlay.remove();
  
  if (isTrial) {
    // Disable file input for Excel uploads only - trial users can't upload Excel files
    if (fileInputEl) fileInputEl.disabled = true;
    // NOTE: Do NOT disable fillBtn - trial users can fill using Measurement Builder
    // The backend will reject Excel fills from trial users
    
    // Dim the upload tab to indicate it's not available for trial users
    if (uploadTab) uploadTab.style.opacity = '0.5';
    // NOTE: Keep Cloud tab enabled - trial users CAN load measurements from Measurement Builder
    if (cloudTab) cloudTab.style.opacity = '1';
    
    // Add overlay message on the upload content area
    if (tabUploadContent) {
      const overlay = document.createElement('div');
      overlay.id = 'trialExcelOverlay';
      overlay.style.cssText = 'background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:10px;text-align:center;';
      overlay.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:4px;">🔒 Excel Upload — Paid Feature</div>
        <div style="font-size:11px;color:#a16207;line-height:1.4;">
          Trial users can fill using the <strong>Measurement Builder</strong> only.<br>
          <a href="https://irwcms.primerp.in/measurement-builder" target="_blank" style="color:#2563eb;text-decoration:underline;">Open Measurement Builder →</a>
        </div>
        <a href="https://irwcms.primerp.in/buy" target="_blank" style="display:inline-block;margin-top:6px;background:#2563eb;color:white;padding:4px 12px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600;">⚡ Upgrade to Paid</a>
      `;
      tabUploadContent.insertBefore(overlay, tabUploadContent.firstChild);
    }
  } else {
    // Re-enable for paid users
    if (fileInputEl) fileInputEl.disabled = false;
    if (uploadTab) uploadTab.style.opacity = '1';
    if (cloudTab) cloudTab.style.opacity = '1';
  }
}

// Login with Email button
document.getElementById('activateBtn').addEventListener('click', async () => {
  const email = document.getElementById('emailInput').value.trim();
  const btn = document.getElementById('activateBtn');
  
  if (!email) {
    alert('Please enter your email');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  
  const result = await loginWithEmail(email);
  
  if (result.success) {
    chrome.storage.local.set({ 
      licenseKey: result.license_key,
      licenseVerified: true,
      licenseUses: result.activations_used,
      is_personal: result.is_personal,
      is_railway: result.is_railway || false,
      is_superuser: result.is_superuser || false,
      contractor_name: result.contractor_name || null,
      usageData: {
        is_unlimited: result.is_unlimited,
        is_personal: result.is_personal,
        is_railway: result.is_railway || false,
        is_superuser: result.is_superuser || false,
        cycle_spend: result.cycle_spend,
        fills_this_cycle: result.fills_this_cycle,
        today_fills: result.today_fills || 0,
        annual_cap: result.annual_cap,
        cycle_end: result.cycle_end,
        credit_balance: result.credit_balance,
        unlimited_expiry: result.unlimited_expiry || null,
        unlimited_fills_used: result.unlimited_fills_used || 0,
        unlimited_fills_max: result.unlimited_fills_max || 3000,
        unlimited_fills_remaining: result.unlimited_fills_remaining || 0,
        agreement_no: result.agreement_no || null,
        used_contractors: result.used_contractors || [],
        max_contractors: result.max_contractors || 5,
        is_trial: result.is_trial || false,
        trial_active: result.trial_active || false,
        trial_days_remaining: result.trial_days_remaining || 0
      },
      loginEmail: email
    }, () => {
      showLicenseActive(result.license_key, result.activations_used);
      updateCreditsDisplay(result);
      updateSpeedControlForAccountType(result.is_personal);
      btn.disabled = false;
      btn.textContent = 'Login with Email';
    });
  } else {
    alert(result.message || 'No license found for this email');
    btn.disabled = false;
    btn.textContent = 'Login with Email';
  }
});

// Activate with License Key button
document.getElementById('activateKeyBtn').addEventListener('click', async () => {
  const key = document.getElementById('licenseKeyInput').value.trim();
  const btn = document.getElementById('activateKeyBtn');
  
  if (!key) {
    alert('Please enter a license key');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  
  const result = await verifyWithServer(key);
  
  if (result.success) {
    chrome.storage.local.set({ 
      licenseKey: key,
      licenseVerified: true,
      licenseUses: result.activations_used,
      is_personal: result.is_personal,
      is_railway: result.is_railway || false,
      is_superuser: result.is_superuser || false,
      contractor_name: result.contractor_name || null,
      usageData: {
        is_unlimited: result.is_unlimited,
        is_personal: result.is_personal,
        is_railway: result.is_railway || false,
        is_superuser: result.is_superuser || false,
        cycle_spend: result.cycle_spend,
        fills_this_cycle: result.fills_this_cycle,
        today_fills: result.today_fills || 0,
        annual_cap: result.annual_cap,
        cycle_end: result.cycle_end,
        credit_balance: result.credit_balance,
        unlimited_expiry: result.unlimited_expiry || null,
        unlimited_fills_used: result.unlimited_fills_used || 0,
        unlimited_fills_max: result.unlimited_fills_max || 3000,
        unlimited_fills_remaining: result.unlimited_fills_remaining || 0,
        agreement_no: result.agreement_no || null,
        used_contractors: result.used_contractors || [],
        max_contractors: result.max_contractors || 5,
        is_trial: result.is_trial || false,
        trial_active: result.trial_active || false,
        trial_days_remaining: result.trial_days_remaining || 0
      },
    }, () => {
      showLicenseActive(key, result.activations_used);
      updateCreditsDisplay(result);
      updateSpeedControlForAccountType(result.is_personal);
      btn.disabled = false;
      btn.textContent = 'Activate with Key';
    });
  } else {
    alert(result.message || 'Invalid license key');
    btn.disabled = false;
    btn.textContent = 'Activate with Key';
  }
});

// Refresh button - re-fetch license data from server
document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '...';
  
  try {
    // Remove existing detected info and rescan
    const existingDebug = document.getElementById('irwcmsDebug');
    if (existingDebug) existingDebug.remove();
    
    // Rescan IRWCMS page for updated info
    await scanIRWCMSPage();
    
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['licenseKey'], resolve);
    });
    
    if (stored.licenseKey) {
      const result = await verifyWithServer(stored.licenseKey, true);
      
      if (result.success) {
        // Update stored data - include ALL fields needed for display
        const usageData = {
          is_unlimited: result.is_unlimited,
          is_personal: result.is_personal,
          is_railway: result.is_railway || false,
          is_superuser: result.is_superuser || false,
          cycle_spend: result.cycle_spend,
          fills_this_cycle: result.fills_this_cycle,
          today_fills: result.today_fills || 0,
          annual_cap: result.annual_cap,
          cycle_end: result.cycle_end,
          credit_balance: result.credit_balance,
          unlimited_expiry: result.unlimited_expiry, // ISO timestamp for countdown
          unlimited_fills_used: result.unlimited_fills_used || 0,
          unlimited_fills_max: result.unlimited_fills_max || 3000,
          unlimited_fills_remaining: result.unlimited_fills_remaining || 0,
          agreement_no: result.agreement_no || null,
          used_contractors: result.used_contractors || [],
          max_contractors: result.max_contractors || 5,
        is_trial: result.is_trial || false,
        trial_active: result.trial_active || false,
        trial_days_remaining: result.trial_days_remaining || 0
        };
        chrome.storage.local.set({ 
          usageData, 
          is_personal: result.is_personal,
          is_railway: result.is_railway || false,
          is_superuser: result.is_superuser || false,
          contractor_name: result.contractor_name || null
        });
        updateCreditsDisplay(usageData);
        updateSpeedControlForAccountType(result.is_personal);
        
        // Update contractor name display
        const contractorNameEl = document.getElementById('contractorNameDisplay');
        if (contractorNameEl && result.contractor_name) {
          contractorNameEl.innerHTML = `<div style="background:#1e293b;padding:8px 12px;border-radius:8px;margin-top:8px;">
            <span style="color:#94a3b8;font-size:10px;">Name of Contractor (as per LOA):</span>
            <div style="color:#22c55e;font-weight:600;font-size:12px;margin-top:2px;">${result.contractor_name}</div>
          </div>`;
          contractorNameEl.style.display = 'block';
        } else if (contractorNameEl) {
          contractorNameEl.style.display = 'none';
        }
      }
    }
  } catch (err) {
    console.error('Refresh error:', err);
  }
  
  btn.disabled = false;
  btn.textContent = '🔄 Refresh';
});

// Deactivate button
document.getElementById('deactivateBtn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to deactivate your license? This will free up the device slot.')) {
    return;
  }
  
  const btn = document.getElementById('deactivateBtn');
  btn.disabled = true;
  btn.textContent = 'Deactivating...';
  
  try {
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['licenseKey'], resolve);
    });

    if (stored.licenseKey) {
      const deviceId = await getDeviceId();
      let serverOk = false;
      try {
        const res = await fetch(`${LICENSE_SERVER_URL}/api/deactivate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_key: stored.licenseKey, device_id: deviceId })
        });
        serverOk = res.ok;
      } catch (netErr) {
        console.warn('Deactivation server unreachable:', netErr);
      }

      if (!serverOk) {
        // Server couldn't free the slot — warn but still allow local logout
        console.warn('Server deactivation failed; clearing local state anyway');
      }
    }
  } catch (err) {
    console.error('Deactivation error:', err);
  }

  // Clear local storage (even if server call failed — user can re-login to reclaim slot)
  chrome.storage.local.remove(['licenseKey', 'licenseVerified', 'licenseUses', 'creditBalance', 'loginEmail', 'sessionToken'], () => {
    showLicenseInactive();
    document.getElementById('emailInput').value = '';
    document.getElementById('licenseKeyInput').value = '';
    btn.disabled = false;
    btn.textContent = 'Deactivate License';
  });
});

// ========== Original Auto-Fill Code ==========

let parsedData = [];
let currentWorkbook = null;
let currentFileName = '';
let currentSheetIndex = -1;
let filledSheets = new Set(); // Track filled sheets
let currentDataSource = 'excel'; // Track where data came from: 'excel' or 'measurement_builder'

const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const fillBtn = document.getElementById('fillBtn');
const status = document.getElementById('status');
const rowCount = document.getElementById('rowCount');
const previewContainer = document.getElementById('previewContainer');
const previewBody = document.getElementById('previewBody');
const clearFileBtn = document.getElementById('clearFileBtn');

// Clear file button functionality
clearFileBtn.addEventListener('click', () => {
  // Reset all file-related data
  parsedData = [];
  currentWorkbook = null;
  currentSheetIndex = 0;
  currentFileName = '';
  currentDataSource = 'excel';
  filledSheets.clear();
  
  // Reset UI
  fileName.textContent = 'No file selected';
  clearFileBtn.style.display = 'none';
  rowCount.textContent = '';
  previewBody.innerHTML = '';
  previewContainer.style.display = 'none';
  fillBtn.disabled = true;
  
  // Remove sheet selector
  const existingSelector = document.getElementById('sheetSelector');
  if (existingSelector) existingSelector.remove();
  
  // Remove append/replace mode selector
  const appendModeSelector = document.getElementById('appendModeSelector');
  if (appendModeSelector) appendModeSelector.remove();
  
  showStatus('File cleared', 'info');
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // Reset previous data
  parsedData = [];
  currentWorkbook = null;
  currentSheetIndex = 0;
  filledSheets.clear();
  
  // Remove existing sheet selector
  const existingSelector = document.getElementById('sheetSelector');
  if (existingSelector) existingSelector.remove();
  
  currentFileName = file.name;
  fileName.textContent = file.name;
  clearFileBtn.style.display = 'block';
  showStatus('Parsing file...', 'info');
  
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    currentWorkbook = XLSX.read(data, { type: 'array' });
    
    // Check if CSV with multiple sheets (CSV can only have 1 sheet)
    const isCSV = file.name.toLowerCase().endsWith('.csv');
    
    // Show sheet selector if multiple sheets
    if (currentWorkbook.SheetNames.length > 1) {
      showSheetSelector(currentWorkbook.SheetNames);
    } else if (isCSV) {
      // Show warning for CSV if user might need multi-sheet
      showStatus('ℹ️ CSV files support only 1 sheet. For multi-sheet support, use .xlsx format.', 'info');
      selectSheet(0);
    } else {
      selectSheet(0);
    }
  } catch (err) {
    showStatus('Error parsing file: ' + err.message, 'error');
    fillBtn.disabled = true;
  }
  
  // Reset input so same file can be re-selected
  fileInput.value = '';
});

function showSheetSelector(sheetNames) {
  // Remove existing selector
  const existing = document.getElementById('sheetSelector');
  if (existing) existing.remove();
  
  const container = document.createElement('div');
  container.id = 'sheetSelector';
  container.style.cssText = 'margin:10px 0;padding:10px;background:#e8f5e9;border:2px solid #4CAF50;border-radius:8px;';
  
  container.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px;color:#2e7d32;">📋 Select Sheet (${sheetNames.length} found)</div>
    <div id="sheetButtons" style="display:flex;flex-direction:column;gap:5px;max-height:150px;overflow-y:auto;"></div>
  `;
  
  const fileSection = document.querySelector('.file-label')?.parentElement || fileInput.parentElement;
  fileSection.after(container);
  
  const btnContainer = container.querySelector('#sheetButtons');
  sheetNames.forEach((name, idx) => {
    const btn = document.createElement('button');
    btn.dataset.index = idx;
    updateSheetButton(btn, name, idx);
    btn.onclick = () => {
      // Highlight selected
      btnContainer.querySelectorAll('button').forEach(b => {
        const i = parseInt(b.dataset.index);
        updateSheetButton(b, sheetNames[i], i, false);
      });
      updateSheetButton(btn, name, idx, true);
      selectSheet(idx);
    };
    btnContainer.appendChild(btn);
  });
}

function updateSheetButton(btn, name, idx, isSelected = false) {
  const isFilled = filledSheets.has(idx);
  const label = isFilled ? `✅ ${idx + 1}. ${name}` : `${idx + 1}. ${name}`;
  btn.textContent = label;
  
  let bgColor = '#fff';
  if (isSelected) bgColor = '#a5d6a7';
  else if (isFilled) bgColor = '#e0e0e0';
  
  btn.style.cssText = `padding:8px 12px;background:${bgColor};border:1px solid ${isFilled ? '#888' : '#4CAF50'};border-radius:4px;cursor:pointer;text-align:left;font-size:13px;${isFilled ? 'color:#666;' : ''}`;
  
  btn.onmouseover = () => { if (!isSelected) btn.style.background = isFilled ? '#d0d0d0' : '#c8e6c9'; };
  btn.onmouseout = () => { if (!isSelected) btn.style.background = isFilled ? '#e0e0e0' : '#fff'; };
}

function selectSheet(index) {
  if (!currentWorkbook) return;
  
  currentSheetIndex = index;
  const sheet = currentWorkbook.Sheets[currentWorkbook.SheetNames[index]];
  const jsonData = XLSX.utils.sheet_to_json(sheet);
  
  parsedData = normalizeData(jsonData);
  currentDataSource = 'excel'; // Data loaded from Excel upload
  const filledTag = filledSheets.has(index) ? ' ⚠️ (Already Filled)' : '';
  rowCount.textContent = `Sheet "${currentWorkbook.SheetNames[index]}" - ${parsedData.length} rows${filledTag}`;
  renderPreview(parsedData);
  fillBtn.disabled = false;
  showStatus(`Loaded sheet: ${currentWorkbook.SheetNames[index]}`, 'success');
  
  // Check for existing rows in the form to show append/replace options
  checkExistingRows();
}

// Helper to preserve 4 decimal places for L, B, H values
function formatDecimal(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  // toFixed(10) then trim trailing zeros avoids scientific notation for any valid measurement
  const fixed = num.toFixed(10).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  // Cap at 4 decimal places
  const dotIdx = fixed.indexOf('.');
  if (dotIdx !== -1 && fixed.length - dotIdx - 1 > 4) {
    return num.toFixed(4);
  }
  return fixed;
}

// Track detected data type: 'mb' (Measurement Book) or 'vs' (Variation Statement)
let detectedDataType = 'mb';

function normalizeData(jsonData) {
  // Detect format using all column keys from up to first 5 non-empty rows
  const sampleRows = jsonData.filter(r => Object.keys(r).length > 0).slice(0, 5);
  const keySet = new Set();
  sampleRows.forEach(r => Object.keys(r).forEach(k => keySet.add(k.toLowerCase().trim())));
  const keys = Array.from(keySet);
  
  // VS detection: has "item no" and "proposed qty" columns
  const hasItemNo = keys.some(k => k.includes('item') && (k.includes('no') || k.includes('#')));
  const hasProposedQty = keys.some(k => k.includes('proposed') && k.includes('qty'));
  const hasMBFields = keys.some(k => k.includes('particular') || k === 'n1' || k === 'l' || k === 'b' || k === 'h');
  
  // If has Item No + Proposed Qty and no MB fields, it's VS format
  if (hasItemNo && hasProposedQty && !hasMBFields) {
    detectedDataType = 'vs';
    return normalizeVSData(jsonData);
  }
  
  // Otherwise, treat as MB format
  detectedDataType = 'mb';
  return normalizeMBData(jsonData);
}

// Normalize Variation Statement data
function normalizeVSData(jsonData) {
  const normalized = jsonData.map(row => {
    const norm = {};
    for (const key in row) {
      const lowerKey = key.toLowerCase().trim();
      // Item No variations
      if (lowerKey.includes('item') && (lowerKey.includes('no') || lowerKey.includes('#'))) {
        norm.ItemNo = String(row[key] || '').trim();
      }
      // Proposed Qty variations
      else if (lowerKey.includes('proposed') && lowerKey.includes('qty')) {
        norm.ProposedQty = String(row[key] || '').trim();
      }
      // Also capture Description for display
      else if (lowerKey.includes('description') || lowerKey.includes('desc')) {
        norm.Description = String(row[key] || '').trim();
      }
      // Unit
      else if (lowerKey === 'unit') {
        norm.Unit = String(row[key] || '').trim();
      }
      // Agreement Qty
      else if (lowerKey.includes('agmt') && lowerKey.includes('qty')) {
        norm.AgmtQty = String(row[key] || '').trim();
      }
    }
    return norm;
  });
  
  // Filter out rows without valid Item No and Proposed Qty
  return normalized.filter(row => row.ItemNo && row.ProposedQty);
}

// Normalize Measurement Book data
function normalizeMBData(jsonData) {
  if (jsonData.length === 0) return [];
  const safeNum = v => { const n = parseFloat(v); return isFinite(n) ? String(v) : ''; };

  // Build key→field mapping ONCE from first row — eliminates O(N×K) toLowerCase() allocations
  const keyMap = {};
  for (const key of Object.keys(jsonData[0])) {
    const lk = key.toLowerCase().trim();
    if (lk.includes('particular'))                    keyMap[key] = 'Particulars';
    else if (lk === 'n1')                              keyMap[key] = 'N1';
    else if (lk === 'n2')                              keyMap[key] = 'N2';
    else if (lk === 'n3')                              keyMap[key] = 'N3';
    else if (lk === 'k' || lk.includes('coefficient')) keyMap[key] = 'K';
    else if (lk === 'l' || lk === 'length')            keyMap[key] = 'L';
    else if (lk === 'b' || lk === 'breadth')           keyMap[key] = 'B';
    else if (lk === 'h' || lk === 'height')            keyMap[key] = 'H';
    else if (lk === 'sign' || lk === '+/-')            keyMap[key] = 'Sign';
  }
  const mappedKeys = Object.keys(keyMap);

  const normalized = jsonData.map(row => {
    const norm = {};
    for (const key of mappedKeys) {
      const field = keyMap[key];
      const val = row[key];
      if      (field === 'Particulars')                  norm.Particulars = String(val ?? '');
      else if (field === 'N1' || field === 'N2' || field === 'N3' || field === 'K') norm[field] = safeNum(val);
      else if (field === 'L' || field === 'B' || field === 'H') norm[field] = formatDecimal(val);
      else if (field === 'Sign')                         norm.Sign = val;
    }
    return norm;
  });
  return normalized.filter(row => row.Particulars || row.N1 || row.L || row.B || row.H);
}

fillBtn.addEventListener('click', async () => {
  if (parsedData.length === 0) {
    showStatus('No data to fill', 'error');
    return;
  }
  
  // Check if sheet already filled
  if (currentSheetIndex >= 0 && filledSheets.has(currentSheetIndex)) {
    const sheetName = currentWorkbook?.SheetNames[currentSheetIndex] || 'this sheet';
    if (!confirm(`⚠️ "${sheetName}" was already filled.\n\nDo you want to fill it again?`)) {
      return;
    }
  }
  
  showStatus('Checking quota...', 'info');

  // Run storage read and tab query in parallel — both are independent
  const [stored, [tab]] = await Promise.all([
    chrome.storage.local.get(['licenseKey', 'deviceId']),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);

  if (!stored.licenseKey || !stored.deviceId) {
    showStatus('License not activated', 'error');
    return;
  }

  // Extract agreement number, measurement number, IRWCMS email, and contractor name from page
  let agreementNo = null;
  let measurementNo = null;
  let irwcmsEmail = null;
  let contractorName = null;
  let detectionError = null;
  try {
    // tab already resolved via parallel Promise.all above
    const isIrwcmsPage = tab?.url && (
      tab.url.includes('ircep.gov.in') ||
      tab.url.includes('irwcms.primerp.in')
    );
    
    if (isIrwcmsPage) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Look for Agreement Number on page
          let agreementNo = null;
          const allText = document.body.innerText;
          const match = allText.match(/Agreement Number[:\s]*([A-Z0-9\/\-]+)/i);
          if (match) agreementNo = match[1].trim();
          // Also check table cells
          const cells = document.querySelectorAll('td');
          for (const cell of cells) {
            if (cell.previousElementSibling?.innerText?.includes('Agreement Number')) {
              agreementNo = cell.innerText.trim();
              break;
            }
          }
          
          // Extract IRWCMS login email from page
          // Look for email pattern in page - commonly in welcome text or header area
          let irwcmsEmail = null;
          const pageText = document.body.innerText || '';
          const pageHtml = document.body.innerHTML || '';
          
          // Method 1: Try to find email in parentheses (common IRWCMS pattern)
          const emailInParens = pageText.match(/\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/);
          if (emailInParens) {
            irwcmsEmail = emailInParens[1].toLowerCase();
          }
          
          // Method 2: Look for Welcome/Logged in text with email
          if (!irwcmsEmail) {
            const welcomeMatch = pageText.match(/(?:Welcome|Logged in as|User|Login)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
            if (welcomeMatch) irwcmsEmail = welcomeMatch[1].toLowerCase();
          }
          
          // Method 3: Check for email in header/nav area
          if (!irwcmsEmail) {
            const header = document.querySelector('header, nav, .header, .navbar, #header, #nav, .user-info, .login-info, .welcome');
            if (header) {
              const headerMatch = header.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (headerMatch) irwcmsEmail = headerMatch[0].toLowerCase();
            }
          }
          
          // Method 4: Look for email in any dropdown or user menu
          if (!irwcmsEmail) {
            const userElements = document.querySelectorAll('.dropdown, .user-menu, .profile, [class*="user"], [class*="login"], [class*="email"]');
            for (const el of userElements) {
              const match = el.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (match) {
                irwcmsEmail = match[0].toLowerCase();
                break;
              }
            }
          }
          
          // Method 5: Fallback - find any email in first 3000 chars of page
          if (!irwcmsEmail) {
            const topText = pageText.substring(0, 3000);
            const fallbackMatch = topText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (fallbackMatch) irwcmsEmail = fallbackMatch[0].toLowerCase();
          }
          
          // Method 6: Check HTML attributes for email (data attributes, title, etc.)
          if (!irwcmsEmail) {
            const elementsWithEmail = document.querySelectorAll('[data-email], [title*="@"], [data-user]');
            for (const el of elementsWithEmail) {
              const email = el.getAttribute('data-email') || el.getAttribute('title') || el.getAttribute('data-user');
              if (email && email.includes('@')) {
                const match = email.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (match) {
                  irwcmsEmail = match[0].toLowerCase();
                  break;
                }
              }
            }
          }
          
          console.log('Detected IRWCMS email:', irwcmsEmail);
          console.log('Page text preview:', pageText.substring(0, 500));
          
          // Extract Contractor Name from page (for Contractor account verification)
          let contractorName = null;
          
          // Method 1: Look for "Name of Contractor" label in text
          const contractorMatch = allText.match(/Name of Contractor[:\s]*([A-Z0-9\s\-&.,()]+?)(?:\s{2,}|Agreement Number|Situation|Date of|Name of Work)/i);
          if (contractorMatch) {
            contractorName = contractorMatch[1].trim();
          }
          
          // Method 2: Check table cells for contractor name
          if (!contractorName) {
            const allCells = document.querySelectorAll('td');
            for (const cell of allCells) {
              const prevText = cell.previousElementSibling?.innerText?.toLowerCase() || '';
              if (prevText.includes('name of contractor')) {
                contractorName = cell.innerText.trim();
                break;
              }
            }
          }
          
          // Method 3: Check for label/value pairs
          if (!contractorName) {
            const labels = document.querySelectorAll('td, th, label, span');
            for (const label of labels) {
              if (label.innerText?.toLowerCase().includes('name of contractor')) {
                // Next sibling might have the value
                const next = label.nextElementSibling;
                if (next) {
                  contractorName = next.innerText?.trim();
                  break;
                }
              }
            }
          }
          
          console.log('Detected Contractor Name:', contractorName);
          
          // Extract Measurement No. from page
          let measurementNo = null;
          
          // Method 1: Check input fields for measurement number pattern
          const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
          for (const input of allInputs) {
            const val = input.value?.trim();
            // Look for measurement number pattern: digits followed by slashes with alphanumerics
            if (val && val.match(/^\d{10,}\/[A-Z]+\/[A-Z]+\/[A-Z]+/i)) {
              measurementNo = val;
              break;
            }
          }
          
          // Method 2: Look for "Measurement No" label and check adjacent input/text
          if (!measurementNo) {
            const allElements = document.querySelectorAll('td, th, label, span, div');
            for (const el of allElements) {
              const text = el.innerText?.toLowerCase().trim() || '';
              if (text.includes('measurement no') || text.includes('measurement number')) {
                // Check for input field within or next to this element
                const input = el.querySelector('input') || el.parentElement?.querySelector('input');
                if (input && input.value?.trim()) {
                  measurementNo = input.value.trim();
                  break;
                }
                // Check next sibling for input or value
                let nextEl = el.nextElementSibling;
                while (nextEl) {
                  const sibInput = nextEl.querySelector ? nextEl.querySelector('input') : null;
                  if (sibInput && sibInput.value?.trim()) {
                    measurementNo = sibInput.value.trim();
                    break;
                  }
                  if (nextEl.tagName === 'INPUT' && nextEl.value?.trim()) {
                    measurementNo = nextEl.value.trim();
                    break;
                  }
                  if (nextEl.tagName === 'TD' && nextEl.querySelector('input')) {
                    measurementNo = nextEl.querySelector('input').value?.trim();
                    break;
                  }
                  nextEl = nextEl.nextElementSibling;
                }
                if (measurementNo) break;
                
                // Fallback: check link
                const linkInside = el.querySelector('a');
                if (linkInside && linkInside.textContent.trim().length > 10) {
                  measurementNo = linkInside.textContent.trim();
                  break;
                }
              }
            }
          }
          
          // Method 3: Look for links with Measurement No pattern
          if (!measurementNo) {
            const links = document.querySelectorAll('a');
            for (const link of links) {
              const text = link.textContent.trim();
              if (text && /^\d{10,}\/[A-Z]+\//.test(text)) {
                measurementNo = text;
                break;
              }
            }
          }
          
          // Method 4: Regex search in page text
          if (!measurementNo) {
            const measurementMatch = allText.match(/Measurement No[.:\s]*(\d{10,}[A-Z0-9\/\-]+)/i);
            if (measurementMatch) {
              measurementNo = measurementMatch[1].trim();
            }
          }
          
          console.log('Detected Measurement No:', measurementNo);
          
          return { agreementNo, irwcmsEmail, contractorName, measurementNo };
        }
      });
      agreementNo = results?.[0]?.result?.agreementNo;
      measurementNo = results?.[0]?.result?.measurementNo;
      irwcmsEmail = results?.[0]?.result?.irwcmsEmail;
      contractorName = results?.[0]?.result?.contractorName;
    }
  } catch (e) {
    console.log('Could not extract page info:', e);
    detectionError = e.message || 'Unknown error';
  }
  
  // Track fill on server BEFORE filling
  // Use page-extracted email (from IRWCMS header) for validation
  const pageExtractedEmail = irwcmsEmail || null;
  console.log('IRWCMS page email for validation:', pageExtractedEmail);
  console.log('Detection error (if any):', detectionError);
  
  // Get contractor name from page for contractor account verification
  const pageContractorName = contractorName || null;
  console.log('IRWCMS contractor name for validation:', pageContractorName);
  
  // Get measurement number from page for tracking
  const pageMeasurementNo = measurementNo || null;
  console.log('IRWCMS measurement no for tracking:', pageMeasurementNo);
  
  try {
    // Fetch session data and fire fill API call in parallel with each other
    const sessionData = await chrome.storage.local.get(['sessionToken', 'railway_official_name', 'railway_official_designation']);

    const fillResponse = await fetch(`${LICENSE_SERVER_URL}/api/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: stored.licenseKey,
        device_id: stored.deviceId,
        session_token: sessionData.sessionToken,
        rows_filled: parsedData.length,
        agreement_no: agreementNo,
        measurement_no: pageMeasurementNo,
        irwcms_email: pageExtractedEmail,
        contractor_name: pageContractorName,
        railway_official_name: sessionData.railway_official_name || null,
        railway_official_designation: sessionData.railway_official_designation || null,
        fill_source: currentDataSource  // 'excel' for uploads, 'measurement_builder' for cloud data
      })
    });
    
    // Check if response is valid before parsing JSON
    const responseText = await fillResponse.text();
    let fillResult;
    try {
      fillResult = JSON.parse(responseText);
    } catch (parseError) {
      console.warn('Server returned non-JSON response:', responseText.substring(0, 100));
      // Server might be temporarily unavailable - allow fill to continue
      fillResult = { success: true, message: 'Fill completed (server sync pending)' };
    }
    
    // Handle session expired - another device logged in
    if (fillResult.session_expired) {
      await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
      showStatus('⚠️ License is active on another device. Please login again to use here.', 'error');
      showLicenseInactive();
      return;
    }
    
    if (!fillResult.success) {
      // Contractor name already used in another trial
      if (fillResult.contractor_name_duplicate) {
        const supportEmail = fillResult.support_email || 'support@illall.in';
        showStatus(`🚫 ${fillResult.message}\n\n📧 Contact: ${supportEmail}`, 'error');
      } else if (fillResult.trial_restriction) {
        showStatus(`⏰ ${fillResult.message}\n\n👉 Use the Measurement Builder at irwcms.primerp.in/measurement-builder for trial access!\n\n💳 Upgrade to paid plan to unlock Excel fills.`, 'error');
        const buyBtn = document.getElementById('buyCreditsFixed');
        if (buyBtn) buyBtn.style.display = 'block';
      } else if (fillResult.message && fillResult.message.includes('Personal license requires IRWCMS login')) {
        console.log('Email detection failed. Debug info:');
        console.log('- Detected email:', pageExtractedEmail);
        console.log('- Detection error:', detectionError);
        showStatus(`❌ ${fillResult.message}\n\n⚠️ Email not detected from page. Please ensure you are logged into IRWCMS and try again. Check browser console (F12) for debug info.`, 'error');
      } else if (fillResult.message && fillResult.message.includes('Contractor license requires verification')) {
        // Contractor name detection failed for contractor account
        console.log('Contractor detection failed. Debug info:');
        console.log('- Detected contractor:', pageContractorName);
        console.log('- Detection error:', detectionError);
        showStatus(`❌ ${fillResult.message}\n\n⚠️ Please open the Measurement Details page where "Name of Contractor" is visible.`, 'error');
      } else if (fillResult.message && fillResult.message.includes('License is registered to')) {
        // Contractor name mismatch
        showStatus(`❌ ${fillResult.message}\n\n⚠️ This license is registered for a different contractor. Contact support if this is incorrect.`, 'error');
      } else {
        showStatus(`❌ ${fillResult.message}`, 'error');
      }
      if (fillResult.need_onboarding) {
        showStatus('❌ Please complete onboarding payment at irwcms.primerp.in', 'error');
      }
      // Show buy credits button if insufficient credits
      if (fillResult.message && fillResult.message.includes('Insufficient credits')) {
        const buyBtn = document.getElementById('buyCreditsFixed');
        if (buyBtn) buyBtn.style.display = 'block';
      }
      return;
    }
    
    // Show email verification status FIRST for personal accounts
    if (fillResult.email_verified && fillResult.verified_email) {
      showStatus(`✅ IRWCMS Email Verified: ${fillResult.verified_email}`, 'success');
      await new Promise(r => setTimeout(r, 1500)); // Show for 1.5 seconds
    }
    
    // Show auto-capture notification if contractor name was captured
    if (fillResult.auto_captured_name) {
      showStatus(`✅ Contractor name "${fillResult.auto_captured_name}" locked to your license!`, 'success');
      await new Promise(r => setTimeout(r, 2000)); // Show for 2 seconds
    }
    // Update usage display and store new data - include ALL fields for countdown/progress
    const usageData = {
      is_unlimited: fillResult.is_unlimited,
      is_personal: fillResult.is_personal,
      is_railway: fillResult.is_railway || false,
      is_superuser: fillResult.is_superuser || false,
      cycle_spend: fillResult.cycle_spend,
      fills_this_cycle: fillResult.fills_this_cycle,
      free_fills_remaining: fillResult.free_fills_remaining,
      annual_cap: fillResult.annual_cap,
      cycle_end: fillResult.cycle_end,
      credit_balance: fillResult.credit_balance,
      unlimited_expiry: fillResult.unlimited_expiry || null,
      unlimited_fills_used: fillResult.unlimited_fills_used || 0,
      unlimited_fills_max: fillResult.unlimited_fills_max || 3000,
      unlimited_fills_remaining: fillResult.unlimited_fills_remaining || 0,
      agreement_no: fillResult.agreement_no || null,
      today_fills: fillResult.today_fills || 0,
      used_contractors: fillResult.used_contractors || [],
      max_contractors: fillResult.max_contractors || 5,
      is_trial: fillResult.is_trial || false,
      trial_active: fillResult.trial_active || false,
      trial_days_remaining: fillResult.trial_days_remaining || 0
    };
    updateCreditsDisplay(usageData);
    
    // Store contractor name if auto-captured or verified
    const contractorToStore = fillResult.auto_captured_name || fillResult.verified_contractor;
    const storageData = { 
      usageData, 
      is_personal: fillResult.is_personal, 
      is_railway: fillResult.is_railway || false,
      is_superuser: fillResult.is_superuser || false 
    };
    if (contractorToStore) {
      storageData.contractor_name = contractorToStore;
      console.log('Storing contractor name:', contractorToStore);
    }
    chrome.storage.local.set(storageData);
    
  } catch (err) {
    // Allow offline usage - don't block if server is down
    console.warn('Fill tracking failed:', err);
  }
  
  // Reset stop flag and show stop button
  fillStopped = false;
  const stopBtn = document.getElementById('stopFillBtn');
  fillBtn.disabled = true;
  fillBtn.textContent = 'Filling...';
  stopBtn.style.display = 'block';
  
  showStatus('Detecting form type...', 'info');
  
  const fillStartTime = Date.now();
  const totalRows = parsedData.length;
  const fillDelay = currentFillDelay;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // First detect form type: Variation Statement or Measurement Book
    const formTypeResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const pageText = document.body?.innerText || document.body?.textContent || '';
        // Lowercase once — avoids repeated .toLowerCase() calls on large strings
        const pageTextLower = pageText.toLowerCase();
        // Check HTML only for addrow (not in visible text) — avoid full innerHTML lower
        const hasAddRowInHtml = !!document.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]') ||
                                !!document.querySelector('button, input[type="button"]') &&
                                Array.from(document.querySelectorAll('button')).some(b => b.textContent.toLowerCase().includes('add row'));

        // Variation Statement indicators
        const hasProposedQty     = pageText.includes('Proposed') && (pageText.includes('Qty') || pageText.includes('qty'));
        const hasScheduleTabs    = /Schedule[-\s]?[AB]\d?/i.test(pageText);
        const hasItemNo          = pageText.includes('Item No') || pageText.includes('Item no');
        const hasVariation       = pageTextLower.includes('variation');
        const hasContractVariation = pageText.includes('Contract Variation');
        const hasVariationDetails  = pageText.includes('Variation Details');

        // Measurement Book indicators — use pageTextLower (single allocation)
        const hasAddRow      = pageTextLower.includes('add row') || hasAddRowInHtml;
        const hasParticulars = pageText.includes('Particulars');
        const hasN1          = pageText.includes('N1');
        const hasSaveAsDraft = pageTextLower.includes('save as draft');
        
        // Determine form type
        let formType = 'none';
        
        // PRIORITY 1: Strong MB indicators (Add Row is unique to MB pages)
        if (hasAddRow || (hasParticulars && hasN1)) {
          formType = 'measurement';
        }
        // PRIORITY 2: Strong VS indicators (Contract Variation page - only if NOT MB)
        else if (hasContractVariation || hasVariationDetails) {
          formType = 'variation';
        }
        // PRIORITY 3: Check for Variation form (has Proposed Qty + other indicators)
        else if (hasProposedQty && (hasScheduleTabs || hasItemNo || hasVariation)) {
          formType = 'variation';
        }
        
        return { formType, hasProposedQty, hasScheduleTabs, hasItemNo, hasAddRow, hasParticulars, hasContractVariation, hasVariationDetails };
      }
    });
    
    // Determine form type from results
    let detectedFormType = 'none';
    for (const result of formTypeResults || []) {
      if (result?.result?.formType === 'variation') {
        detectedFormType = 'variation';
        break;
      } else if (result?.result?.formType === 'measurement') {
        detectedFormType = 'measurement';
      }
    }
    
    console.log('Form type detection results:', formTypeResults?.map(r => r?.result), 'Detected:', detectedFormType);
    console.log('Excel data type:', detectedDataType);
    
    // Check for data type mismatch between Excel and page
    if (detectedDataType === 'vs' && detectedFormType === 'measurement') {
      showStatus('⚠️ VS Excel detected but page is MB form. Please open a Variation Statement page.', 'error', 5000);
      fillBtn.disabled = false;
      fillBtn.textContent = 'Fill Form';
      stopBtn.style.display = 'none';
      return;
    }
    if (detectedDataType === 'mb' && detectedFormType === 'variation') {
      showStatus('⚠️ MB Excel detected but page is VS form. Please open a Measurement Book page.', 'error', 5000);
      fillBtn.disabled = false;
      fillBtn.textContent = 'Fill Form';
      stopBtn.style.display = 'none';
      return;
    }
    
    // Handle based on form type (or Excel data type if page type unknown)
    const effectiveFormType = detectedFormType !== 'none' ? detectedFormType : 
                              (detectedDataType === 'vs' ? 'variation' : 'measurement');
    
    if (effectiveFormType === 'variation') {
      // ========== VARIATION STATEMENT FILL ==========
      showStatus('📋 Variation form detected. Filling...', 'info');
      
      // Execute the fill (uses native value setter to avoid triggering alerts)
      const variationResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: fillVariationFormOnPage,
        args: [parsedData]
      });
      
      // Aggregate results from all frames
      let totalFilled = 0;
      let allNotFound = [];
      let resultMessage = '';
      
      for (const result of variationResults || []) {
        if (result?.result?.filled) {
          totalFilled += result.result.filled;
          if (result.result.notFound) {
            allNotFound = allNotFound.concat(result.result.notFound);
          }
          if (result.result.message) {
            resultMessage = result.result.message;
          }
        }
      }
      
      const fillDuration = ((Date.now() - fillStartTime) / 1000).toFixed(1);
      
      if (totalFilled > 0) {
        showStatus(`✅ Filled ${totalFilled} items in ${fillDuration}s` + (allNotFound.length > 0 ? ` (${allNotFound.length} not found)` : ''), 'success');
      } else {
        showStatus('⚠️ No matching Item Numbers found. Check your Excel has "Item No" and "Proposed Qty" columns.', 'error', 5000);
      }
      
      // Mark sheet as filled
      if (currentSheetIndex >= 0 && totalFilled > 0) {
        filledSheets.add(currentSheetIndex);
        const btnContainer = document.getElementById('sheetButtons');
        if (btnContainer && currentWorkbook) {
          btnContainer.querySelectorAll('button').forEach(btn => {
            const idx = parseInt(btn.dataset.index);
            updateSheetButton(btn, currentWorkbook.SheetNames[idx], idx, idx === currentSheetIndex);
          });
        }
        rowCount.textContent = `Sheet "${currentWorkbook.SheetNames[currentSheetIndex]}" - ${totalFilled} items ✅ Filled`;
      }
      
      fillBtn.disabled = false;
      fillBtn.textContent = 'Fill Form';
      stopBtn.style.display = 'none';
      return;
    }
    
    // Note: If page type is unknown, we try to fill based on Excel data type
    // The effectiveFormType is already set above
    
    // ========== MEASUREMENT BOOK FILL (existing logic) ==========
    showStatus(`Filling form${selectedAppendMode ? ' (Append mode)' : ''}...`, 'info');
    
    // Execute the fill script with stop check capability
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillFormOnPage,
      args: [parsedData, fillDelay, selectedAppendMode]
    });
    
    const fillDuration = ((Date.now() - fillStartTime) / 1000).toFixed(1);
    const filledCount = results?.[0]?.result ?? totalRows;
    
    // Mark sheet as filled
    if (currentSheetIndex >= 0 && !fillStopped) {
      filledSheets.add(currentSheetIndex);
      const btnContainer = document.getElementById('sheetButtons');
      if (btnContainer && currentWorkbook) {
        btnContainer.querySelectorAll('button').forEach(btn => {
          const idx = parseInt(btn.dataset.index);
          updateSheetButton(btn, currentWorkbook.SheetNames[idx], idx, idx === currentSheetIndex);
        });
      }
      rowCount.textContent = `Sheet "${currentWorkbook.SheetNames[currentSheetIndex]}" - ${parsedData.length} rows ✅ Filled`;
    }
    
    if (fillStopped) {
      showStatus(`⏹ Stopped after ${filledCount} rows`, 'info');
    } else {
      showStatus(`✅ Filled ${filledCount} rows in ${fillDuration}s`, 'success');
    }
    
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    // Reset buttons
    fillBtn.disabled = false;
    fillBtn.textContent = 'Fill Form';
    stopBtn.style.display = 'none';
  }
});

// Stop Fill button handler
document.getElementById('stopFillBtn').addEventListener('click', async () => {
  fillStopped = true;
  showStatus('⏹ Stopping...', 'info');
  
  // Inject stop signal into the page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { window.IRWCMS_STOP_FILL = true; }
  });
});

// Update usage display (new pricing model)
// Global variable to track countdown interval
let unlimitedCountdownInterval = null;

// Start real-time countdown for unlimited mode
function startUnlimitedCountdown(elementId, expiryTimestamp) {
  // Clear any existing interval
  if (unlimitedCountdownInterval) {
    clearInterval(unlimitedCountdownInterval);
    unlimitedCountdownInterval = null;
  }
  
  if (!expiryTimestamp) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = '⏱️ 3 days';
    return;
  }
  
  const expiryDate = new Date(expiryTimestamp);
  
  function updateCountdown() {
    const now = new Date();
    const diff = expiryDate.getTime() - now.getTime();
    
    const el = document.getElementById(elementId);
    if (!el) {
      clearInterval(unlimitedCountdownInterval);
      unlimitedCountdownInterval = null;
      return;
    }
    
    if (diff <= 0) {
      el.textContent = '⏱️ Expired';
      el.style.background = 'rgba(239,68,68,0.3)';
      clearInterval(unlimitedCountdownInterval);
      unlimitedCountdownInterval = null;
      return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    let timeStr = '';
    if (days > 0) {
      timeStr = `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      timeStr = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      timeStr = `${minutes}m ${seconds}s`;
    } else {
      timeStr = `${seconds}s`;
    }
    
    el.textContent = `⏱️ ${timeStr}`;
  }
  
  // Update immediately
  updateCountdown();
  
  // Update every second
  unlimitedCountdownInterval = setInterval(updateCountdown, 1000);
}

// Stable DOM skeleton for credits panel — written once, updated in-place
let _creditsPanelReady = false;
function ensureCreditsPanelDOM(quotaEl) {
  if (_creditsPanelReady) return;
  quotaEl.innerHTML = `
    <div id="cp-wrap" style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:8px;font-size:13px;border:1px solid #e2e8f0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#334155;font-weight:600;">Account Balance:</span>
        <span id="cp-balance" style="font-weight:bold;font-size:16px;">&#8377;0</span>
      </div>
      <div style="display:flex;justify-content:space-between;color:#475569;margin-bottom:6px;">
        <span>&#128197; Today: <strong id="cp-today">0</strong></span>
        <span>&#128202; Total: <strong id="cp-total">0</strong></span>
      </div>
      <div style="text-align:center;color:#6d28d9;font-size:10px;line-height:1.4;">
        &#8377;1/fill (1-500) &#8594; &#8377;0.50 (501-5,000) &#8594; &#8377;0.20 (5,001+)
      </div>
      <div id="cp-trial"></div>
    </div>`;
  _creditsPanelReady = true;
}

function updateCreditsDisplay(data) {
  const quotaEl = document.getElementById('quotaDisplay');
  if (!quotaEl) return;
  quotaEl.style.display = 'block';

  // Legacy numeric format — full rewrite is OK (rare path)
  if (typeof data === 'number') {
    _creditsPanelReady = false;
    quotaEl.innerHTML = data === -1
      ? '<span style="color:#11998e;">∞ <strong>UNLIMITED</strong></span>'
      : `<span style="color:#11998e;">💰 Credits: <strong>${data.toLocaleString()}</strong></span>`;
    return;
  }

  const isSuperuser    = data.is_superuser || false;
  const isUnlimited    = data.is_unlimited;
  const isPersonal     = data.is_personal;
  const fillsThisCycle = data.fills_this_cycle || 0;
  const todayFills     = data.today_fills || 0;
  const creditBalance  = data.credit_balance || 0;

  if (isSuperuser) {
    const badge = document.getElementById('superuserBadge');
    if (badge) {
      badge.style.display = 'flex';
      document.getElementById('todayFills').textContent = todayFills.toLocaleString();
      document.getElementById('totalFills').textContent = fillsThisCycle.toLocaleString();
    }
    quotaEl.style.display = 'none';
    const buyBtn = document.getElementById('buyCreditsFixed');
    if (buyBtn) buyBtn.style.display = 'none';
    return;
  }
  const suBadge = document.getElementById('superuserBadge');
  if (suBadge) suBadge.style.display = 'none';

  // Build stable DOM once — subsequent calls only update text nodes (zero HTML reparse)
  ensureCreditsPanelDOM(quotaEl);

  const balanceColor = creditBalance >= 250 ? '#16a34a' : creditBalance > 0 ? '#d97706' : '#dc2626';
  const cpBalance = document.getElementById('cp-balance');
  cpBalance.style.color = balanceColor;
  cpBalance.textContent = `₹${creditBalance.toLocaleString()}`;
  document.getElementById('cp-today').textContent = todayFills.toLocaleString();
  document.getElementById('cp-total').textContent = fillsThisCycle.toLocaleString();

  // Trial section — only rewrite when needed
  const isTrial = data.is_trial || false;
  const trialActive = data.trial_active || false;
  const trialDays = data.trial_days_remaining || 0;
  const trialEl = document.getElementById('cp-trial');
  if (trialEl) {
    if (isTrial && trialActive) {
      const uc = trialDays <= 2 ? '#dc2626' : trialDays <= 4 ? '#d97706' : '#16a34a';
      trialEl.innerHTML = `<div style="margin-top:6px;padding:6px 8px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;text-align:center;">
        <span style="color:${uc};font-weight:600;font-size:11px;">⏰ Trial: ${trialDays} day${trialDays !== 1 ? 's' : ''} remaining</span>
        <div style="color:#92400e;font-size:9px;margin-top:2px;">💳 <a href="https://irwcms.primerp.in/buy" style="color:#2563eb;text-decoration:underline;">Upgrade to paid plan</a></div>
      </div>`;
    } else if (isTrial && !trialActive) {
      trialEl.innerHTML = `<div style="margin-top:6px;padding:6px 8px;background:#fee2e2;border:1px solid #fecaca;border-radius:6px;text-align:center;">
        <span style="color:#dc2626;font-weight:600;font-size:11px;">❌ Trial expired</span>
        <div style="color:#991b1b;font-size:9px;margin-top:2px;">💳 <a href="https://irwcms.primerp.in/buy" style="color:#2563eb;text-decoration:underline;">Buy license to continue</a></div>
      </div>`;
    } else {
      trialEl.textContent = '';
    }
  }

  const buyCreditsBtn = document.getElementById('buyCreditsFixed');
  if (buyCreditsBtn) {
    buyCreditsBtn.style.display = (isUnlimited && isPersonal) ? 'none' : 'block';
  }
}

// This function will be injected into the page for Variation Statement fills
function fillVariationFormOnPage(data) {
  console.log('IRWCMS Auto-Fill: Starting Variation fill with', data.length, 'items');
  
  // Uses native value setter to set input values without triggering blur/change events
  // This avoids the IRWCMS validation alert that fires on each input
  
  // Normalize data - accept various column names
  const normalizedData = data.map(row => {
    const itemNo = row.itemNo || row['Item No'] || row['Item No.'] || row.ItemNo || row.item_no || 
                   row['item no'] || row['item_no'] || row['ITEM NO'] || row['ITEM NO.'] || '';
    const proposedQty = row.proposedQty || row['Proposed Qty'] || row['Proposed Qty.'] || row.ProposedQty || 
                        row.proposed_qty || row.Qty || row.qty || row['QTY'] || row['Quantity'] || '';
    return { 
      itemNo: String(itemNo).trim(), 
      proposedQty: String(proposedQty).trim() 
    };
  }).filter(row => row.itemNo && row.proposedQty);
  
  console.log('IRWCMS Auto-Fill: Normalized data:', normalizedData);
  
  if (normalizedData.length === 0) {
    return { 
      success: false, 
      message: 'No valid data found. Excel must have "Item No" and "Proposed Qty" columns.',
      filled: 0,
      notFound: []
    };
  }
  
  // Build a map of Item No -> Proposed Qty for quick lookup
  const dataMap = new Map();
  normalizedData.forEach(row => {
    dataMap.set(row.itemNo, row.proposedQty);
  });
  
  let filledCount = 0;
  const notFoundItems = [];
  const foundItems = [];

  // Hoist native setter — avoids getOwnPropertyDescriptor() call per matched row
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

  // Pre-compile item number regex once
  const ITEM_NO_RE = /^\d+(\.\d+)+$/;

  const tables = document.querySelectorAll('table');
  
  for (const table of tables) {
    const rows = table.querySelectorAll('tr');
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      let itemNoValue = null;
      
      // Find the Item No. cell in this row
      for (const cell of cells) {
        const text = cell.textContent?.trim() || '';
        if (ITEM_NO_RE.test(text)) {
          itemNoValue = text;
          break;
        }
      }

      if (!itemNoValue) continue;

      // Check if we have data for this Item No.
      const proposedQty = dataMap.get(itemNoValue);
      if (!proposedQty) continue;
      
      // Find the "Proposed Qty" input field in this row
      const inputs = row.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
      
      // Cache native setter once outside the loop (hoisted below)
      let proposedInput = null;

      for (const input of inputs) {
        if (input.disabled || input.readOnly) continue;
        const parentCell = input.closest('td');
        if (!parentCell) continue;

        // Fast path: check inline style before triggering getComputedStyle
        const inlineGreen = parentCell.style.backgroundColor.includes('green') ||
                            input.style.backgroundColor.includes('green');
        if (inlineGreen) { proposedInput = input; break; }

        // Medium path: check CSS class for Bootstrap/Tailwind green helpers
        if (parentCell.classList.contains('bg-success') ||
            parentCell.classList.contains('table-success') ||
            parentCell.classList.contains('bg-green')) {
          proposedInput = input; break;
        }

        // Use cellIndex (O(1) DOM property) instead of Array.from().indexOf() (O(siblings))
        if (parentCell.cellIndex >= 7) { proposedInput = input; break; }
      }

      // Final fallback: first editable (avoids getComputedStyle entirely)
      if (!proposedInput) {
        for (const input of inputs) {
          if (!input.disabled && !input.readOnly) { proposedInput = input; break; }
        }
      }

      if (proposedInput) {
        nativeInputValueSetter.call(proposedInput, proposedQty);
        
        // Only dispatch 'input' event - avoid 'change' and 'blur' which trigger the alert
        proposedInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        console.log(`IRWCMS Auto-Fill: Filled Item ${itemNoValue} with Proposed Qty: ${proposedQty}`);
        filledCount++;
        foundItems.push(itemNoValue);
        dataMap.delete(itemNoValue);
      }
    }
  }
  
  // Items not found on page
  dataMap.forEach((qty, itemNo) => {
    notFoundItems.push(itemNo);
  });
  
  console.log(`IRWCMS Auto-Fill: Variation fill complete. Filled: ${filledCount}, Not found: ${notFoundItems.length}`);
  
  return {
    success: filledCount > 0,
    message: filledCount > 0 
      ? `✅ Filled ${filledCount} items` + (notFoundItems.length > 0 ? `. ${notFoundItems.length} items not found on page.` : '')
      : 'No matching Item Numbers found on this page.',
    filled: filledCount,
    notFound: notFoundItems,
    found: foundItems
  };
}

// This function will be injected into the page
function fillFormOnPage(data, fillDelayMs = 100, appendMode = false) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const rowDelay = fillDelayMs || 100;
  
  // Reset stop flag
  window.IRWCMS_STOP_FILL = false;
  
  async function fillFormRows() {
    console.log('IRWCMS Auto-Fill: Starting to fill', data.length, 'rows with', rowDelay, 'ms delay in', appendMode ? 'APPEND' : 'REPLACE', 'mode');
    
    // Check if any row needs coefficient
    const needsCoefficient = data.some(row => 
      (row.K !== undefined && row.K !== null && row.K !== '') ||
      (row.Sign !== undefined && row.Sign !== null && row.Sign !== '')
    );
    
    // Check the "Use Coefficient" checkbox if needed
    if (needsCoefficient) {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const useCoeffCheckbox = checkboxes.find(cb => {
        const parent = cb.closest('div, label, td') || cb.parentElement;
        const text = parent?.textContent || '';
        return text.toLowerCase().includes('coefficient');
      });
      
      if (useCoeffCheckbox && !useCoeffCheckbox.checked) {
        useCoeffCheckbox.click();
        await delay(50);
      }
    }
    
    let filledCount = 0;

    // Cache Add Row button; re-query only if the node is detached from DOM
    let cachedAddRowBtn = null;
    function getAddRowBtn() {
      if (cachedAddRowBtn && document.contains(cachedAddRowBtn)) return cachedAddRowBtn;
      cachedAddRowBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.trim().toLowerCase() === 'add row' ||
        b.textContent.toLowerCase().includes('add row')
      ) || null;
      return cachedAddRowBtn;
    }

    for (let i = 0; i < data.length; i++) {
      // Check for stop signal
      if (window.IRWCMS_STOP_FILL) {
        console.log('IRWCMS Auto-Fill: Stopped by user at row', i);
        return filledCount;
      }

      const row = data[i];

      // In APPEND mode: Always click "Add row" (including first row) to add after existing
      // In REPLACE mode: Click "Add row" only after the first row
      const shouldAddRow = appendMode ? true : (i > 0);

      if (shouldAddRow) {
        const addRowBtn = getAddRowBtn();
        if (addRowBtn) {
          addRowBtn.click();
          await delay(50);
        }
      }
      
      // Get the last row in the table
      const tbody = document.querySelector('#datatabody, #datatable tbody, table.datatable tbody');
      const tableRows = tbody ? tbody.querySelectorAll('tr') : document.querySelectorAll('table tbody tr');
      const lastRow = tableRows[tableRows.length - 1];
      
      if (!lastRow) continue;
      
      // Fill Particulars - skip if disabled
      if (row.Particulars) {
        let input = lastRow.querySelector('input[name="disc"]') || 
                    lastRow.querySelector('input[placeholder="Particulars"]') ||
                    lastRow.querySelector('input[type="text"], input:not([type])');
        if (input && !input.disabled && !input.readOnly) {
          input.value = row.Particulars;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      
      // Get all non-radio/checkbox inputs in the row (excluding disabled)
      const inputs = Array.from(lastRow.querySelectorAll('input')).filter(inp =>
        inp.type !== 'radio' && inp.type !== 'checkbox' && inp.type !== 'hidden' &&
        !inp.disabled && !inp.readOnly
      );
      
      // Helper to fill input only if not disabled
      const fillInput = (input, value) => {
        if (input && !input.disabled && !input.readOnly && value !== undefined && value !== null && value !== '') {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      
      // Handle Sign (radio buttons for + or -) - skip if disabled
      if (row.Sign) {
        const signStr = String(row.Sign).trim();
        const isPlus = signStr === '+' || signStr === '1' || row.Sign === 1;
        const radios = Array.from(lastRow.querySelectorAll('input[type="radio"]')).filter(r => !r.disabled);
        
        let targetRadio = null;
        
        if (isPlus) {
          targetRadio = radios.find(r => r.value === '1');
        } else {
          targetRadio = radios.find(r => r.value === '2');
        }
        
        if (targetRadio) {
          targetRadio.checked = true;
          targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
          targetRadio.dispatchEvent(new Event('input', { bubbles: true }));
          targetRadio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else {
          const idx = isPlus ? 0 : 1;
          if (radios[idx]) {
            radios[idx].checked = true;
            radios[idx].dispatchEvent(new Event('change', { bubbles: true }));
            radios[idx].dispatchEvent(new Event('input', { bubbles: true }));
            radios[idx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
      }
      
      // Fill N1-N3 (idx 1-3), K (4), L-H (5-7) — for-loop is faster than forEach in V8
      fillInput(inputs[1], row.N1);
      fillInput(inputs[2], row.N2);
      fillInput(inputs[3], row.N3);
      fillInput(inputs[4], row.K);
      fillInput(inputs[5], row.L);
      fillInput(inputs[6], row.B);
      fillInput(inputs[7], row.H);

      filledCount++;
      await delay(rowDelay);
    }

    return filledCount;
  }
  
  return fillFormRows();
}

let _statusClearTimer = null;
function showStatus(msg, type, autoClearMs) {
  if (_statusClearTimer) { clearTimeout(_statusClearTimer); _statusClearTimer = null; }
  status.textContent = msg;
  status.className = type;
  status.style.display = 'block';
  if (autoClearMs) {
    _statusClearTimer = setTimeout(() => { status.style.display = 'none'; }, autoClearMs);
  }
}



// Pre-built summary row CSS (applied via className to avoid repeated inline style writes)
const SUMMARY_ROW_STYLE_VS = 'background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);color:white;font-weight:bold;position:sticky;bottom:0;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.1)';
const SUMMARY_ROW_STYLE_MB = 'background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;font-weight:bold;position:sticky;bottom:0;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.1)';

function renderPreview(data) {
  const previewHeader = document.getElementById('previewHeader');
  const dataTypeIndicator = document.getElementById('dataTypeIndicator');

  // Use DocumentFragment — single DOM mutation at the end instead of N×M
  const frag = document.createDocumentFragment();

  if (detectedDataType === 'vs') {
    previewHeader.innerHTML = '<tr><th>Item No</th><th>Proposed Qty</th><th>Description</th><th>Unit</th><th>Agmt Qty</th></tr>';
    dataTypeIndicator.textContent = '📋 Variation Statement (VS) Format Detected';
    dataTypeIndicator.style.cssText = 'display:block;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);color:white;';

    const cols = ['ItemNo', 'ProposedQty', 'Description', 'Unit', 'AgmtQty'];
    for (const row of data) {
      const tr = document.createElement('tr');
      for (const col of cols) {
        const td = document.createElement('td');
        const val = row[col] ?? '';
        if (col === 'Description' && val.length > 50) {
          td.textContent = val.substring(0, 50) + '...';
          td.title = val;
        } else {
          td.textContent = val;
        }
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }

    if (data.length > 0) {
      const summaryRow = document.createElement('tr');
      summaryRow.style.cssText = SUMMARY_ROW_STYLE_VS;
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.cssText = 'padding:8px 5px;text-align:center;font-size:12px;';
      td.innerHTML = `📋 <b>${data.length}</b> items to fill`;
      summaryRow.appendChild(td);
      frag.appendChild(summaryRow);
    }
  } else {
    previewHeader.innerHTML = '<tr><th>Particulars</th><th>N1</th><th>N2</th><th>N3</th><th>K</th><th>Sign</th><th>L</th><th>B</th><th>H</th></tr>';
    dataTypeIndicator.textContent = '📊 Measurement Book (MB) Format Detected';
    dataTypeIndicator.style.cssText = 'display:block;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;';

    const cols = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'];
    let totalQty = 0;

    for (const row of data) {
      const tr = document.createElement('tr');
      for (const col of cols) {
        const td = document.createElement('td');
        td.textContent = row[col] ?? '';
        tr.appendChild(td);
      }
      frag.appendChild(tr);

      // Quantity calculation — pure arithmetic, no DOM access
      const sign = row['Sign'] === '-' ? -1 : 1;
      totalQty += sign *
        (parseFloat(row['N1']) || 1) *
        (parseFloat(row['N2']) || 1) *
        (parseFloat(row['N3']) || 1) *
        (parseFloat(row['K'])  || 1) *
        (parseFloat(row['L'])  || 1) *
        (parseFloat(row['B'])  || 1) *
        (parseFloat(row['H'])  || 1);
    }

    if (data.length > 0) {
      const summaryRow = document.createElement('tr');
      summaryRow.style.cssText = SUMMARY_ROW_STYLE_MB;
      const td = document.createElement('td');
      td.colSpan = 9;
      td.style.cssText = 'padding:8px 5px;text-align:center;font-size:12px;white-space:nowrap;';
      td.title = 'Total Quantity = Σ (N1 × N2 × N3 × K × L × B × H × Sign)';
      td.innerHTML = `<b>${data.length}</b> rows | Qty: <b>${totalQty.toFixed(3)}</b>`;
      summaryRow.appendChild(td);
      frag.appendChild(summaryRow);
    }
  }

  // Single DOM write — replaces innerHTML clear + N individual appends
  previewBody.replaceChildren(frag);
  previewContainer.style.display = data.length ? 'block' : 'none';
}

// Download template functionality
document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const headers = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'];
  const sampleData = [
    ['Foundation excavation', '2', '1', '1', '1', '+', '10.5', '3.0', '1.5'],
    ['Backfill work', '1', '1', '1', '1', '+', '8.0', '2.5', '1.0']
  ];
  
  // Create XLSX file using SheetJS
  const wsData = [headers, ...sampleData];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  
  // Download as XLSX
  XLSX.writeFile(wb, 'irwcms_template.xlsx');
});

// ==========================================
// CLOUD DATA FETCH FEATURE
// ==========================================

const CloudData = {
  measurements: [],
  currentMeasurement: null,
  
  async fetchMeasurements() {
    const cloudStatus = document.getElementById('cloudStatus');
    const fetchBtn = document.getElementById('fetchCloudDataBtn');
    const cloudDataSection = document.getElementById('cloudDataSection');
    
    // Get user email from storage (stored as loginEmail during email login)
    const stored = await chrome.storage.local.get(['loginEmail', 'license_key']);
    const email = stored.loginEmail;
    
    if (!email) {
      cloudStatus.textContent = '⚠️ Please login first';
      cloudStatus.style.color = '#f59e0b';
      return;
    }
    
    fetchBtn.textContent = '⏳ Loading...';
    fetchBtn.disabled = true;
    cloudStatus.textContent = '';
    
    try {
      const response = await fetch(`${LICENSE_SERVER_URL}/api/measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch');
      }
      
      this.measurements = data.measurements || [];
      
      if (this.measurements.length === 0) {
        cloudStatus.textContent = 'No saved files found. Create one in Measurement Builder!';
        cloudStatus.style.color = '#888';
        cloudDataSection.style.display = 'none';
      } else {
        // Populate dropdown
        const select = document.getElementById('cloudFileSelect');
        select.innerHTML = '<option value="">Select a saved file...</option>';
        
        this.measurements.forEach((m, idx) => {
          const option = document.createElement('option');
          option.value = idx;
          const date = new Date(m.updatedAt).toLocaleDateString();
          option.textContent = `${m.name} (${date})`;
          select.appendChild(option);
        });
        
        cloudDataSection.style.display = 'block';
        fetchBtn.style.display = 'none';
        cloudStatus.textContent = `✅ Found ${this.measurements.length} file(s)`;
        cloudStatus.style.color = '#22c55e';
      }
    } catch (error) {
      console.error('Cloud fetch error:', error);
      cloudStatus.textContent = '❌ ' + (error.message || 'Failed to fetch');
      cloudStatus.style.color = '#ef4444';
    } finally {
      fetchBtn.textContent = '🔄 Fetch My Saved Files';
      fetchBtn.disabled = false;
    }
  },
  
  async loadMeasurement(measurementId) {
    const cloudStatus = document.getElementById('cloudStatus');
    
    const stored = await chrome.storage.local.get(['loginEmail']);
    const email = stored.loginEmail;
    
    if (!email || !measurementId) return;
    
    cloudStatus.textContent = '⏳ Loading file...';
    
    try {
      const response = await fetch(`${LICENSE_SERVER_URL}/api/measurements/${measurementId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load');
      }
      
      this.currentMeasurement = data.measurement;
      
      // Populate sheet selector
      // Data is stored as { sheets: [...] } object
      const sheetData = this.currentMeasurement.data;
      const sheets = sheetData?.sheets || (Array.isArray(sheetData) ? sheetData : []);
      
      if (sheets.length === 0) {
        cloudStatus.textContent = '⚠️ No sheets in this file';
        cloudStatus.style.color = '#f59e0b';
        return;
      }
      
      const sheetSelectDiv = document.getElementById('cloudSheetSelect');
      const cloudSheetSelector = document.getElementById('cloudSheetSelector');
      
      cloudSheetSelector.innerHTML = '<option value="">Select a sheet...</option>';
      sheets.forEach((sheet, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        const rowCount = sheet.rows ? sheet.rows.filter(r => r.particulars || r.l || r.b || r.h).length : 0;
        option.textContent = `${sheet.name || 'Sheet ' + (idx + 1)} (${rowCount} rows)`;
        option.setAttribute('data-type', sheet.measurementType || 'volume');
        cloudSheetSelector.appendChild(option);
      });
      
      sheetSelectDiv.style.display = 'block';
      cloudStatus.textContent = `📋 ${sheets.length} sheet(s) available`;
      cloudStatus.style.color = '#6366f1';
      
    } catch (error) {
      console.error('Load measurement error:', error);
      cloudStatus.textContent = '❌ ' + (error.message || 'Failed to load');
      cloudStatus.style.color = '#ef4444';
    }
  },
  
  loadSheet(sheetIndex) {
    if (!this.currentMeasurement || sheetIndex === '') return;
    
    const sheetData = this.currentMeasurement.data;
    const sheets = sheetData?.sheets || (Array.isArray(sheetData) ? sheetData : []);
    const sheet = sheets[parseInt(sheetIndex)];
    
    if (!sheet || !sheet.rows) {
      console.error('Invalid sheet data');
      return;
    }
    
    // Convert sheet rows to the format expected by the extension (uppercase keys)
    const rows = sheet.rows
      .filter(row => row.particulars || row.l || row.b || row.h) // Skip empty rows
      .map(row => ({
        Particulars: row.particulars || '',
        N1: row.n1 != null ? String(row.n1) : '',
        N2: row.n2 != null ? String(row.n2) : '',
        N3: row.n3 != null ? String(row.n3) : '',
        K:  row.k  != null ? String(row.k)  : '',
        Sign: row.sign || '+',
        L: row.l != null ? String(row.l) : '',
        B: row.b != null ? String(row.b) : '',
        H: row.h != null ? String(row.h) : ''
      }));
    
    if (rows.length === 0) {
      document.getElementById('cloudStatus').textContent = '⚠️ No data in this sheet';
      document.getElementById('cloudStatus').style.color = '#f59e0b';
      return;
    }
    
    // Store data in the module-level variable for fill button to use
    parsedData = rows;
    currentDataSource = 'measurement_builder'; // Data loaded from cloud/Measurement Builder
    
    // Update file name display and show clear button
    const fileNameEl = document.getElementById('fileName');
    const clearFileBtnEl = document.getElementById('clearFileBtn');
    fileNameEl.textContent = `☁️ ${this.currentMeasurement.name || 'Cloud Data'}`;
    clearFileBtnEl.style.display = 'block';
    
    // Update row count display
    const rowCountEl = document.getElementById('rowCount');
    rowCountEl.innerHTML = `<div style="padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:13px;color:#166534;font-weight:500;">☁️ Loaded ${rows.length} rows from cloud</div>`;
    
    // Set data type to MB for cloud data (measurement builder always creates MB data)
    detectedDataType = 'mb';
    
    // Show preview
    renderPreview(rows);
    previewContainer.style.display = 'block';
    
    // Show VS indicator if it's a VS type
    const measurementType = sheet.measurementType || 'volume';
    const dataTypeIndicator = document.getElementById('dataTypeIndicator');
    if (measurementType === 'area' || measurementType === 'linear') {
      dataTypeIndicator.style.display = 'block';
      dataTypeIndicator.textContent = measurementType === 'area' ? '📊 Area (L×B)' : '📏 Linear (L only)';
      dataTypeIndicator.style.background = measurementType === 'area' ? '#fef3c7' : '#dbeafe';
      dataTypeIndicator.style.color = measurementType === 'area' ? '#92400e' : '#1e40af';
    } else {
      dataTypeIndicator.style.display = 'none';
    }
    
    // Enable fill button
    const fillBtn = document.getElementById('fillBtn');
    if (fillBtn) fillBtn.disabled = false;
    
    document.getElementById('cloudStatus').textContent = `✅ Loaded "${sheet.name}" successfully!`;
    document.getElementById('cloudStatus').style.color = '#22c55e';
  },
  
  reset() {
    // Reset internal state
    this.measurements = [];
    this.currentMeasurement = null;
    
    // Reset UI elements
    const cloudDataSection = document.getElementById('cloudDataSection');
    const cloudFileSelect = document.getElementById('cloudFileSelect');
    const sheetSelectDiv = document.getElementById('cloudSheetSelect');
    const cloudSheetSelector = document.getElementById('cloudSheetSelector');
    const loadBtn = document.getElementById('loadCloudDataBtn');
    const cloudStatus = document.getElementById('cloudStatus');
    const rowCountEl = document.getElementById('rowCount');
    const fetchBtn = document.getElementById('fetchCloudDataBtn');
    
    // Hide cloud data section and show fetch button again
    cloudDataSection.style.display = 'none';
    sheetSelectDiv.style.display = 'none';
    fetchBtn.style.display = 'block';
    
    // Reset dropdowns
    cloudFileSelect.innerHTML = '<option value="">Select a saved file...</option>';
    cloudSheetSelector.innerHTML = '<option value="">Select a sheet...</option>';
    
    // Disable load button
    loadBtn.disabled = true;
    
    // Clear status
    cloudStatus.textContent = '';
    
    // Clear parsed data and preview
    parsedData = [];
    previewBody.innerHTML = '';
    previewContainer.style.display = 'none';
    rowCountEl.innerHTML = '';
    
    // Reset data type indicator
    const dataTypeIndicator = document.getElementById('dataTypeIndicator');
    dataTypeIndicator.style.display = 'none';
    
    // Disable fill button
    const fillBtn = document.getElementById('fillBtn');
    if (fillBtn) fillBtn.disabled = true;
    
    cloudStatus.textContent = '🔄 Reset complete';
    cloudStatus.style.color = '#888';
    setTimeout(() => { cloudStatus.textContent = ''; }, 2000);
  }
};

// Cloud data event listeners
document.getElementById('fetchCloudDataBtn').addEventListener('click', () => {
  CloudData.fetchMeasurements();
});

document.getElementById('cloudFileSelect').addEventListener('change', async (e) => {
  const idx = e.target.value;
  const loadBtn = document.getElementById('loadCloudDataBtn');
  const sheetSelectDiv = document.getElementById('cloudSheetSelect');
  
  if (idx === '') {
    sheetSelectDiv.style.display = 'none';
    loadBtn.disabled = true;
    return;
  }
  
  const measurement = CloudData.measurements[parseInt(idx)];
  if (measurement) {
    await CloudData.loadMeasurement(measurement.id);
  }
});

document.getElementById('cloudSheetSelector').addEventListener('change', (e) => {
  const loadBtn = document.getElementById('loadCloudDataBtn');
  loadBtn.disabled = e.target.value === '';
});

document.getElementById('loadCloudDataBtn').addEventListener('click', () => {
  const sheetIdx = document.getElementById('cloudSheetSelector').value;
  CloudData.loadSheet(sheetIdx);
});

document.getElementById('resetCloudBtn').addEventListener('click', () => {
  CloudData.reset();
});



// ==========================================
// GUIDED TOUR FEATURE
// ==========================================

const GuidedTour = {
  currentStep: 0,
  isActive: false,
  highlightedElement: null,
  
  // Tour steps configuration
  steps: [
    {
      id: 'welcome',
      target: null, // Center of screen
      emoji: '👋',
      title: 'Welcome to IRWCMS Auto-Fill!',
      description: 'Let me show you how to use this extension in just 60 seconds. This quick tour will help you get started.',
      features: [
        'Upload Excel/CSV files',
        'Preview data before filling',
        'Adjust fill speed',
        'Track your credits'
      ],
      position: 'center'
    },
    {
      id: 'license',
      target: '#licenseSection',
      emoji: '🔑',
      title: 'Step 1: Login',
      description: 'Enter your registered email or license key to activate. New user? Click "Buy License Key" to get started.',
      position: 'bottom'
    },
    {
      id: 'fileUpload',
      target: '.file-upload',
      emoji: '📁',
      title: 'Step 2: Upload File',
      description: 'Click here to upload your Excel (.xlsx) or CSV file with measurement data. Use our template for best results!',
      position: 'bottom'
    },
    {
      id: 'template',
      target: '#downloadTemplateBtn',
      emoji: '📥',
      title: 'Download Template',
      description: 'Click this button to download a ready-to-use Excel template with all required columns pre-configured.',
      position: 'top'
    },
    {
      id: 'preview',
      target: '#previewContainer',
      emoji: '👁️',
      title: 'Step 3: Preview Data',
      description: 'After uploading, your data appears here. Check the rows and total quantity before filling. The summary stays sticky at the bottom!',
      position: 'top',
      showIf: () => document.getElementById('previewContainer').style.display !== 'none'
    },
    {
      id: 'speedControl',
      target: '.speed-control',
      emoji: '⚡',
      title: 'Step 4: Adjust Speed',
      description: 'Drag the slider to set fill speed. Use "Slow" for stable connections, "Fast" for quick bulk operations.',
      position: 'top'
    },
    {
      id: 'fillButton',
      target: '#fillBtn',
      emoji: '▶️',
      title: 'Step 5: Fill Form',
      description: 'Make sure you\'re on the IRWCMS bill measurement page, then click this button to start auto-filling!',
      position: 'top'
    },
    {
      id: 'complete',
      target: null,
      emoji: '🎉',
      title: 'You\'re All Set!',
      description: 'That\'s it! You now know how to use IRWCMS Auto-Fill. Click the ❓ button anytime to restart this tour.',
      position: 'center'
    }
  ],
  
  // Initialize tour
  init() {
    const overlay = document.getElementById('tourOverlay');
    const tooltip = document.getElementById('tourTooltip');
    const startBtn = document.getElementById('tourStartBtn');
    
    if (!overlay || !tooltip || !startBtn) return;
    
    // Start button click
    startBtn.addEventListener('click', () => this.start());
    
    // Overlay click to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.end();
    });
    
    // Check if first time user
    chrome.storage.local.get(['tourCompleted', 'licenseKey'], (result) => {
      if (!result.tourCompleted && !result.licenseKey) {
        // Auto-start tour for new users after a short delay
        setTimeout(() => this.start(), 1000);
      }
    });
  },
  
  // Start tour
  start() {
    this.currentStep = 0;
    this.isActive = true;
    document.getElementById('tourOverlay').classList.add('active');
    document.getElementById('tourTooltip').style.display = 'block';
    this.showStep(0);
  },
  
  // End tour
  end() {
    this.isActive = false;
    this.removeHighlight();
    document.getElementById('tourOverlay').classList.remove('active');
    document.getElementById('tourTooltip').style.display = 'none';
    
    // Mark tour as completed
    chrome.storage.local.set({ tourCompleted: true });
  },
  
  // Show specific step
  showStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.steps.length) {
      this.end();
      return;
    }
    
    this.currentStep = stepIndex;
    const step = this.steps[stepIndex];
    
    // Skip step if condition not met
    if (step.showIf && !step.showIf()) {
      this.showStep(stepIndex + 1);
      return;
    }
    
    // Remove previous highlight
    this.removeHighlight();
    
    // Build tooltip content
    const tooltip = document.getElementById('tourTooltip');
    const totalSteps = this.steps.length;
    
    // Step indicator dots
    let dotsHtml = '<div class="tour-step-indicator">';
    for (let i = 0; i < totalSteps; i++) {
      let dotClass = 'tour-step-dot';
      if (i < stepIndex) dotClass += ' completed';
      if (i === stepIndex) dotClass += ' active';
      dotsHtml += `<div class="${dotClass}"></div>`;
    }
    dotsHtml += '</div>';
    
    // Build content
    let contentHtml = dotsHtml;
    
    if (step.id === 'welcome') {
      // Special welcome step
      contentHtml += `
        <div class="tour-welcome">
          <div class="tour-emoji">${step.emoji}</div>
          <div class="tour-welcome-title">IRWCMS Auto-Fill</div>
          <p style="font-size:13px;color:#666;margin-bottom:12px;">${step.description}</p>
          <ul class="tour-feature-list">
            ${step.features.map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>
      `;
    } else {
      contentHtml += `
        <div class="tour-emoji">${step.emoji}</div>
        <div class="tour-title">${step.title}</div>
        <div class="tour-description">${step.description}</div>
      `;
    }
    
    // Navigation buttons
    contentHtml += '<div class="tour-buttons">';
    if (stepIndex === 0) {
      contentHtml += `
        <button class="tour-btn tour-btn-skip" id="tourSkipBtn">Skip Tour</button>
        <button class="tour-btn tour-btn-next" id="tourNextBtn">Start Tour →</button>
      `;
    } else if (stepIndex === totalSteps - 1) {
      contentHtml += `
        <button class="tour-btn tour-btn-prev" id="tourPrevBtn">← Back</button>
        <button class="tour-btn tour-btn-next" id="tourFinishBtn">Finish ✓</button>
      `;
    } else {
      contentHtml += `
        <button class="tour-btn tour-btn-prev" id="tourPrevBtn">← Back</button>
        <button class="tour-btn tour-btn-next" id="tourNextBtn">Next →</button>
      `;
    }
    contentHtml += '</div>';
    
    // Progress bar
    const progress = ((stepIndex + 1) / totalSteps) * 100;
    contentHtml += `
      <div class="tour-progress">
        <div class="tour-progress-fill" style="width:${progress}%"></div>
      </div>
    `;
    
    tooltip.innerHTML = contentHtml;
    
    // Attach event listeners (CSP-compliant, no inline handlers)
    this.attachButtonListeners(stepIndex, totalSteps);
    
    // Position tooltip
    this.positionTooltip(step);
  },
  
  // Attach event listeners to tour buttons
  attachButtonListeners(stepIndex, totalSteps) {
    const skipBtn = document.getElementById('tourSkipBtn');
    const nextBtn = document.getElementById('tourNextBtn');
    const prevBtn = document.getElementById('tourPrevBtn');
    const finishBtn = document.getElementById('tourFinishBtn');
    
    if (skipBtn) {
      skipBtn.addEventListener('click', () => this.end());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.next());
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prev());
    }
    if (finishBtn) {
      finishBtn.addEventListener('click', () => this.end());
    }
  },
  
  // Position tooltip relative to target
  positionTooltip(step) {
    const tooltip = document.getElementById('tourTooltip');
    tooltip.className = 'tour-tooltip';
    
    if (step.position === 'center' || !step.target) {
      // Center on screen
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }
    
    // Find target element
    const target = document.querySelector(step.target);
    if (!target) {
      // Fallback to center if target not found
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }
    
    // Highlight target
    target.classList.add('tour-highlight');
    this.highlightedElement = target;
    
    // Scroll target into view
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Get target position
    const rect = target.getBoundingClientRect();
    // Force layout so tooltipRect.height is accurate (content was just set via innerHTML)
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    const tooltipRect = tooltip.getBoundingClientRect();
    tooltip.style.visibility = '';

    // Calculate position
    let top, left;

    if (step.position === 'bottom') {
      top = rect.bottom + 15;
      left = rect.left + (rect.width / 2) - 150;
      tooltip.classList.add('arrow-top');
    } else { // top
      top = rect.top - tooltipRect.height - 25;
      left = rect.left + (rect.width / 2) - 150;
      tooltip.classList.add('arrow-bottom');
    }
    
    // Keep tooltip in viewport
    if (left < 10) left = 10;
    if (left + 300 > window.innerWidth - 10) left = window.innerWidth - 310;
    if (top < 10) top = rect.bottom + 15; // Flip to bottom
    if (top + tooltipRect.height > window.innerHeight - 10) top = rect.top - tooltipRect.height - 15;
    
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = 'none';
  },
  
  // Remove highlight from current element
  removeHighlight() {
    if (this.highlightedElement) {
      this.highlightedElement.classList.remove('tour-highlight');
      this.highlightedElement = null;
    }
  },
  
  // Go to next step
  next() {
    this.showStep(this.currentStep + 1);
  },
  
  // Go to previous step
  prev() {
    this.showStep(this.currentStep - 1);
  }
};

// Initialize tour when DOM is ready
GuidedTour.init();
