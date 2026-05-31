/**
 * content.ts — Content script injected into IRWCMS pages.
 *
 * Acts as the single bridge between popup.ts and the IRWCMS DOM.
 * All fill logic lives here. popup/fill.ts calls sendMessage; never
 * executeScript for fill operations.
 *
 * Message actions handled:
 *   fillForm         — MB fill (row-by-row)
 *   fillVariation    — VS fill (item-no matching)
 *   stopFill         — abort running fill
 *   detectPageInfo   — extract agreement/measurement/email/contractor
 *   detectFormType   — returns measurement | variation | none
 *   getExistingRowCount
 *   checkFormPage / checkVariationForm / getFormType / getMeasurementNo
 */

import type {
  ContentMessage, ContentResponse, MBRow, VSRow,
  FillResult, FormTypeResult, PageInfo, FormType,
} from './src/types';
import { MB_FIELD_INDEX } from './src/types';

// ── Global stop signal ────────────────────────────────────────
declare global { interface Window { IRWCMS_STOP_FILL?: boolean; } }

// ── Message router ────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (r: ContentResponse) => void) => {
    switch (message.action) {

      case 'fillForm':
        window.IRWCMS_STOP_FILL = false;
        fillFormRows(message.data, message.delayMs, message.appendMode)
          .then(result => sendResponse(result));
        return true; // async

      case 'fillVariation':
        sendResponse(fillVariationForm(message.data));
        return true;

      case 'stopFill':
        window.IRWCMS_STOP_FILL = true;
        sendResponse({ success: true });
        return false;

      case 'detectPageInfo':
        sendResponse({ pageInfo: extractPageInfo() });
        return false;

      case 'detectFormType':
        sendResponse({ formTypeResult: detectFormType() });
        return false;

      case 'getExistingRowCount':
        sendResponse({ existingRows: countExistingRows(document) });
        return false;

      case 'checkFormPage':
        sendResponse({ isOnForm: isOnMeasurementForm() });
        return false;

      case 'checkVariationForm':
        sendResponse({ isOnVariation: isOnVariationForm() });
        return false;

      case 'getFormType': {
        let formType: FormType = 'none';
        if (isOnVariationForm())   formType = 'variation';
        else if (isOnMeasurementForm()) formType = 'measurement';
        sendResponse({ formType });
        return false;
      }

      case 'getMeasurementNo':
        sendResponse({ measurementNo: extractMeasurementNo() });
        return false;
    }
  }
);

// ── Utility ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/** Walk main doc + same-origin iframes and return the first non-null result. */
function searchDocuments<T>(fn: (doc: Document) => T | null): T | null {
  const result = fn(document);
  if (result !== null) return result;
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
      if (doc) { const r = fn(doc); if (r !== null) return r; }
    } catch { /* cross-origin */ }
  }
  return null;
}

function isInputDisabled(input: HTMLInputElement | null): boolean {
  if (!input) return true;
  if (input.disabled || input.readOnly) return true;
  const s = window.getComputedStyle(input);
  if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return true;
  const td = input.closest('td');
  if (td) {
    const cs = window.getComputedStyle(td);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) return true;
  }
  return false;
}

// ── Form detection ────────────────────────────────────────────

function isOnMeasurementForm(): boolean {
  return searchDocuments(doc => {
    const body = doc.body?.textContent ?? '';
    const lower = body.toLowerCase();
    const btns = doc.querySelectorAll('button, input[type="button"], a.btn, .btn');
    for (const b of btns) {
      if ((b.textContent ?? '').toLowerCase().includes('add row')) return true;
    }
    if (doc.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]')) return true;
    if (body.includes('Particulars') && body.includes('N1') && lower.includes('save as draft')) return true;
    return null;
  }) ?? false;
}

