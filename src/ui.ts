/**
 * ui.ts — Shared UI utilities: status bar, tabs, speed slider,
 *          append-mode buttons, credits display, update banner,
 *          language selector, guided tour, scanIRWCMSPage.
 */
import { LICENSE_SERVER_URL, CURRENT_VERSION, SPEED_SETTINGS, DEFAULT_SPEED, DEPARTMENT_FIXED_DELAY_MS, isIrwcmsUrl } from './constants';
import type { SpeedLevel, UsageData, PageInfo } from './types';

// ── Status bar ─────────────────────────────────────────────────

let _statusClearTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(msg: string, type: 'success' | 'error' | 'info', autoClearMs?: number): void {
  const el = document.getElementById('status');
  if (!el) return;
  if (_statusClearTimer) { clearTimeout(_statusClearTimer); _statusClearTimer = null; }
  el.textContent  = msg;
  el.className    = type;
  el.style.display = 'block';
  if (autoClearMs) {
    _statusClearTimer = setTimeout(() => { el.style.display = 'none'; }, autoClearMs);
  }
}

// ── Tab switching ──────────────────────────────────────────────

export function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset['tab'];
      if (!tabId) return;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll<HTMLElement>('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${tabId}`)?.classList.add('active');
    });
  });
}

// ── Speed control ──────────────────────────────────────────────

export let currentFillDelay = SPEED_SETTINGS[DEFAULT_SPEED].delay;

export function initSpeedControl(isPersonal: boolean | undefined): void {
  const speedControlDiv = document.querySelector<HTMLElement>('.speed-control');
  if (!speedControlDiv) return;

  if (isPersonal === false) {
    speedControlDiv.innerHTML = `
      <div class="speed-label">
        <span data-i18n="fillSpeed">Fill Speed:</span>
        <span class="speed-value" style="color:#94a3b8;">Fixed (Standard)</span>
      </div>
      <div style="padding:8px 0;color:#64748b;font-size:12px;">
        ⚡ Department account uses optimized standard speed
      </div>`;
    currentFillDelay = DEPARTMENT_FIXED_DELAY_MS;
    return;
  }

  chrome.storage.local.get(['fillSpeed'], result => {
    let savedSpeed: SpeedLevel = (result['fillSpeed'] as SpeedLevel) ?? DEFAULT_SPEED;
    if (!SPEED_SETTINGS[savedSpeed]) savedSpeed = DEFAULT_SPEED;

    const slider = document.getElementById('speedSlider') as HTMLInputElement | null;
    const valueLabel = document.getElementById('speedValue');
    if (!slider || !valueLabel) return;

    slider.value = String(savedSpeed);
    updateSpeedLabel(savedSpeed, valueLabel);
    currentFillDelay = SPEED_SETTINGS[savedSpeed].delay;

    slider.addEventListener('input', () => {
      let speed = parseInt(slider.value, 10) as SpeedLevel;
      if (!SPEED_SETTINGS[speed]) speed = DEFAULT_SPEED;
      updateSpeedLabel(speed, valueLabel);
      currentFillDelay = SPEED_SETTINGS[speed].delay;
      chrome.storage.local.set({ fillSpeed: speed });
    });
  });
}

function updateSpeedLabel(speed: SpeedLevel, el: HTMLElement): void {
  const key = SPEED_SETTINGS[speed]?.labelKey ?? 'medium';
  // t() comes from translations.js loaded globally
  el.textContent = typeof (window as any)['t'] === 'function' ? (window as any)['t'](key) : key;
}

// ── Append / Replace mode ─────────────────────────────────────

export let selectedAppendMode = false;
export let existingRowsCount  = 0;

export function setAppendMode(value: boolean): void { selectedAppendMode = value; }
export function setExistingRowsCount(value: number): void { existingRowsCount = value; }

