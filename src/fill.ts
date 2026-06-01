/**
 * fill.ts — Fill button orchestration.
 *
 * All page interaction happens via chrome.tabs.sendMessage to content.ts.
 * No more executeScript for fill/detect — content.ts owns those functions.
 * executeScript is retained only for: checking existing row count (needs
 * allFrames result aggregation which sendMessage doesn't support per-frame).
 */
import { LICENSE_SERVER_URL, isIrwcmsUrl } from './constants';
import { showStatus, selectedAppendMode, currentFillDelay, checkExistingRows } from './ui';
import { buildUsageData, getDeviceId } from './license';
import { updateCreditsDisplay } from './ui';
import {
  parsedData, detectedDataType, currentDataSource, currentSheetIndex,
  currentWorkbook, filledSheets, refreshSheetButton,
} from './preview';
import type { MBRow, VSRow, FillResult, FormTypeResult, PageInfo, ContentMessage } from './types';

let fillStopped = false;

// ── Send a typed message to the content script ────────────────

async function sendToContent<T>(tabId: number, msg: ContentMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg);
}

// ── Fill button handler ───────────────────────────────────────

export function initFillButton(): void {
  const fillBtn = document.getElementById('fillBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopFillBtn') as HTMLButtonElement;

  fillBtn.addEventListener('click', () => runFill(fillBtn, stopBtn));

  stopBtn.addEventListener('click', async () => {
    fillStopped = true;
    showStatus('⏹ Stopping…', 'info');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await sendToContent(tab.id, { action: 'stopFill' });
  });
}

