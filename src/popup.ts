/**
 * popup.ts — Entry point. Wires all modules together on DOMContentLoaded.
 */
import { initLanguageSelector, loadSavedLanguage, initTabs, initSpeedControl,
         initAppendModeHandlers, initUpdateBanner, checkForUpdates,
         scanIRWCMSPage, GuidedTour, stopCountdown } from './ui';
import { checkLicense, initLicenseButtons } from './license';
import { initFileInput, initTemplateDownload, initPreviewExpand, selectSheet } from './preview';
import { initCloud } from './cloud';
import { initFillButton } from './fill';
import { checkExistingRows } from './ui';
import { isIrwcmsUrl } from './constants';

function initRefreshIconBridge(): void {
  const quota = document.getElementById('quotaDisplay');
  const refreshIconBtn = document.getElementById('refreshIconBtn') as HTMLButtonElement | null;
  const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement | null;

  if (!refreshIconBtn || !refreshBtn) return;

  refreshIconBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    refreshBtn.click();
  });

  if (!quota) return;

  const syncVisibility = () => {
    refreshIconBtn.style.display = quota.style.display === 'none' ? 'none' : 'block';
  };

  syncVisibility();
  new MutationObserver(syncVisibility).observe(quota, {
    attributes: true,
    attributeFilter: ['style'],
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Language must be first so all text renders correctly
  initLanguageSelector();
  loadSavedLanguage();

  // Core license state
  checkLicense();
  initLicenseButtons();

  // UI chrome
  initTabs();
  initUpdateBanner();
  initAppendModeHandlers();
  GuidedTour.init();

  // Speed control needs account type — read from storage
  chrome.storage.local.get(['is_personal'], result => {
    initSpeedControl(result['is_personal'] as boolean | undefined);
  });

  // File / cloud / fill
  initFileInput(async () => {
    // Called after each sheet load — refresh existing-row count
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isIrwcmsUrl(tab.url)) return;
    const stored = await chrome.storage.local.get(['is_personal']) as { is_personal?: boolean };
    await checkExistingRows(tab.id, stored.is_personal !== false);
  });
  initTemplateDownload();
  initPreviewExpand();
  initCloud();
  initFillButton();
  initRefreshIconBridge();

  // Background tasks (non-blocking)
  checkForUpdates();
  scanIRWCMSPage();
});

// Clean up countdown timer when panel is hidden (avoids memory leak)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCountdown();
});