export function initAppendModeHandlers(): void {
  document.getElementById('appendModeBtn')?.addEventListener('click', () => {
    selectedAppendMode = true;
    updateAppendModeUI();
  });
  document.getElementById('replaceModeBtn')?.addEventListener('click', () => {
    selectedAppendMode = false;
    updateAppendModeUI();
  });
}

export function updateAppendModeUI(parsedRowCount?: number): void {
  const appendBtn  = document.getElementById('appendModeBtn')  as HTMLButtonElement | null;
  const replaceBtn = document.getElementById('replaceModeBtn') as HTMLButtonElement | null;
  if (!appendBtn || !replaceBtn) return;

  const hint = document.getElementById('fillModeHint');

  if (selectedAppendMode) {
    appendBtn.style.background  = '#22c55e';
    appendBtn.style.boxShadow   = '0 0 10px rgba(34,197,94,0.5)';
    replaceBtn.style.background = '#9ca3af';
    replaceBtn.style.boxShadow  = 'none';
    if (hint) hint.innerHTML = `<strong style="color:#22c55e;">➕ APPEND:</strong> Your ${parsedRowCount ?? 0} rows will be added after row ${existingRowsCount}`;
  } else {
    replaceBtn.style.background = '#f59e0b';
    replaceBtn.style.boxShadow  = '0 0 10px rgba(245,158,11,0.5)';
    appendBtn.style.background  = '#9ca3af';
    appendBtn.style.boxShadow   = 'none';
    if (hint) hint.innerHTML = `<strong style="color:#f59e0b;">🔄 REPLACE:</strong> Will fill starting from row 1`;
  }
}

export async function checkExistingRows(tabId: number, isPersonalAccount: boolean): Promise<number> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const tbody = document.querySelector('#datatabody, #datatable tbody, table.datatable tbody, .measurement-table tbody');
      if (tbody) {
        let count = 0;
        for (const row of tbody.querySelectorAll('tr')) {
          for (const inp of row.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')) {
            if (inp.value?.trim()) { count++; break; }
          }
        }
        return count;
      }
      for (const table of document.querySelectorAll('table')) {
        const tb = table.querySelector('tbody');
        if (tb) {
          const rows = tb.querySelectorAll('tr');
          if (rows[0]?.querySelector('input[name="disc"], input[placeholder*="Particulars" i]')) {
            return rows.length;
          }
        }
      }
      return 0;
    },
  });

  const count = Math.max(...(results ?? []).map(r => (r?.result as number) || 0), 0);
  existingRowsCount = count;

  const section = document.getElementById('appendModeSection');
  const countEl = document.getElementById('existingRowCount');
  const afterEl = document.getElementById('appendAfterRow');

  if (section && count > 0 && isPersonalAccount) {
    section.style.display = 'block';
    if (countEl) countEl.textContent = String(count);
    if (afterEl) afterEl.textContent = String(count);
    selectedAppendMode = true;
    updateAppendModeUI();
  } else if (section) {
    section.style.display = 'none';
    selectedAppendMode = false;
  }

  return count;
}

// ── Credits display ────────────────────────────────────────────

let _creditsPanelReady = false;

function ensureCreditsPanelDOM(quotaEl: HTMLElement): void {
  if (_creditsPanelReady) return;
  quotaEl.innerHTML = `
    <div id="cp-wrap" style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:8px;font-size:13px;border:1px solid #e2e8f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="color:#334155;font-weight:600;">Plan:</span>
        <span style="font-weight:bold;color:#16a34a;">♾️ Unlimited Fills</span>
      </div>
      <div style="display:flex;justify-content:space-between;color:#475569;">
        <span>📅 Today: <strong id="cp-today">0</strong></span>
        <span>📊 Total: <strong id="cp-total">0</strong></span>
      </div>
      <div id="cp-trial"></div>
    </div>`;
  _creditsPanelReady = true;
}