function isOnVariationForm(): boolean {
  return searchDocuments(doc => {
    if (!doc.body) return null;
    const text  = doc.body.innerText ?? doc.body.textContent ?? '';
    const lower = text.toLowerCase();
    const hasProposedQty = text.includes('Proposed') && lower.includes('qty');
    const hasSched       = /Schedule[-\s]?[AB]\d?/i.test(text);
    const hasItemNo      = text.includes('Item No');
    const hasVariation   = lower.includes('variation');
    if (!hasProposedQty || (!hasSched && !hasItemNo && !hasVariation)) return null;
    for (const table of doc.querySelectorAll('table')) {
      for (const row of table.querySelectorAll('tr')) {
        for (const cell of row.querySelectorAll('td')) {
          if (/^\d+(\.\d+)+$/.test(cell.textContent?.trim() ?? '')) {
            if (row.querySelector('input[type="text"]')) return true;
          }
        }
      }
    }
    return null;
  }) ?? false;
}

export function detectFormType(): FormTypeResult {
  const text  = document.body?.innerText  ?? document.body?.textContent ?? '';
  const html  = document.body?.innerHTML  ?? '';
  const lower = text.toLowerCase();

  const hasProposedQty      = text.includes('Proposed') && lower.includes('qty');
  const hasScheduleTabs     = /Schedule[-\s]?[AB]\d?/i.test(text);
  const hasItemNo           = text.includes('Item No');
  const hasVariation        = lower.includes('variation');
  const hasContractVariation = text.includes('Contract Variation');
  const hasVariationDetails  = text.includes('Variation Details');
  const hasParticulars      = text.includes('Particulars');
  const hasN1               = text.includes('N1');
  const hasAddRow           = lower.includes('add row') ||
    !!document.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]');

  let formType: FormType = 'none';
  if (hasAddRow || (hasParticulars && hasN1))          formType = 'measurement';
  else if (hasContractVariation || hasVariationDetails) formType = 'variation';
  else if (hasProposedQty && (hasScheduleTabs || hasItemNo || hasVariation)) formType = 'variation';

  return { formType, hasProposedQty, hasScheduleTabs, hasItemNo, hasAddRow,
           hasParticulars, hasContractVariation, hasVariationDetails };
}

// ── Page info extraction ──────────────────────────────────────

export function extractPageInfo(): PageInfo {
  const info: PageInfo = {};
  const allText  = document.body?.innerText || document.body?.textContent || '';

  // Railway official name
  const nameMatch = allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]+?)\s*\(([^)]+)\)/i)
    ?? allText.match(/Welcome\s+([A-Za-z][A-Za-z\s.]{2,30})(?:\s*\||$|\s{2,})/i);
  if (nameMatch) {
    info.railwayOfficialName        = nameMatch[1]!.trim().replace(/\s+/g, ' ');
    if (nameMatch[2] !== undefined) info.railwayOfficialDesignation = nameMatch[2].trim();
  }

  // Email
  const emailMatch = allText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) info.irwcmsEmail = emailMatch[1]!.toLowerCase();

  // Agreement number
  const agmtMatch = allText.match(/Agreement\s*(?:Number|No\.?)\s*[:\s]*([A-Za-z0-9\/\-]+)/i);
  if (agmtMatch) info.agreementNo = agmtMatch[1]!.trim();

  // Contractor
  const contractorMatch = allText.match(
    /Name of Contractor[:\s]*([A-Z0-9\s\-&.,()\/]+?)(?:\s{2,}|Agreement Number|Situation|Date of|Name of Work)/i,
  );
  if (contractorMatch) info.contractorName = contractorMatch[1]!.trim();

  // Measurement number
  for (const inp of document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')) {
    if (/^\d{10,}\/[A-Z]+\/[A-Z]+\/[A-Z]+/i.test(inp.value?.trim() ?? '')) {
      info.measurementNo = inp.value.trim(); break;
    }
  }

  info.pageTitle = document.title;
  return info;
}

// ── Row counting ──────────────────────────────────────────────

export function countExistingRows(doc: Document): number {
  const tbody = doc.querySelector('#datatabody, #datatable tbody, table.datatable tbody, .measurement-table tbody');
  if (tbody) {
    let count = 0;
    for (const row of tbody.querySelectorAll('tr')) {
      for (const inp of row.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')) {
        if (inp.value?.trim()) { count++; break; }
      }
    }
    return count;
  }
  for (const table of doc.querySelectorAll('table')) {
    const tb = table.querySelector('tbody');
    if (tb?.querySelector('tr')?.querySelector('input[name="disc"], input[placeholder*="Particulars" i]')) {
      return tb.querySelectorAll('tr').length;
    }
  }
  return 0;
}

