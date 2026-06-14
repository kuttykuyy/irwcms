/**
 * preview.ts — Excel/CSV parsing, data normalization, preview table rendering,
 *              template download, sheet selector.
 */
import type { MBRow, VSRow, ParsedRow, DataType } from './types';
import { showStatus } from './ui';

// Global XLSX is loaded via <script src="xlsx.full.min.js"> in popup.html
declare const XLSX: any;

// ── Public state ──────────────────────────────────────────────

export let parsedData:       ParsedRow[]  = [];
export let currentWorkbook:  any          = null;
export let currentFileName:  string       = '';
export let currentSheetIndex = -1;
export let filledSheets      = new Set<number>();
export let detectedDataType: DataType     = 'mb';
export let currentDataSource: 'excel' | 'measurement_builder' = 'excel';

export function setParsedData(data: ParsedRow[]): void { parsedData = data; }
export function setCurrentDataSource(src: typeof currentDataSource): void { currentDataSource = src; }
export function setDetectedDataType(t: DataType): void { detectedDataType = t; }

// ── DOM references ────────────────────────────────────────────

const fileInput         = () => document.getElementById('fileInput')        as HTMLInputElement;
const fileNameEl        = () => document.getElementById('fileName')         as HTMLElement;
const fillBtnEl         = () => document.getElementById('fillBtn')          as HTMLButtonElement;
const rowCountEl        = () => document.getElementById('rowCount')         as HTMLElement;
const previewContainer  = () => document.getElementById('previewContainer') as HTMLElement;
const previewBody       = () => document.getElementById('previewBody')      as HTMLElement;
const clearFileBtnEl    = () => document.getElementById('clearFileBtn')     as HTMLButtonElement;

// ── File input wiring ─────────────────────────────────────────

export function initFileInput(onSheetLoaded: () => void): void {
  fileInput()?.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    parsedData = []; currentWorkbook = null; currentSheetIndex = 0; filledSheets.clear();
    document.getElementById('sheetSelector')?.remove();
    currentFileName = file.name;
    fileNameEl().textContent = file.name;
    clearFileBtnEl().style.display = 'block';
    showStatus('Parsing file…', 'info');

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      currentWorkbook = XLSX.read(data, { type: 'array' });
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      if (currentWorkbook.SheetNames.length > 1) {
        showSheetSelector(currentWorkbook.SheetNames, onSheetLoaded);
      } else {
        if (isCSV) showStatus('ℹ️ CSV files support only 1 sheet. Use .xlsx for multi-sheet.', 'info');
        selectSheet(0, onSheetLoaded);
      }
    } catch (err: any) {
      showStatus('Error parsing file: ' + err.message, 'error');
      fillBtnEl().disabled = true;
    }
    fileInput().value = '';
  });

  clearFileBtnEl()?.addEventListener('click', () => {
    parsedData = []; currentWorkbook = null; currentSheetIndex = 0;
    currentFileName = ''; currentDataSource = 'excel'; filledSheets.clear();
    fileNameEl().textContent = 'No file selected';
    clearFileBtnEl().style.display = 'none';
    rowCountEl().textContent = '';
    previewBody().innerHTML = '';
    previewContainer().style.display = 'none';
    fillBtnEl().disabled = true;
    document.getElementById('sheetSelector')?.remove();
    showStatus('File cleared', 'info');
  });
}

// ── Sheet selector ────────────────────────────────────────────