export function updateCreditsDisplay(data: UsageData | number): void {
  const quotaEl = document.getElementById('quotaDisplay');
  if (!quotaEl) return;
  quotaEl.style.display = 'block';

  // Legacy numeric format
  if (typeof data === 'number') {
    _creditsPanelReady = false;
    quotaEl.innerHTML = data === -1
      ? '<span style="color:#11998e;">∞ <strong>UNLIMITED</strong></span>'
      : `<span style="color:#11998e;">💰 Credits: <strong>${data.toLocaleString()}</strong></span>`;
    return;
  }

  const { is_superuser, is_unlimited, fills_this_cycle, today_fills,
          is_trial, trial_active, trial_days_remaining } = data;

  if (is_superuser) {
    const badge = document.getElementById('superuserBadge');
    if (badge) {
      badge.style.display = 'flex';
      const todayEl = document.getElementById('todayFills');
      const totalEl = document.getElementById('totalFills');
      if (todayEl) todayEl.textContent = (today_fills || 0).toLocaleString();
      if (totalEl) totalEl.textContent = (fills_this_cycle || 0).toLocaleString();
    }
    quotaEl.style.display = 'none';
    const buyBtn = document.getElementById('buyCreditsFixed') as HTMLElement | null;
    if (buyBtn) buyBtn.style.display = 'none';
    return;
  }
  const suBadge = document.getElementById('superuserBadge') as HTMLElement | null;
  if (suBadge) suBadge.style.display = 'none';

  ensureCreditsPanelDOM(quotaEl);

  const cpToday = document.getElementById('cp-today');
  const cpTotal = document.getElementById('cp-total');
  if (cpToday) cpToday.textContent = (today_fills || 0).toLocaleString();
  if (cpTotal) cpTotal.textContent = (fills_this_cycle || 0).toLocaleString();

  const trialEl = document.getElementById('cp-trial');
  if (trialEl) {
    if (is_trial && trial_active) {
      const d = trial_days_remaining ?? 0;
      const uc = d <= 2 ? '#dc2626' : d <= 4 ? '#d97706' : '#16a34a';
      trialEl.innerHTML = `<div style="margin-top:6px;padding:6px 8px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;text-align:center;">
        <span style="color:${uc};font-weight:600;font-size:11px;">⏰ Trial: ${d} day${d !== 1 ? 's' : ''} remaining</span>
        <div style="color:#92400e;font-size:9px;margin-top:2px;">💳 <a href="https://irwcms.primerp.in/buy" style="color:#2563eb;text-decoration:underline;">Upgrade to paid plan</a></div>
      </div>`;
    } else if (is_trial && !trial_active) {
      trialEl.innerHTML = `<div style="margin-top:6px;padding:6px 8px;background:#fee2e2;border:1px solid #fecaca;border-radius:6px;text-align:center;">
        <span style="color:#dc2626;font-weight:600;font-size:11px;">❌ Trial expired</span>
        <div style="color:#991b1b;font-size:9px;margin-top:2px;">💳 <a href="https://irwcms.primerp.in/buy" style="color:#2563eb;text-decoration:underline;">Buy license to continue</a></div>
      </div>`;
    } else {
      trialEl.textContent = '';
    }
  }

  const buyBtn = document.getElementById('buyCreditsFixed') as HTMLElement | null;
  if (buyBtn) buyBtn.style.display = is_unlimited ? 'none' : 'block';
}

// ── Version / update banner ────────────────────────────────────

export function initUpdateBanner(): void {
  document.getElementById('updateClose')?.addEventListener('click', () => {
    document.getElementById('updateBanner')?.classList.remove('show');
    chrome.storage.local.set({ updateDismissed: true, updateDismissedAt: Date.now() });
  });
}