// ── Measurement number extraction ─────────────────────────────

function extractMeasurementNo(): string | null {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
    if (/^\d+(\.\d+)+$/.test(link.textContent?.trim() ?? '')) return link.textContent!.trim();
  }
  const el = document.querySelector<HTMLElement>('[id*="measurement" i], [class*="measurement" i]');
  if (el) { const v = (el as HTMLInputElement).value ?? el.textContent?.trim(); if (v) return v; }
  return null;
}

// ── Find Add Row button + owning document ─────────────────────

function findAddRowButton(): { btn: HTMLElement | null; doc: Document } {
  function findInDoc(d: Document): HTMLElement | null {
    for (const btn of d.querySelectorAll<HTMLElement>('button, input[type="button"], a.btn, .btn')) {
      if ((btn.textContent ?? (btn as HTMLInputElement).value ?? '').toLowerCase().includes('add row')) return btn;
    }
    return d.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]');
  }
  const btn = findInDoc(document);
  if (btn) return { btn, doc: document };
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const d = iframe.contentDocument ?? iframe.contentWindow?.document;
      if (d) { const b = findInDoc(d); if (b) return { btn: b, doc: d }; }
    } catch { /* cross-origin */ }
  }
  return { btn: null, doc: document };
}

// ── MB Fill ───────────────────────────────────────────────────