async function runFill(fillBtn: HTMLButtonElement, stopBtn: HTMLButtonElement): Promise<void> {
  if (!parsedData.length) { showStatus('No data to fill', 'error'); return; }

  if (currentSheetIndex >= 0 && filledSheets.has(currentSheetIndex)) {
    const name = currentWorkbook?.SheetNames?.[currentSheetIndex] ?? 'this sheet';
    if (!confirm(`⚠️ "${name}" was already filled.\n\nFill it again?`)) return;
  }

  showStatus('Checking quota…', 'info');

  // Storage + tab query in parallel
  const [stored, [tab]] = await Promise.all([
    chrome.storage.local.get(['licenseKey', 'deviceId']) as Promise<{ licenseKey?: string; deviceId?: string }>,
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  if (!stored.licenseKey || !stored.deviceId) { showStatus('License not activated', 'error'); return; }
  if (!tab?.id) { showStatus('No active tab found', 'error'); return; }

  // Guard: must be on IRWCMS page for the content script to be available
  if (!isIrwcmsUrl(tab.url)) {
    showStatus(
      '⚠️ Please switch to the IRWCMS tab (ircep.gov.in) before filling.',
      'error'
    );
    return;
  }

  // ── 1. Extract page info via content bridge ──────────────────
  let pageInfo: PageInfo = {};
  let detectionError: string | undefined;
  try {
    if (isIrwcmsUrl(tab.url)) {
      pageInfo = (await sendToContent<{ pageInfo: PageInfo }>(tab.id, { action: 'detectPageInfo' })).pageInfo ?? {};
    }
  } catch (e: any) { detectionError = e.message; }

  // ── 2. Track fill on server ──────────────────────────────────
  try {
    const sessionData = await chrome.storage.local.get([
      'sessionToken', 'railway_official_name', 'railway_official_designation',
    ]) as { sessionToken?: string; railway_official_name?: string; railway_official_designation?: string };

    const fillRes = await fetch(`${LICENSE_SERVER_URL}/api/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key:                  stored.licenseKey,
        device_id:                    stored.deviceId,
        session_token:                sessionData.sessionToken,
        rows_filled:                  parsedData.length,
        agreement_no:                 pageInfo.agreementNo,
        measurement_no:               pageInfo.measurementNo,
        irwcms_email:                 pageInfo.irwcmsEmail,
        contractor_name:              pageInfo.contractorName,
        railway_official_name:        sessionData.railway_official_name ?? null,
        railway_official_designation: sessionData.railway_official_designation ?? null,
        fill_source:                  currentDataSource,
      }),
    });

    const resText = await fillRes.text();
    let fillResult: any;
    try { fillResult = JSON.parse(resText); }
    catch { fillResult = { success: true }; }

    if (fillResult.session_expired) {
      await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
      showStatus('⚠️ License active on another device. Please login again.', 'error');
      return;
    }
    if (!fillResult.success) {
      showFillError(fillResult, pageInfo, detectionError);
      return;
    }

    if (fillResult.email_verified && fillResult.verified_email) {
      showStatus(`✅ IRWCMS Email Verified: ${fillResult.verified_email}`, 'success');
      await delay(1500);
    }
    if (fillResult.auto_captured_name) {
      showStatus(`✅ Contractor name "${fillResult.auto_captured_name}" locked!`, 'success');
      await delay(2000);
    }

    const usageData = buildUsageData(fillResult);
    updateCreditsDisplay(usageData);
    const storageUpdate: Record<string, unknown> = {
      usageData, is_personal: fillResult.is_personal,
      is_railway: fillResult.is_railway ?? false,
      is_superuser: fillResult.is_superuser ?? false,
    };
    const contractorToStore = fillResult.auto_captured_name ?? fillResult.verified_contractor;
    if (contractorToStore) storageUpdate['contractor_name'] = contractorToStore;
    chrome.storage.local.set(storageUpdate);
  } catch (err) {
    console.warn('Fill tracking failed (offline?):', err);
  }

  // ── 3. Detect form type via content bridge ───────────────────
  fillStopped = false;
  fillBtn.disabled = true; fillBtn.textContent = 'Filling…';
  stopBtn.style.display = 'block';
  showStatus('Detecting form type…', 'info');

  const fillStartTime = Date.now();

  try {
    const { formTypeResult } = await sendToContent<{ formTypeResult: FormTypeResult }>(
      tab.id, { action: 'detectFormType' }
    );
    const detectedFormType = formTypeResult.formType;

    // Mismatch guard
    if (detectedDataType === 'vs' && detectedFormType === 'measurement') {
      showStatus('⚠️ VS Excel on MB form. Open a Variation Statement page.', 'error', 5000); return;
    }
    if (detectedDataType === 'mb' && detectedFormType === 'variation') {
      showStatus('⚠️ MB Excel on VS form. Open a Measurement Book page.', 'error', 5000); return;
    }

    const effectiveType = detectedFormType !== 'none' ? detectedFormType : (detectedDataType === 'vs' ? 'variation' : 'measurement');

    // ── 4. Execute fill via content bridge ───────────────────────
    let result: FillResult;

    if (effectiveType === 'variation') {
      showStatus('📋 Variation form detected. Filling…', 'info');
      result = await sendToContent<FillResult>(tab.id, {
        action: 'fillVariation',
        data:   parsedData as VSRow[],
      });
    } else {
      showStatus(`Filling form${selectedAppendMode ? ' (Append mode)' : ''}…`, 'info');
      result = await sendToContent<FillResult>(tab.id, {
        action:     'fillForm',
        data:       parsedData as MBRow[],
        delayMs:    currentFillDelay,
        appendMode: selectedAppendMode,
      });
    }

    const duration = ((Date.now() - fillStartTime) / 1000).toFixed(1);
    markSheetFilled(result, effectiveType, duration);
  } catch (err: any) {
    const msg: string = err?.message ?? '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      showStatus(
        '⚠️ Cannot reach the IRWCMS page. Please refresh the IRWCMS tab (press F5) and try again.',
        'error'
      );
    } else if (msg.includes('No tab with id')) {
      showStatus('⚠️ The IRWCMS tab was closed. Please reopen it and try again.', 'error');
    } else {
      showStatus('❌ ' + msg, 'error');
    }
  } finally {
    fillBtn.disabled = false; fillBtn.textContent = 'Fill Form';
    stopBtn.style.display = 'none';
  }
}

// ── Helpers ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function markSheetFilled(result: FillResult, type: string, duration: string): void {
  if (result.stopped) {
    showStatus(`⏹ Stopped after ${result.filled} rows`, 'info'); return;
  }
  if (type === 'variation') {
    showStatus(
      result.filled > 0
        ? `✅ Filled ${result.filled} items in ${duration}s${result.notFound.length ? ` (${result.notFound.length} not found)` : ''}`
        : '⚠️ No matching Item Numbers found.',
      result.filled > 0 ? 'success' : 'error', result.filled === 0 ? 5000 : undefined,
    );
  } else {
    showStatus(`✅ Filled ${result.filled} rows in ${duration}s`, 'success');
  }

  if (currentSheetIndex >= 0 && result.filled > 0 && currentWorkbook) {
    filledSheets.add(currentSheetIndex);
    const btnContainer = document.getElementById('sheetButtons');
    if (btnContainer) {
      btnContainer.querySelectorAll<HTMLButtonElement>('button').forEach(btn => {
        const idx = parseInt(btn.dataset['index']!);
        refreshSheetButton(btn, currentWorkbook.SheetNames[idx]!, idx, idx === currentSheetIndex);
      });
    }
    document.getElementById('rowCount')!.textContent =
      `Sheet "${currentWorkbook.SheetNames[currentSheetIndex]}" — ${result.filled} rows ✅ Filled`;
  }
}

function showFillError(r: any, pageInfo: PageInfo, detectionError?: string): void {
  if (r.contractor_name_duplicate) {
    showStatus(`🚫 ${r.message}\n\n📧 Contact: ${r.support_email ?? 'support@illall.in'}`, 'error');
  } else if (r.trial_restriction) {
    showStatus(`⏰ ${r.message}\n\n👉 Use Measurement Builder for trial access.\n\n💳 Upgrade to unlock Excel fills.`, 'error');
    (document.getElementById('buyCreditsFixed') as HTMLElement).style.display = 'block';
  } else if (r.message?.includes('Personal license requires IRWCMS login')) {
    showStatus(`❌ ${r.message}\n\n⚠️ Email not detected. Ensure you are logged into IRWCMS.`, 'error');
  } else if (r.message?.includes('Contractor license requires verification')) {
    showStatus(`❌ ${r.message}\n\n⚠️ Open a page where "Name of Contractor" is visible.`, 'error');
  } else if (r.message?.includes('License is registered to')) {
    showStatus(`❌ ${r.message}\n\n⚠️ License registered for a different contractor.`, 'error');
  } else {
    showStatus(`❌ ${r.message ?? 'Fill blocked by server'}`, 'error');
  }
  if (r.need_onboarding) showStatus('❌ Please complete onboarding at irwcms.primerp.in', 'error');
  if (r.message?.includes('Insufficient credits')) {
    (document.getElementById('buyCreditsFixed') as HTMLElement).style.display = 'block';
  }
}