export async function checkForUpdates(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(['updateDismissed', 'updateDismissedAt']);
    if (stored['updateDismissed'] && stored['updateDismissedAt']) {
      const hoursAgo = (Date.now() - (stored['updateDismissedAt'] as number)) / 3_600_000;
      if (hoursAgo < 24) return;
    }
    const res  = await fetch(`${LICENSE_SERVER_URL}/api/version`);
    if (!res.ok) return;
    const data = await res.json() as { latest_version?: string; download_url?: string };

    const badge = document.getElementById('versionBadge');
    if (badge) badge.textContent = `v${CURRENT_VERSION}`;

    if (data.latest_version && compareVersions(CURRENT_VERSION, data.latest_version) < 0) {
      const banner  = document.getElementById('updateBanner');
      const message = document.getElementById('updateMessage');
      const link    = document.getElementById('updateLink') as HTMLAnchorElement | null;
      if (banner && message) {
        message.textContent = `Update available: v${data.latest_version}`;
        if (link && data.download_url) link.href = LICENSE_SERVER_URL + data.download_url;
        banner.classList.add('show');
      }
    }
  } catch { /* network failures are silent */ }
}

export function compareVersions(v1: string, v2: string): number {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Language selector ─────────────────────────────────────────

export function initLanguageSelector(): void {
  const langBtn      = document.getElementById('currentLangBtn');
  const langDropdown = document.getElementById('langDropdown');
  const options      = document.querySelectorAll<HTMLElement>('.lang-option');

  langBtn?.addEventListener('click', e => {
    e.stopPropagation();
    langDropdown?.classList.toggle('show');
  });
  document.addEventListener('click', () => langDropdown?.classList.remove('show'));

  options.forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const lang = opt.getAttribute('data-lang');
      if (!lang) return;
      (window as any)['setLanguage']?.(lang);
      langDropdown?.classList.remove('show');
      options.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  });

  chrome.storage.local.get(['language'], result => {
    const saved = (result['language'] as string) ?? 'en';
    options.forEach(o => { if (o.getAttribute('data-lang') === saved) o.classList.add('active'); });
  });
}

export function loadSavedLanguage(): void {
  chrome.storage.local.get(['language'], result => {
    const lang = (result['language'] as string) ?? 'en';
    if ((window as any)['TRANSLATIONS']?.[lang]) {
      (window as any)['currentLang'] = lang;
      (window as any)['updateAllTexts']?.();
    }
  });
}

// ── Page scan (detect logged-in IRWCMS user info) ─────────────

export async function scanIRWCMSPage(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isIrwcmsUrl(tab.url)) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractPageInfo,
    });

    const merged = (results ?? [])
      .map(r => r?.result as PageInfo | undefined)
      .filter((v): v is PageInfo => !!v && Object.keys(v).length > 0)
      .reduce<PageInfo>((best, cur) => {
        const score = (o: object) => Object.values(o).filter(Boolean).length;
        return score(cur) > score(best) ? cur : best;
      }, {});

    if (!Object.keys(merged).length) return;

    if (merged.railwayOfficialName) {
      chrome.storage.local.set({
        railway_official_name:        merged.railwayOfficialName,
        railway_official_designation: merged.railwayOfficialDesignation ?? '',
      });
    }

    chrome.storage.local.get(['contractor_name'], stored => {
      renderPageInfoBadge(merged, (stored['contractor_name'] as string) ?? '');
    });
  } catch { /* silent — page may not be IRWCMS */ }
}