async function fillFormRows(data: MBRow[], delayMs: number, appendMode: boolean): Promise<FillResult> {
  const rowDelay = delayMs ?? 100;

  // Enable coefficient checkbox if needed
  const needsCoeff = data.some(r => (r.K ?? '') !== '' || (r.Sign ?? '') !== '');
  if (needsCoeff) {
    const cb = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find(c => (c.closest('div, label, td')?.textContent ?? '').toLowerCase().includes('coefficient'));
    if (cb && !cb.checked) { cb.click(); await delay(50); }
  }

  // Resolve the form document once (may be inside an iframe)
  let { doc: formDoc } = findAddRowButton();

  // Cache Add Row button — re-query only if stale
  let cachedBtn: HTMLElement | null = null;
  function getAddRowBtn(): HTMLElement | null {
    if (cachedBtn && formDoc.contains(cachedBtn)) return cachedBtn;
    cachedBtn = findAddRowButton().btn;
    return cachedBtn;
  }

  let filledCount = 0;

  for (let i = 0; i < data.length; i++) {
    if (window.IRWCMS_STOP_FILL) return { success: true, message: `Stopped at row ${i}`, filled: filledCount, notFound: [], stopped: true };

    const row = data[i]!;
    if (appendMode || i > 0) {
      getAddRowBtn()?.click();
      await delay(50);
    }

    const tbody    = formDoc.querySelector<HTMLElement>('#datatabody, #datatable tbody, table.datatable tbody');
    const allRows  = tbody
      ? tbody.querySelectorAll<HTMLTableRowElement>('tr')
      : formDoc.querySelectorAll<HTMLTableRowElement>('table tbody tr');
    const lastRow  = allRows[allRows.length - 1];
    if (!lastRow) continue;

    // All non-radio/checkbox/hidden enabled inputs in this row — using named indices
    const inputs = Array.from(lastRow.querySelectorAll<HTMLInputElement>('input')).filter(
      inp => inp.type !== 'radio' && inp.type !== 'checkbox' && inp.type !== 'hidden' && !inp.disabled && !inp.readOnly
    );

    // Particulars (index 0)
    const partInput = inputs[MB_FIELD_INDEX.Particulars];
    if (partInput && row.Particulars) {
      partInput.value = row.Particulars;
      partInput.dispatchEvent(new Event('input',  { bubbles: true }));
      partInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Sign (radio)
    if (row.Sign) {
      const signStr = String(row.Sign).trim();
      const isPlus  = signStr === '+' || signStr === '1';
      const radios  = Array.from(lastRow.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(r => !r.disabled);
      let target    = radios.find(r => r.value === (isPlus ? '1' : '2'))
                   ?? radios[isPlus ? 0 : 1];
      if (target) {
        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }

    // Numeric fields — using named MB_FIELD_INDEX (no magic numbers)
    const fillInput = (idx: number, val: string | undefined) => {
      if (!val || val === '') return;
      const inp = inputs[idx];
      if (!inp) return;
      inp.value = val;
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };

    fillInput(MB_FIELD_INDEX.N1, row.N1);
    fillInput(MB_FIELD_INDEX.N2, row.N2);
    fillInput(MB_FIELD_INDEX.N3, row.N3);
    fillInput(MB_FIELD_INDEX.K,  row.K);
    fillInput(MB_FIELD_INDEX.L,  row.L);
    fillInput(MB_FIELD_INDEX.B,  row.B);
    fillInput(MB_FIELD_INDEX.H,  row.H);

    filledCount++;
    await delay(rowDelay);
  }

  return { success: true, message: `Filled ${filledCount} rows`, filled: filledCount, notFound: [] };
}

// ── VS Fill ───────────────────────────────────────────────────

export function fillVariationForm(data: VSRow[]): FillResult {
  // Normalize data — accept flexible column names
  const normalized = data.map(row => ({
    itemNo:      String(row.ItemNo ?? '').trim(),
    proposedQty: String(row.ProposedQty ?? '').trim(),
  })).filter(r => r.itemNo && r.proposedQty);

  if (!normalized.length) {
    return { success: false, message: 'No valid data. Excel must have "Item No" and "Proposed Qty" columns.', filled: 0, notFound: [] };
  }

  // Hoist native setter and regex once — never inside the loop
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  const ITEM_RE      = /^\d+(\.\d+)+$/;
  const dataMap      = new Map(normalized.map(r => [r.itemNo, r.proposedQty]));

  let filledCount = 0;
  const notFound: string[] = [];
  const found:    string[] = [];

  function fillInDoc(doc: Document): void {
    for (const table of doc.querySelectorAll('table')) {
      for (const row of table.querySelectorAll<HTMLTableRowElement>('tr')) {
        let itemNoValue: string | null = null;
        for (const cell of row.querySelectorAll('td')) {
          const text = cell.textContent?.trim() ?? '';
          if (ITEM_RE.test(text)) { itemNoValue = text; break; }
        }
        if (!itemNoValue) continue;
        const qty = dataMap.get(itemNoValue);
        if (!qty) continue;

        const inputs = row.querySelectorAll<HTMLInputElement>(
          'input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
        );
        let proposedInput: HTMLInputElement | null = null;

        for (const inp of inputs) {
          if (inp.disabled || inp.readOnly) continue;
          const td = inp.closest('td') as HTMLTableCellElement | null;
          if (!td) continue;
          // Fast path: inline style or class before triggering getComputedStyle
          const inlineGreen = td.style.backgroundColor.includes('green') || inp.style.backgroundColor.includes('green')
                           || td.classList.contains('bg-success') || td.classList.contains('table-success');
          if (inlineGreen)        { proposedInput = inp; break; }
          if (td.cellIndex >= 7)  { proposedInput = inp; break; }
        }
        if (!proposedInput) {
          for (const inp of inputs) { if (!inp.disabled && !inp.readOnly) { proposedInput = inp; break; } }
        }

        if (proposedInput) {
          nativeSetter.call(proposedInput, qty);
          proposedInput.dispatchEvent(new Event('input', { bubbles: true }));
          filledCount++;
          found.push(itemNoValue);
          dataMap.delete(itemNoValue);
        }
      }
    }
  }

  fillInDoc(document);
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const d = iframe.contentDocument ?? iframe.contentWindow?.document;
      if (d) fillInDoc(d);
    } catch { /* cross-origin */ }
  }
  dataMap.forEach((_, k) => notFound.push(k));

  return {
    success: filledCount > 0,
    message: filledCount > 0
      ? `✅ Filled ${filledCount} items${notFound.length ? `. ${notFound.length} not found.` : ''}`
      : 'No matching Item Numbers found on this page.',
    filled: filledCount, notFound, found,
  };
}

console.log('IRWCMS Auto-Fill content script loaded');