function showSheetSelector(sheetNames: string[], onSheetLoaded: () => void): void {
  document.getElementById('sheetSelector')?.remove();
  const container = document.createElement('div');
  container.id = 'sheetSelector';
  container.style.cssText = 'margin:10px 0;padding:10px;background:#e8f5e9;border:2px solid #4CAF50;border-radius:8px;';
  container.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;color:#2e7d32;">📋 Select Sheet (${sheetNames.length} found)</div>
    <div id="sheetButtons" style="display:flex;flex-direction:column;gap:5px;max-height:150px;overflow-y:auto;"></div>`;

  const anchor = document.querySelector('.file-label, .upload-btn')?.closest('.tab-content, .upload-area, div') ?? fileInput().parentElement;
  anchor?.after(container);

  const btnContainer = container.querySelector('#sheetButtons')!;
  sheetNames.forEach((name, idx) => {
    const btn = document.createElement('button');
    btn.dataset['index'] = String(idx);
    refreshSheetButton(btn, name, idx);
    btn.onclick = () => {
      btnContainer.querySelectorAll('button').forEach(b => refreshSheetButton(b as HTMLButtonElement, sheetNames[parseInt(b.dataset['index']!)]!, parseInt(b.dataset['index']!)));
      refreshSheetButton(btn, name, idx, true);
      selectSheet(idx, onSheetLoaded);
    };
    btnContainer.appendChild(btn);
  });
}

export function refreshSheetButton(btn: HTMLButtonElement, name: string, idx: number, isSelected = false): void {
  const isFilled = filledSheets.has(idx);
  btn.textContent = isFilled ? `✅ ${idx + 1}. ${name}` : `${idx + 1}. ${name}`;
  const bg = isSelected ? '#a5d6a7' : isFilled ? '#e0e0e0' : '#fff';
  btn.style.cssText = `padding:8px 12px;background:${bg};border:1px solid ${isFilled ? '#888' : '#4CAF50'};border-radius:4px;cursor:pointer;text-align:left;font-size:13px;${isFilled ? 'color:#666;' : ''}`;
  btn.onmouseover = () => { if (!isSelected) btn.style.background = isFilled ? '#d0d0d0' : '#c8e6c9'; };
  btn.onmouseout  = () => { if (!isSelected) btn.style.background = isFilled ? '#e0e0e0' : '#fff'; };
}

export function selectSheet(index: number, onSheetLoaded: () => void): void {
  if (!currentWorkbook) return;
  currentSheetIndex = index;
  const sheet = currentWorkbook.Sheets[currentWorkbook.SheetNames[index]];
  const json  = XLSX.utils.sheet_to_json(sheet);
  parsedData  = normalizeData(json);
  currentDataSource = 'excel';
  const filledTag = filledSheets.has(index) ? ' ⚠️ (Already Filled)' : '';
  rowCountEl().textContent = `Sheet "${currentWorkbook.SheetNames[index]}" — ${parsedData.length} rows${filledTag}`;
  renderPreview(parsedData);
  fillBtnEl().disabled = false;
  showStatus(`Loaded sheet: ${currentWorkbook.SheetNames[index]}`, 'success');
  onSheetLoaded();
}

// ── Normalization ─────────────────────────────────────────────

export function normalizeData(jsonData: Record<string, unknown>[]): ParsedRow[] {
  if (!jsonData.length) return [];
  const sampleRows = jsonData.filter(r => Object.keys(r).length > 0).slice(0, 5);
  const keySet = new Set<string>();
  sampleRows.forEach(r => Object.keys(r).forEach(k => keySet.add(k.toLowerCase().trim())));
  const keys = Array.from(keySet);

  const hasItemNo     = keys.some(k => k.includes('item') && (k.includes('no') || k.includes('#')));
  const hasProposedQty = keys.some(k => k.includes('proposed') && k.includes('qty'));
  const hasMBFields   = keys.some(k => k.includes('particular') || k === 'n1' || k === 'l' || k === 'b' || k === 'h');

  if (hasItemNo && hasProposedQty && !hasMBFields) {
    detectedDataType = 'vs';
    return normalizeVSData(jsonData);
  }
  detectedDataType = 'mb';
  return normalizeMBData(jsonData);
}

export function normalizeMBData(jsonData: Record<string, unknown>[]): MBRow[] {
  if (!jsonData.length) return [];
  const safeNum = (v: unknown): string => { const n = parseFloat(String(v)); return isFinite(n) ? String(v) : ''; };

  // Build key→field map once from first row keys (O(K), not O(N×K))
  const keyMap: Record<string, string> = {};
  for (const key of Object.keys(jsonData[0]!)) {
    const lk = key.toLowerCase().trim();
    if      (lk.includes('particular'))             keyMap[key] = 'Particulars';
    else if (lk === 'n1')                            keyMap[key] = 'N1';
    else if (lk === 'n2')                            keyMap[key] = 'N2';
    else if (lk === 'n3')                            keyMap[key] = 'N3';
    else if (lk === 'k' || lk.includes('coefficient')) keyMap[key] = 'K';
    else if (lk === 'l' || lk === 'length')          keyMap[key] = 'L';
    else if (lk === 'b' || lk === 'breadth')         keyMap[key] = 'B';
    else if (lk === 'h' || lk === 'height')          keyMap[key] = 'H';
    else if (lk === 'sign' || lk === '+/-')          keyMap[key] = 'Sign';
  }
  const mappedKeys = Object.keys(keyMap);

  return jsonData
    .map(row => {
      const norm: MBRow = {};
      for (const key of mappedKeys) {
        const field = keyMap[key]!;
        const val   = row[key];
        if      (field === 'Particulars')                         norm.Particulars = String(val ?? '');
        else if (field === 'N1' || field === 'N2' || field === 'N3' || field === 'K') (norm as any)[field] = safeNum(val);
        else if (field === 'L' || field === 'B' || field === 'H') (norm as any)[field] = formatDecimal(val);
        else if (field === 'Sign')                                norm.Sign = String(val ?? '');
      }
      return norm;
    })
    .filter(row => row.Particulars || row.N1 || row.L || row.B || row.H);
}

export function normalizeVSData(jsonData: Record<string, unknown>[]): VSRow[] {
  return jsonData
    .map(row => {
      const norm: Partial<VSRow> = {};
      for (const key in row) {
        const lk = key.toLowerCase().trim();
        if      (lk.includes('item') && (lk.includes('no') || lk.includes('#'))) norm.ItemNo      = String(row[key] ?? '').trim();
        else if (lk.includes('proposed') && lk.includes('qty'))                  norm.ProposedQty  = String(row[key] ?? '').trim();
        else if (lk.includes('description') || lk.includes('desc'))              norm.Description  = String(row[key] ?? '').trim();
        else if (lk === 'unit')                                                   norm.Unit         = String(row[key] ?? '').trim();
        else if (lk.includes('agmt') && lk.includes('qty'))                     norm.AgmtQty      = String(row[key] ?? '').trim();
      }
      return norm as VSRow;
    })
    .filter(row => row.ItemNo && row.ProposedQty);
}

export function formatDecimal(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(String(value));
  if (isNaN(num)) return String(value);
  // toFixed(10) avoids scientific notation (e.g. 1e-5 → "0.0000100000")
  // Strip trailing zeros: keep up to the last non-zero decimal digit
  const fixed = num.toFixed(10).replace(/(\.\d*[1-9])0+$|\.0+$/, '$1');
  const dotIdx = fixed.indexOf('.');
  if (dotIdx !== -1 && fixed.length - dotIdx - 1 > 4) return num.toFixed(4);
  return fixed;
}

// ── Preview table ─────────────────────────────────────────────

const SUMMARY_STYLE_VS = 'background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);color:white;font-weight:bold;position:sticky;bottom:0;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.1)';
const SUMMARY_STYLE_MB = 'background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;font-weight:bold;position:sticky;bottom:0;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.1)';

export function renderPreview(data: ParsedRow[]): void {
  const headerEl    = document.getElementById('previewHeader')    as HTMLElement;
  const bodyEl      = document.getElementById('previewBody')      as HTMLElement;
  const indicatorEl = document.getElementById('dataTypeIndicator') as HTMLElement;
  const containerEl = document.getElementById('previewContainer') as HTMLElement;
  if (!headerEl || !bodyEl) return;

  const frag = document.createDocumentFragment();

  if (detectedDataType === 'vs') {
    headerEl.innerHTML = '<tr><th>Item No</th><th>Proposed Qty</th><th>Description</th><th>Unit</th><th>Agmt Qty</th></tr>';
    indicatorEl.textContent = '📋 Variation Statement (VS) Format Detected';
    indicatorEl.style.cssText = 'display:block;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);color:white;padding:4px 8px;margin-bottom:6px;border-radius:4px;font-size:10px;font-weight:600;text-align:center;';

    const cols = ['ItemNo', 'ProposedQty', 'Description', 'Unit', 'AgmtQty'] as (keyof VSRow)[];
    for (const row of data as VSRow[]) {
      const tr = document.createElement('tr');
      for (const col of cols) {
        const td  = document.createElement('td');
        const val = row[col] ?? '';
        if (col === 'Description' && val.length > 50) {
          td.textContent = val.substring(0, 50) + '…'; td.title = val;
        } else { td.textContent = val; }
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    if (data.length) {
      const summary = document.createElement('tr');
      summary.style.cssText = SUMMARY_STYLE_VS;
      const td = document.createElement('td');
      td.colSpan = 5; td.style.cssText = 'padding:8px 5px;text-align:center;font-size:12px;';
      td.innerHTML = `📋 <b>${data.length}</b> items to fill`;
      summary.appendChild(td); frag.appendChild(summary);
    }
  } else {
    headerEl.innerHTML = '<tr><th>Particulars</th><th>N1</th><th>N2</th><th>N3</th><th>K</th><th>Sign</th><th>L</th><th>B</th><th>H</th></tr>';
    indicatorEl.textContent = '📊 Measurement Book (MB) Format Detected';
    indicatorEl.style.cssText = 'display:block;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;padding:4px 8px;margin-bottom:6px;border-radius:4px;font-size:10px;font-weight:600;text-align:center;';

    const cols = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'] as (keyof MBRow)[];
    let totalQty = 0;

    for (const row of data as MBRow[]) {
      const tr = document.createElement('tr');
      for (const col of cols) { const td = document.createElement('td'); td.textContent = row[col] ?? ''; tr.appendChild(td); }
      frag.appendChild(tr);
      const sign = row.Sign === '-' ? -1 : 1;
      totalQty += sign *
        (parseFloat(row.N1 ?? '') || 1) * (parseFloat(row.N2 ?? '') || 1) * (parseFloat(row.N3 ?? '') || 1) *
        (parseFloat(row.K  ?? '') || 1) * (parseFloat(row.L  ?? '') || 1) *
        (parseFloat(row.B  ?? '') || 1) * (parseFloat(row.H  ?? '') || 1);
    }
    if (data.length) {
      const summary = document.createElement('tr');
      summary.style.cssText = SUMMARY_STYLE_MB;
      const td = document.createElement('td');
      td.colSpan = 9; td.style.cssText = 'padding:8px 5px;text-align:center;font-size:12px;white-space:nowrap;';
      td.title = 'Total Quantity = Σ (N1 × N2 × N3 × K × L × B × H × Sign)';
      td.innerHTML = `<b>${data.length}</b> rows | Qty: <b>${totalQty.toFixed(3)}</b>`;
      summary.appendChild(td); frag.appendChild(summary);
    }
  }

  bodyEl.replaceChildren(frag);
  containerEl.style.display = data.length ? 'block' : 'none';
}

// ── Template download ─────────────────────────────────────────

export function initTemplateDownload(): void {
  document.getElementById('downloadTemplateBtn')?.addEventListener('click', () => {
    const headers = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'];
    const sample  = [
      ['Foundation excavation', '2', '1', '1', '1', '+', '10.5', '3.0', '1.5'],
      ['Backfill work',         '1', '1', '1', '1', '+',  '8.0', '2.5', '1.0'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'irwcms_template.xlsx');
  });
}

export function initPreviewExpand(): void {
  const container = document.getElementById('previewContainer');
  const closeBtn = document.getElementById('previewCloseBtn');
  if (!container) return;

  const close = () => {
    container.classList.remove('preview-expanded');
    document.body.classList.remove('preview-expanded-active');
  };

  container.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('#previewCloseBtn')) return;
    if (container.style.display === 'none') return;
    container.classList.add('preview-expanded');
    document.body.classList.add('preview-expanded-active');
  });

  closeBtn?.addEventListener('click', event => {
    event.stopPropagation();
    close();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
}