/** Serialized and injected into the page — must be self-contained */
function extractPageInfo(): PageInfo {
  const info: PageInfo = {};
  const allText = document.body?.innerText || '';
  const pageTextLower = allText.toLowerCase();

  // Railway official name
  const nameMatch = allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]+?)\s*\(([^)]+)\)/i)
    ?? allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]{2,30})(?:\s*\||$|\s{2,})/i);
  if (nameMatch) {
    info.railwayOfficialName       = nameMatch[1]!.trim().replace(/\s+/g, ' ');
    info.railwayOfficialDesignation = nameMatch[2]?.trim() ?? '';
    info.userText = info.railwayOfficialDesignation
      ? `${info.railwayOfficialName} (${info.railwayOfficialDesignation})`
      : info.railwayOfficialName;
  }

  // Email
  const emailMatch = allText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) info.irwcmsEmail = emailMatch[1]!.toLowerCase();

  // Agreement number
  const agmtMatch = allText.match(/Agreement\s*(?:Number|No\.?)\s*[:\s]*([A-Za-z0-9\/\-]+)/i);
  if (agmtMatch) info.agreementNo = agmtMatch[1]!.trim();

  // Contractor name
  const contractorMatch = allText.match(
    /Name of Contractor[:\s]*([A-Z0-9\s\-&.,()]+?)(?:\s{2,}|Agreement Number|Situation|Date of|Name of Work)/i
  );
  if (contractorMatch) info.contractorName = contractorMatch[1]!.trim();

  // Measurement number
  for (const inp of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])'))) {
    if (inp.value?.trim().match(/^\d{10,}\/[A-Z]+\/[A-Z]+\/[A-Z]+/i)) {
      info.measurementNo = inp.value.trim(); break;
    }
  }

  info.pageTitle = document.title;
  return info;
}

function renderPageInfoBadge(info: PageInfo, storedContractor: string): void {
  const existing = document.getElementById('irwcmsDebug');
  if (existing) existing.remove();
  if (!info.contractorName && !info.agreementNo && !info.irwcmsEmail && !info.userText && !info.railwayOfficialName) return;

  const debugDiv = Object.assign(document.createElement('div'), { id: 'irwcmsDebug' });
  debugDiv.style.cssText = 'background:#1e293b;color:#e2e8f0;padding:10px 12px;margin:8px 16px;border-radius:8px;font-size:12px;';

  let html = '<div style="font-weight:600;color:#a78bfa;margin-bottom:6px;">📋 Detected from IRWCMS</div>';

  if (info.railwayOfficialName) {
    const des = info.railwayOfficialDesignation ? ` (${info.railwayOfficialDesignation})` : '';
    html += `<div style="margin-bottom:4px;"><span style="color:#94a3b8;font-size:11px;">🚂 Railway Official:</span>
      <div style="color:#06b6d4;font-weight:600;margin-top:2px;">${info.railwayOfficialName}${des}</div></div>`;
  }

  if (info.contractorName) {
    const pageUpper  = info.contractorName.toUpperCase().trim();
    const storedUpper = storedContractor.toUpperCase().trim();
    const matched = storedUpper && (storedUpper === pageUpper || pageUpper.includes(storedUpper) || storedUpper.includes(pageUpper));
    const badge = matched ? '<span style="background:#22c55e;color:white;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:6px;">✓ Matched</span>' : '';

    // Use a placeholder then set textContent to avoid XSS
    const safeId = `cnText_${Date.now()}`;
    html += `<div style="margin-bottom:4px;"><span style="color:#94a3b8;font-size:11px;">Name of Contractor (as per LOA):</span>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
        <span id="${safeId}" style="color:#22c55e;font-weight:600;"></span>${badge}
      </div></div>`;
    setTimeout(() => { const el = document.getElementById(safeId); if (el) el.textContent = info.contractorName!; }, 0);
  }

  if (info.agreementNo) {
    html += `<div style="margin-bottom:4px;"><span style="color:#94a3b8;">Agreement No:</span>
      <div style="color:#38bdf8;font-weight:500;font-size:11px;word-break:break-all;margin-top:2px;">${info.agreementNo}</div></div>`;
  }

  if (info.irwcmsEmail) {
    html += `<div style="margin-bottom:4px;"><span style="color:#94a3b8;">Email:</span>
      <span style="color:#fbbf24;word-break:break-all;"> ${info.irwcmsEmail}</span></div>`;
  }

  debugDiv.innerHTML = html;
  document.querySelector('.container')?.appendChild(debugDiv);
}

// ── Unlimited countdown timer ─────────────────────────────────

let _countdownInterval: ReturnType<typeof setInterval> | null = null;

