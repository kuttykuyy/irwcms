/**
 * license.ts — License verification, login, activation, deactivation,
 *              and license-state UI (active/inactive/trial display).
 */
import { LICENSE_SERVER_URL } from './constants';
import { showStatus, updateCreditsDisplay, initSpeedControl } from './ui';
import type { ServerResponse, StoredLicense, UsageData } from './types';

// ── Device ID (memory-cached) ─────────────────────────────────

let _cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (_cachedDeviceId) return _cachedDeviceId;
  return new Promise(resolve => {
    chrome.storage.local.get(['deviceId'], result => {
      if (result['deviceId']) {
        _cachedDeviceId = result['deviceId'] as string;
        resolve(_cachedDeviceId);
      } else {
        _cachedDeviceId = 'DEV-' + (crypto.randomUUID?.() ?? (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)));
        chrome.storage.local.set({ deviceId: _cachedDeviceId });
        resolve(_cachedDeviceId);
      }
    });
  });
}

// ── API helpers ───────────────────────────────────────────────

async function post(path: string, body: Record<string, unknown>): Promise<ServerResponse> {
  try {
    const res = await fetch(`${LICENSE_SERVER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return { success: false, message: 'Server error — please try again later' };
    return res.json() as Promise<ServerResponse>;
  } catch {
    return { success: false, message: 'Network error — check your connection' };
  }
}

export async function verifyWithServer(licenseKey: string, includeSession = false): Promise<ServerResponse> {
  const deviceId = await getDeviceId();
  const body: Record<string, unknown> = { license_key: licenseKey, device_id: deviceId };
  if (includeSession) {
    const { sessionToken } = await chrome.storage.local.get(['sessionToken']) as { sessionToken?: string };
    if (sessionToken) body['session_token'] = sessionToken;
  }
  const data = await post('/api/verify', body);
  if (data.success && data.session_token) await chrome.storage.local.set({ sessionToken: data.session_token });
  if (data.session_expired) {
    await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
    showStatus('⚠️ License active on another device. Please login again.', 'error');
  }
  return data;
}

export async function loginWithEmail(email: string): Promise<ServerResponse> {
  const deviceId = await getDeviceId();
  const { sessionToken } = await chrome.storage.local.get(['sessionToken']) as { sessionToken?: string };
  const body: Record<string, unknown> = { email, device_id: deviceId };
  if (sessionToken) body['session_token'] = sessionToken;
  const data = await post('/api/verify-email/login', body);
  if (data.success && data.session_token) await chrome.storage.local.set({ sessionToken: data.session_token });
  if (data.session_expired) {
    await chrome.storage.local.remove(['sessionToken', 'licenseVerified']);
    showStatus('⚠️ License active on another device. Please login again.', 'error');
  }
  return data;
}

// ── Build usageData object from server response ───────────────

export function buildUsageData(r: ServerResponse): UsageData {
  const usageData: UsageData = {
    is_unlimited:            r.is_unlimited          ?? false,
    is_personal:             r.is_personal           ?? true,
    is_railway:              r.is_railway            ?? false,
    is_superuser:            r.is_superuser          ?? false,
    fills_this_cycle:        r.fills_this_cycle      ?? 0,
    today_fills:             r.today_fills           ?? 0,
    credit_balance:          r.credit_balance        ?? 0,
    agreement_no:            r.agreement_no          ?? null,
    used_contractors:        r.used_contractors      ?? [],
    max_contractors:         r.max_contractors       ?? 5,
    is_trial:                r.is_trial              ?? false,
    trial_active:            r.trial_active          ?? false,
    trial_days_remaining:    r.trial_days_remaining  ?? 0,
  };

  if (r.cycle_spend !== undefined) usageData.cycle_spend = r.cycle_spend;
  if (r.cycle_end !== undefined) usageData.cycle_end = r.cycle_end;
  if (r.free_fills_remaining !== undefined) usageData.free_fills_remaining = r.free_fills_remaining;

  return usageData;
}

// ── Local license state ───────────────────────────────────────

export function checkLicense(): void {
  // Read is_superuser at top level too — older extension versions stored it
  // there but NOT inside usageData, causing the superuser badge to not show.
  chrome.storage.local.get(['licenseKey', 'licenseVerified', 'licenseUses', 'usageData', 'creditBalance', 'is_superuser'], result => {
    const r = result as StoredLicense & { is_superuser?: boolean };
    if (r.licenseVerified && r.licenseKey) {
      showLicenseActive(r.licenseKey, r.licenseUses ?? 0);
      if (r.usageData) {
        // Merge top-level is_superuser into usageData in case it was stored
        // by an older extension version that didn't include it in usageData
        const merged: UsageData = {
          ...r.usageData,
          is_superuser: r.usageData.is_superuser || r.is_superuser || false,
        };
        updateCreditsDisplay(merged);
      } else if (r.creditBalance !== undefined) {
        updateCreditsDisplay(r.creditBalance);
      }
    } else {
      showLicenseInactive();
    }
  });
}

export function showLicenseActive(key: string, uses: number): void {
  const statusEl = document.getElementById('licenseStatus');
  if (statusEl) { statusEl.textContent = '✓ Activated'; statusEl.className = 'license-status license-active'; }
  document.getElementById('licenseInputArea')!.style.display  = 'none';
  document.getElementById('licenseActiveArea')!.style.display = 'block';
  document.getElementById('mainContent')?.classList.add('visible');

  chrome.storage.local.get(['loginEmail', 'licenseKey', 'is_personal', 'contractor_name', 'is_superuser', 'usageData'], result => {
    const r = result as StoredLicense & { is_superuser?: boolean };
    // Back-compat: is_superuser might only live inside usageData
    const isSuperuser = r.is_superuser ?? (r.usageData as any)?.is_superuser ?? false;
    if (!r.is_superuser && isSuperuser) chrome.storage.local.set({ is_superuser: true });

    const emailEl       = document.getElementById('userEmail');
    const typeEl        = document.getElementById('licenseType');
    const contractorEl  = document.getElementById('contractorNameDisplay') as HTMLElement | null;
    const usesEl        = document.getElementById('usesInfo');

    if (emailEl) emailEl.textContent = r.loginEmail ? `● ${r.loginEmail}` : `🔑 ${(r.licenseKey ?? key).substring(0, 12)}…`;

    const isTrial    = (r.licenseKey ?? key).startsWith('TRIAL-');
    const isPersonal = r.is_personal;
    if (typeEl) {
      typeEl.className = 'user-type';
      if (isSuperuser)        { typeEl.classList.add('type-superuser'); typeEl.textContent = '👑 SUPERUSER'; }
      else if (isTrial)       { typeEl.classList.add('type-trial');     typeEl.textContent = '🎁 TRIAL'; }
      else                    { typeEl.classList.add('type-paid');      typeEl.textContent = isPersonal ? '👤 Contractor' : '🏢 Dept'; }
    }

    if (contractorEl) {
      if (r.contractor_name) {
        contractorEl.innerHTML = `<span style="color:#6b7280;">📋</span> ${r.contractor_name}`;
        contractorEl.style.display = 'block';
      } else {
        contractorEl.style.display = 'none';
      }
    }

    if (usesEl) usesEl.style.display = 'none';

    // Superuser badge — set directly here because updateCreditsDisplay
    // may have already run before this async callback completed
    const badge = document.getElementById('superuserBadge') as HTMLElement | null;
    if (badge) badge.style.display = isSuperuser ? 'flex' : 'none';

    // Re-run updateCreditsDisplay with merged is_superuser
    if (r.usageData) {
      updateCreditsDisplay({ ...r.usageData as UsageData, is_superuser: isSuperuser });
    }
  });
}

export function showLicenseInactive(): void {
  const statusEl = document.getElementById('licenseStatus');
  if (statusEl) { statusEl.textContent = '⚠ Not Activated'; statusEl.className = 'license-status license-inactive'; }
  document.getElementById('licenseInputArea')!.style.display  = 'block';
  document.getElementById('licenseActiveArea')!.style.display = 'none';
  document.getElementById('mainContent')?.classList.remove('visible');
  const usesEl = document.getElementById('usesInfo');
  if (usesEl) usesEl.style.display = 'none';
}

// ── Button event listeners ────────────────────────────────────

export function initLicenseButtons(): void {

  // Email login
  document.getElementById('activateBtn')?.addEventListener('click', async () => {
    const emailInput = document.getElementById('emailInput') as HTMLInputElement;
    const btn        = document.getElementById('activateBtn') as HTMLButtonElement;
    const email = emailInput.value.trim();
    if (!email) { alert('Please enter your email'); return; }
    btn.disabled = true; btn.textContent = 'Logging in…';

    const result = await loginWithEmail(email);
    if (result.success) {
      const usageData = buildUsageData(result);
      await chrome.storage.local.set({
        licenseKey: result.license_key, licenseVerified: true, licenseUses: result.activations_used,
        is_personal: result.is_personal, is_railway: result.is_railway ?? false,
        is_superuser: result.is_superuser ?? false, contractor_name: result.contractor_name ?? null,
        usageData, loginEmail: email,
      });
      showLicenseActive(result.license_key!, result.activations_used ?? 0);
      updateCreditsDisplay(usageData);
      initSpeedControl(result.is_personal);
    } else {
      alert(result.message ?? 'No license found for this email');
    }
    btn.disabled = false; btn.textContent = 'Login with Email';
  });

  // License key activation
  document.getElementById('activateKeyBtn')?.addEventListener('click', async () => {
    const keyInput = document.getElementById('licenseKeyInput') as HTMLInputElement;
    const btn      = document.getElementById('activateKeyBtn') as HTMLButtonElement;
    const key = keyInput.value.trim();
    if (!key) { alert('Please enter a license key'); return; }
    btn.disabled = true; btn.textContent = 'Verifying…';

    const result = await verifyWithServer(key);
    if (result.success) {
      const usageData = buildUsageData(result);
      await chrome.storage.local.set({
        licenseKey: key, licenseVerified: true, licenseUses: result.activations_used,
        is_personal: result.is_personal, is_railway: result.is_railway ?? false,
        is_superuser: result.is_superuser ?? false, contractor_name: result.contractor_name ?? null,
        usageData,
      });
      showLicenseActive(key, result.activations_used ?? 0);
      updateCreditsDisplay(usageData);
      initSpeedControl(result.is_personal);
    } else {
      alert(result.message ?? 'Invalid license key');
    }
    btn.disabled = false; btn.textContent = 'Activate with Key';
  });

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = '…';
    try {
      document.getElementById('irwcmsDebug')?.remove();
      const { scanIRWCMSPage } = await import('./ui');
      scanIRWCMSPage();

      const stored = await chrome.storage.local.get(['licenseKey']) as { licenseKey?: string };
      if (stored.licenseKey) {
        const result = await verifyWithServer(stored.licenseKey, true);
        if (result.success) {
          const usageData = buildUsageData(result);
          await chrome.storage.local.set({
            usageData, is_personal: result.is_personal,
            is_railway: result.is_railway ?? false, is_superuser: result.is_superuser ?? false,
            contractor_name: result.contractor_name ?? null,
          });
          updateCreditsDisplay(usageData);
          initSpeedControl(result.is_personal);
          const contractorEl = document.getElementById('contractorNameDisplay') as HTMLElement | null;
          if (contractorEl) {
            if (result.contractor_name) {
              contractorEl.innerHTML = `<div style="background:#1e293b;padding:8px 12px;border-radius:8px;margin-top:8px;">
                <span style="color:#94a3b8;font-size:10px;">Name of Contractor (as per LOA):</span>
                <div style="color:#22c55e;font-weight:600;font-size:12px;margin-top:2px;">${result.contractor_name}</div>
              </div>`;
              contractorEl.style.display = 'block';
            } else {
              contractorEl.style.display = 'none';
            }
          }
        }
      }
    } catch (err) { console.error('Refresh error:', err); }
    btn.disabled = false; btn.textContent = '🔄 Refresh';
  });

  // Deactivate / logout
  document.getElementById('deactivateBtn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to deactivate your license? This will free up the device slot.')) return;
    const btn = document.getElementById('deactivateBtn') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Deactivating…';
    try {
      const stored = await chrome.storage.local.get(['licenseKey']) as { licenseKey?: string };
      if (stored.licenseKey) {
        const deviceId = await getDeviceId();
        try {
          const res = await fetch(`${LICENSE_SERVER_URL}/api/deactivate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: stored.licenseKey, device_id: deviceId }),
          });
          if (!res.ok) console.warn('Server deactivation failed — clearing local state anyway');
        } catch (err) { console.warn('Deactivation network error:', err); }
      }
    } catch (err) { console.error('Deactivation error:', err); }
    chrome.storage.local.remove(
      ['licenseKey', 'licenseVerified', 'licenseUses', 'creditBalance', 'loginEmail', 'sessionToken'],
      () => {
        showLicenseInactive();
        (document.getElementById('emailInput') as HTMLInputElement).value = '';
        (document.getElementById('licenseKeyInput') as HTMLInputElement).value = '';
        btn.disabled = false; btn.textContent = 'Deactivate License';
      }
    );
  });
}
