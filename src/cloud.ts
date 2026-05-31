/**
 * cloud.ts — Cloud Measurement Builder integration.
 *            Fetches saved measurements, lets user pick a sheet,
 *            loads it into parsedData for the fill button.
 */
import { LICENSE_SERVER_URL } from './constants';
import { showStatus, selectedAppendMode } from './ui';
import {
  parsedData, setParsedData, setCurrentDataSource, setDetectedDataType,
  renderPreview, filledSheets,
} from './preview';
import type { MBRow } from './types';

interface CloudMeasurement {
  id: string;
  name: string;
  updatedAt: string;
  data?: CloudData;
}

interface CloudSheet {
  name?: string;
  measurementType?: 'volume' | 'area' | 'linear';
  rows?: CloudRow[];
}

interface CloudRow {
  particulars?: string;
  n1?: string | number;
  n2?: string | number;
  n3?: string | number;
  k?:  string | number;
  l?:  string | number;
  b?:  string | number;
  h?:  string | number;
  sign?: string;
}

interface CloudData {
  sheets?: CloudSheet[];
}

// ── Module state ──────────────────────────────────────────────

let measurements:         CloudMeasurement[] = [];
let currentMeasurement:   CloudMeasurement | null = null;

// ── Init ──────────────────────────────────────────────────────

export function initCloud(): void {
  document.getElementById('fetchCloudDataBtn')?.addEventListener('click',  fetchMeasurements);
  document.getElementById('cloudFileSelect')?.addEventListener('change',   onFileSelectChange);
  document.getElementById('cloudSheetSelector')?.addEventListener('change', onSheetSelectorChange);
  document.getElementById('loadCloudDataBtn')?.addEventListener('click',   loadSelectedSheet);
  document.getElementById('resetCloudBtn')?.addEventListener('click',      reset);
}

// ── Fetch list of saved measurements ─────────────────────────