export function startUnlimitedCountdown(elementId: string, expiryTimestamp: string | null): void {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  if (!expiryTimestamp) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = '⏱️ 3 days';
    return;
  }
  const expiry = new Date(expiryTimestamp).getTime();
  const tick = () => {
    const el = document.getElementById(elementId);
    if (!el) { clearInterval(_countdownInterval!); _countdownInterval = null; return; }
    const diff = expiry - Date.now();
    if (diff <= 0) {
      el.textContent = '⏱️ Expired';
      el.style.background = 'rgba(239,68,68,0.3)';
      clearInterval(_countdownInterval!); _countdownInterval = null; return;
    }
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor((diff % 86_400_000) / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1_000);
    el.textContent = `⏱️ ${d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`}`;
  };
  tick();
  _countdownInterval = setInterval(tick, 1_000);
}

export function stopCountdown(): void {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
}

// ── Guided Tour ───────────────────────────────────────────────

interface TourStep {
  id: string; target: string | null; emoji: string;
  title: string; description: string; features?: string[];
  position: 'center' | 'bottom' | 'top';
  showIf?: () => boolean;
}

const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', target: null, emoji: '👋', position: 'center',
    title: 'Welcome to IRWCMS Auto-Fill!',
    description: 'Let me show you how to use this extension in just 60 seconds.',
    features: ['Upload Excel/CSV files', 'Preview data before filling', 'Adjust fill speed', 'Track your credits'] },
  { id: 'license',    target: '#licenseSection',   emoji: '🔑', position: 'bottom',  title: 'Step 1: Login',          description: 'Enter your registered email or license key to activate.' },
  { id: 'fileUpload', target: '.file-upload',       emoji: '📁', position: 'bottom',  title: 'Step 2: Upload File',    description: 'Upload your Excel (.xlsx) or CSV file with measurement data.' },
  { id: 'template',   target: '#downloadTemplateBtn', emoji: '📥', position: 'top',  title: 'Download Template',      description: 'Download a ready-to-use Excel template.' },
  { id: 'preview',    target: '#previewContainer',  emoji: '👁️', position: 'top',   title: 'Step 3: Preview Data',   description: 'Check your rows before filling.',
    showIf: () => document.getElementById('previewContainer')?.style.display !== 'none' },
  { id: 'speed',      target: '.speed-control',     emoji: '⚡', position: 'top',    title: 'Step 4: Adjust Speed',   description: 'Drag the slider to control fill speed.' },
  { id: 'fill',       target: '#fillBtn',            emoji: '▶️', position: 'top',   title: 'Step 5: Fill Form',      description: 'Open the IRWCMS form page then click Fill Form.' },
  { id: 'done',       target: null, emoji: '🎉', position: 'center',
    title: "You're All Set!", description: "That's it! Click ❓ anytime to restart this tour." },
];

export const GuidedTour = {
  currentStep: 0,
  isActive: false,
  highlighted: null as HTMLElement | null,

  init() {
    document.getElementById('tourStartBtn')?.addEventListener('click', () => this.start());
    document.getElementById('tourOverlay')?.addEventListener('click', (e: Event) => {
      if (e.target === document.getElementById('tourOverlay')) this.end();
    });
    chrome.storage.local.get(['tourCompleted', 'licenseKey'], r => {
      if (!r['tourCompleted'] && !r['licenseKey']) setTimeout(() => this.start(), 1000);
    });
  },

  start() {
    this.currentStep = 0; this.isActive = true;
    document.getElementById('tourOverlay')?.classList.add('active');
    const tt = document.getElementById('tourTooltip');
    if (tt) tt.style.display = 'block';
    this.showStep(0);
  },

  end() {
    this.isActive = false; this.removeHighlight();
    document.getElementById('tourOverlay')?.classList.remove('active');
    const tt = document.getElementById('tourTooltip');
    if (tt) tt.style.display = 'none';
    chrome.storage.local.set({ tourCompleted: true });
  },

  showStep(idx: number) {
    if (idx < 0 || idx >= TOUR_STEPS.length) { this.end(); return; }
    this.currentStep = idx;
    const step = TOUR_STEPS[idx]!;
    if (step.showIf && !step.showIf()) { this.showStep(idx + 1); return; }
    this.removeHighlight();

    const tooltip = document.getElementById('tourTooltip');
    if (!tooltip) return;

    const dots = TOUR_STEPS.map((_, i) =>
      `<div class="tour-step-dot${i < idx ? ' completed' : i === idx ? ' active' : ''}"></div>`
    ).join('');

    let body = '';
    if (step.id === 'welcome') {
      body = `<div class="tour-welcome"><div class="tour-emoji">${step.emoji}</div>
        <div class="tour-welcome-title">IRWCMS Auto-Fill</div>
        <p style="font-size:13px;color:#666;margin-bottom:12px;">${step.description}</p>
        <ul class="tour-feature-list">${(step.features ?? []).map(f => `<li>${f}</li>`).join('')}</ul></div>`;
    } else {
      body = `<div class="tour-emoji">${step.emoji}</div>
        <div class="tour-title">${step.title}</div>
        <div class="tour-description">${step.description}</div>`;
    }

    const isFirst = idx === 0;
    const isLast  = idx === TOUR_STEPS.length - 1;
    const btns = isFirst
      ? `<button class="tour-btn tour-btn-skip" id="tSkip">Skip Tour</button><button class="tour-btn tour-btn-next" id="tNext">Start Tour →</button>`
      : isLast
      ? `<button class="tour-btn tour-btn-prev" id="tPrev">← Back</button><button class="tour-btn tour-btn-next" id="tFinish">Finish ✓</button>`
      : `<button class="tour-btn tour-btn-prev" id="tPrev">← Back</button><button class="tour-btn tour-btn-next" id="tNext">Next →</button>`;

    const progress = ((idx + 1) / TOUR_STEPS.length) * 100;
    tooltip.innerHTML = `<div class="tour-step-indicator">${dots}</div>${body}
      <div class="tour-buttons">${btns}</div>
      <div class="tour-progress"><div class="tour-progress-fill" style="width:${progress}%"></div></div>`;

    document.getElementById('tSkip')?.addEventListener('click',   () => this.end());
    document.getElementById('tNext')?.addEventListener('click',   () => this.showStep(idx + 1));
    document.getElementById('tPrev')?.addEventListener('click',   () => this.showStep(idx - 1));
    document.getElementById('tFinish')?.addEventListener('click', () => this.end());

    this.positionTooltip(step, tooltip);
  },

  positionTooltip(step: TourStep, tooltip: HTMLElement) {
    tooltip.className = 'tour-tooltip';
    if (!step.target || step.position === 'center') {
      Object.assign(tooltip.style, { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' });
      return;
    }
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) { Object.assign(tooltip.style, { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }); return; }
    target.classList.add('tour-highlight');
    this.highlighted = target;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    tooltip.style.visibility = 'hidden'; tooltip.style.display = 'block';
    const tRect = tooltip.getBoundingClientRect();
    tooltip.style.visibility = '';
    const rect = target.getBoundingClientRect();

    let top: number, left = rect.left + rect.width / 2 - 150;
    if (step.position === 'bottom') {
      top = rect.bottom + 15; tooltip.classList.add('arrow-top');
    } else {
      top = rect.top - tRect.height - 25; tooltip.classList.add('arrow-bottom');
    }
    if (left < 10) left = 10;
    if (left + 300 > window.innerWidth - 10) left = window.innerWidth - 310;
    if (top < 10) top = rect.bottom + 15;
    if (top + tRect.height > window.innerHeight - 10) top = rect.top - tRect.height - 15;
    Object.assign(tooltip.style, { top: `${top}px`, left: `${left}px`, transform: 'none' });
  },

  removeHighlight() {
    this.highlighted?.classList.remove('tour-highlight');
    this.highlighted = null;
  },
};