async function fetchMeasurements(): Promise<void> {
  const cloudStatus  = document.getElementById('cloudStatus') as HTMLElement;
  const fetchBtn     = document.getElementById('fetchCloudDataBtn') as HTMLButtonElement;
  const cloudSection = document.getElementById('cloudDataSection') as HTMLElement;

  const { loginEmail } = await chrome.storage.local.get(['loginEmail']) as { loginEmail?: string };
  if (!loginEmail) {
    cloudStatus.textContent = '⚠️ Please login first';
    cloudStatus.style.color = '#f59e0b';
    return;
  }

  fetchBtn.textContent = '⏳ Loading…';
  fetchBtn.disabled    = true;
  cloudStatus.textContent = '';

  try {
    // POST email in body — not as a GET param (privacy)
    const res  = await fetch(`${LICENSE_SERVER_URL}/api/measurements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    const data = await res.json() as { measurements?: CloudMeasurement[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch');

    measurements = data.measurements ?? [];
    if (!measurements.length) {
      cloudStatus.textContent = 'No saved files found. Create one in Measurement Builder!';
      cloudStatus.style.color = '#888';
      cloudSection.style.display = 'none';
      return;
    }

    const select = document.getElementById('cloudFileSelect') as HTMLSelectElement;
    select.innerHTML = '<option value="">Select a saved file…</option>';
    measurements.forEach((m, idx) => {
      const opt   = document.createElement('option');
      opt.value   = String(idx);
      opt.textContent = `${m.name} (${new Date(m.updatedAt).toLocaleDateString()})`;
      select.appendChild(opt);
    });
    cloudSection.style.display = 'block';
    fetchBtn.style.display     = 'none';
    cloudStatus.textContent    = `✅ Found ${measurements.length} file(s)`;
    cloudStatus.style.color    = '#22c55e';
  } catch (err: any) {
    cloudStatus.textContent = '❌ ' + (err.message ?? 'Failed to fetch');
    cloudStatus.style.color = '#ef4444';
  } finally {
    fetchBtn.textContent = '🔄 Fetch Saved Files';
    fetchBtn.disabled    = false;
  }
}

// ── Load one measurement's sheets ────────────────────────────

async function loadMeasurement(measurementId: string): Promise<void> {
  const cloudStatus = document.getElementById('cloudStatus') as HTMLElement;
  const { loginEmail } = await chrome.storage.local.get(['loginEmail']) as { loginEmail?: string };
  if (!loginEmail || !measurementId) return;

  cloudStatus.textContent = '⏳ Loading file…';
  try {
    const res  = await fetch(`${LICENSE_SERVER_URL}/api/measurements/${measurementId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    const data = await res.json() as { measurement?: CloudMeasurement; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Failed to load');

    currentMeasurement = data.measurement ?? null;
    const sheets = getSheets(currentMeasurement);

    if (!sheets.length) {
      cloudStatus.textContent = '⚠️ No sheets in this file';
      cloudStatus.style.color = '#f59e0b';
      return;
    }

    const sheetSelector  = document.getElementById('cloudSheetSelector') as HTMLSelectElement;
    const sheetSelectDiv = document.getElementById('cloudSheetSelect')   as HTMLElement;
    sheetSelector.innerHTML = '<option value="">Select a sheet…</option>';
    sheets.forEach((sheet, idx) => {
      const count = (sheet.rows ?? []).filter(r => r.particulars || r.l || r.b || r.h).length;
      const opt   = document.createElement('option');
      opt.value   = String(idx);
      opt.textContent = `${sheet.name ?? `Sheet ${idx + 1}`} (${count} rows)`;
      opt.setAttribute('data-type', sheet.measurementType ?? 'volume');
      sheetSelector.appendChild(opt);
    });
    sheetSelectDiv.style.display = 'block';
    cloudStatus.textContent = `📋 ${sheets.length} sheet(s) available`;
    cloudStatus.style.color = '#6366f1';
  } catch (err: any) {
    cloudStatus.textContent = '❌ ' + (err.message ?? 'Failed to load');
    cloudStatus.style.color = '#ef4444';
  }
}

// ── Load a sheet into parsedData ──────────────────────────────

function loadSheet(sheetIndex: string | number): void {
  if (!currentMeasurement || sheetIndex === '') return;
  const sheets = getSheets(currentMeasurement);
  const sheet  = sheets[Number(sheetIndex)];
  if (!sheet?.rows) { console.error('Invalid sheet data'); return; }

  const rows: MBRow[] = sheet.rows
    .filter(r => r.particulars || r.l || r.b || r.h)
    .map(r => ({
      Particulars: r.particulars ?? '',
      N1:  r.n1  != null ? String(r.n1)  : '',
      N2:  r.n2  != null ? String(r.n2)  : '',
      N3:  r.n3  != null ? String(r.n3)  : '',
      K:   r.k   != null ? String(r.k)   : '',
      Sign: r.sign ?? '+',
      L:   r.l   != null ? String(r.l)   : '',
      B:   r.b   != null ? String(r.b)   : '',
      H:   r.h   != null ? String(r.h)   : '',
    }));

  if (!rows.length) {
    const s = document.getElementById('cloudStatus') as HTMLElement;
    s.textContent = '⚠️ No data in this sheet'; s.style.color = '#f59e0b'; return;
  }

  setParsedData(rows);
  setCurrentDataSource('measurement_builder');
  setDetectedDataType('mb');

  document.getElementById('fileName')!.textContent = `☁️ ${currentMeasurement.name ?? 'Cloud Data'}`;
  document.getElementById('clearFileBtn')!.style.display = 'block';
  document.getElementById('rowCount')!.innerHTML =
    `<div style="padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:13px;color:#166534;font-weight:500;">
      ☁️ Loaded ${rows.length} rows from cloud</div>`;

  renderPreview(rows);
  document.getElementById('previewContainer')!.style.display = 'block';

  // Data type indicator for non-volume types
  const measurementType = sheet.measurementType ?? 'volume';
  const indicatorEl = document.getElementById('dataTypeIndicator') as HTMLElement;
  if (measurementType !== 'volume') {
    indicatorEl.style.display = 'block';
    indicatorEl.textContent   = measurementType === 'area' ? '📊 Area (L×B)' : '📏 Linear (L only)';
    indicatorEl.style.background = measurementType === 'area' ? '#fef3c7' : '#dbeafe';
    indicatorEl.style.color      = measurementType === 'area' ? '#92400e' : '#1e40af';
  } else {
    indicatorEl.style.display = 'none';
  }

  (document.getElementById('fillBtn') as HTMLButtonElement).disabled = false;
  const s = document.getElementById('cloudStatus') as HTMLElement;
  s.textContent = `✅ Loaded "${sheet.name}" successfully!`;
  s.style.color = '#22c55e';
}

// ── Reset ─────────────────────────────────────────────────────

function reset(): void {
  measurements = []; currentMeasurement = null;

  const cloudSection    = document.getElementById('cloudDataSection')   as HTMLElement;
  const cloudFileSelect = document.getElementById('cloudFileSelect')    as HTMLSelectElement;
  const sheetSelectDiv  = document.getElementById('cloudSheetSelect')   as HTMLElement;
  const sheetSelector   = document.getElementById('cloudSheetSelector') as HTMLSelectElement;
  const loadBtn         = document.getElementById('loadCloudDataBtn')   as HTMLButtonElement;
  const fetchBtn        = document.getElementById('fetchCloudDataBtn')  as HTMLElement;
  const cloudStatus     = document.getElementById('cloudStatus')        as HTMLElement;
  const fillBtnEl       = document.getElementById('fillBtn')            as HTMLButtonElement;

  cloudSection.style.display = 'none';
  sheetSelectDiv.style.display = 'none';
  fetchBtn.style.display = 'block';
  cloudFileSelect.innerHTML = '<option value="">Select a saved file…</option>';
  sheetSelector.innerHTML   = '<option value="">Select a sheet…</option>';
  loadBtn.disabled = true;
  cloudStatus.textContent = '';

  setParsedData([]);
  document.getElementById('previewBody')!.innerHTML = '';
  document.getElementById('previewContainer')!.style.display = 'none';
  document.getElementById('rowCount')!.innerHTML = '';
  document.getElementById('dataTypeIndicator')!.style.display = 'none';
  fillBtnEl.disabled = true;

  setTimeout(() => { cloudStatus.textContent = ''; }, 2000);
}

// ── Event handlers ────────────────────────────────────────────

async function onFileSelectChange(e: Event): Promise<void> {
  const idx       = (e.target as HTMLSelectElement).value;
  const loadBtn   = document.getElementById('loadCloudDataBtn')  as HTMLButtonElement;
  const sheetDiv  = document.getElementById('cloudSheetSelect')  as HTMLElement;
  if (!idx) { sheetDiv.style.display = 'none'; loadBtn.disabled = true; return; }
  const m = measurements[parseInt(idx)];
  if (m) await loadMeasurement(m.id);
}

function onSheetSelectorChange(e: Event): void {
  const loadBtn = document.getElementById('loadCloudDataBtn') as HTMLButtonElement;
  loadBtn.disabled = (e.target as HTMLSelectElement).value === '';
}

function loadSelectedSheet(): void {
  const idx = (document.getElementById('cloudSheetSelector') as HTMLSelectElement).value;
  loadSheet(idx);
}

// ── Helpers ───────────────────────────────────────────────────

function getSheets(m: CloudMeasurement | null): CloudSheet[] {
  if (!m?.data) return [];
  const d = m.data as CloudData;
  return d.sheets ?? (Array.isArray(d) ? d as CloudSheet[] : []);
}
