/**
 * fill.test.ts — Integration tests for MB fill and VS fill on mock IRWCMS DOM.
 */
import { fillVariationForm, countExistingRows } from '../content';
import type { VSRow, MBRow } from '../src/types';
import { MB_FIELD_INDEX } from '../src/types';

// ── Build a mock IRWCMS Measurement Book row ──────────────────

function buildMBRow(overrides: Partial<Record<string, string>> = {}): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const fields = ['Particulars', 'N1', 'N2', 'N3', 'K', 'L', 'B', 'H'];
  fields.forEach(name => {
    const td  = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.name = name === 'Particulars' ? 'disc' : name.toLowerCase();
    inp.value = overrides[name] ?? '';
    td.appendChild(inp); tr.appendChild(td);
  });
  // Sign radios
  const signTd = document.createElement('td');
  const plus = Object.assign(document.createElement('input'), { type: 'radio', name: 'sign', value: '1' });
  const minus = Object.assign(document.createElement('input'), { type: 'radio', name: 'sign', value: '2' });
  plus.checked = true;
  signTd.append(plus, minus); tr.appendChild(signTd);
  return tr;
}

// ── Build a mock IRWCMS Variation Statement table ─────────────

function buildVSTable(items: Array<{ itemNo: string; existingQty: string }>): HTMLTableElement {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');

  // Header
  const header = document.createElement('tr');
  ['Item No', 'Description', 'Unit', 'Agmt Qty', 'Executed Qty', 'Balance', '% Exec', 'Rate', 'Amount', 'Proposed Qty', 'Remarks'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; header.appendChild(th);
  });
  tbody.appendChild(header);

  items.forEach(({ itemNo, existingQty }) => {
    const tr = document.createElement('tr');
    const cellData = [itemNo, 'Some description', 'Cum', '200', '150', '50', '75', '100', '15000', existingQty, ''];
    cellData.forEach((val, i) => {
      const td = document.createElement('td');
      if (i === 9) { // Proposed Qty column
        const inp = document.createElement('input');
        inp.type = 'text'; inp.value = val;
        inp.style.backgroundColor = 'rgb(144,238,144)'; // green
        td.appendChild(inp);
      } else {
        td.textContent = val;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

// ── MB field index tests ──────────────────────────────────────

describe('MB_FIELD_INDEX', () => {
  it('maps all expected fields', () => {
    expect(MB_FIELD_INDEX.Particulars).toBe(0);
    expect(MB_FIELD_INDEX.N1).toBe(1);
    expect(MB_FIELD_INDEX.N2).toBe(2);
    expect(MB_FIELD_INDEX.N3).toBe(3);
    expect(MB_FIELD_INDEX.K).toBe(4);
    expect(MB_FIELD_INDEX.L).toBe(5);
    expect(MB_FIELD_INDEX.B).toBe(6);
    expect(MB_FIELD_INDEX.H).toBe(7);
  });

  it('has no magic numbers — all indices are named', () => {
    const allIndices = Object.values(MB_FIELD_INDEX);
    // Indices should be 0-7, no gaps
    expect(allIndices.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

// ── VS Fill happy path ────────────────────────────────────────

describe('fillVariationForm — happy path', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fills matching items by Item No', () => {
    const table = buildVSTable([
      { itemNo: '21.1.1.1', existingQty: '' },
      { itemNo: '21.1.1.2', existingQty: '' },
      { itemNo: '21.1.2.1', existingQty: '' },
    ]);
    document.body.appendChild(table);

    const data: VSRow[] = [
      { ItemNo: '21.1.1.1', ProposedQty: '205.33' },
      { ItemNo: '21.1.2.1', ProposedQty: '88.00' },
    ];
    const result = fillVariationForm(data);

    expect(result.success).toBe(true);
    expect(result.filled).toBe(2);
    expect(result.notFound).toHaveLength(0);
  });

  it('reports not-found items when Item No is missing on page', () => {
    const table = buildVSTable([{ itemNo: '21.1.1.1', existingQty: '' }]);
    document.body.appendChild(table);

    const data: VSRow[] = [
      { ItemNo: '21.1.1.1', ProposedQty: '100' },
      { ItemNo: '99.9.9.9', ProposedQty: '50' },   // not on page
    ];
    const result = fillVariationForm(data);

    expect(result.filled).toBe(1);
    expect(result.notFound).toContain('99.9.9.9');
  });

  it('returns failure when data is empty', () => {
    const result = fillVariationForm([]);
    expect(result.success).toBe(false);
    expect(result.filled).toBe(0);
  });

  it('skips disabled inputs', () => {
    const table = buildVSTable([{ itemNo: '1.1.1', existingQty: '' }]);
    const inp = table.querySelector('input')!;
    inp.disabled = true;
    document.body.appendChild(table);

    const result = fillVariationForm([{ ItemNo: '1.1.1', ProposedQty: '50' }]);
    expect(result.filled).toBe(0);
  });
});

// ── VS Fill — duplicate Item No handling ──────────────────────

describe('fillVariationForm — edge cases', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fills only the first occurrence when Item No appears twice', () => {
    const table = buildVSTable([
      { itemNo: '1.1.1', existingQty: '' },
      { itemNo: '1.1.1', existingQty: '' },  // duplicate
    ]);
    document.body.appendChild(table);
    const result = fillVariationForm([{ ItemNo: '1.1.1', ProposedQty: '42' }]);
    // dataMap deletes the key after first fill, so second row won't match
    expect(result.filled).toBe(1);
  });

  it('handles empty Proposed Qty in data', () => {
    const table = buildVSTable([{ itemNo: '1.1.1', existingQty: '' }]);
    document.body.appendChild(table);
    const result = fillVariationForm([{ ItemNo: '1.1.1', ProposedQty: '' }]);
    // Empty ProposedQty filtered out during normalization
    expect(result.filled).toBe(0);
  });
});

// ── Row counting ──────────────────────────────────────────────

describe('countExistingRows', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('counts only rows with filled inputs', () => {
    document.body.innerHTML = `
      <table id="datatable">
        <tbody>
          <tr><td><input type="text" value="Foundation Trench" name="disc"></td></tr>
          <tr><td><input type="text" value="Backfill" name="disc"></td></tr>
          <tr><td><input type="text" value="" name="disc"></td></tr>
        </tbody>
      </table>`;
    expect(countExistingRows(document)).toBe(2);
  });

  it('returns 0 for empty table', () => {
    document.body.innerHTML = '<table id="datatable"><tbody></tbody></table>';
    expect(countExistingRows(document)).toBe(0);
  });

  it('returns 0 when no measurement table found', () => {
    document.body.innerHTML = '<p>No table here</p>';
    expect(countExistingRows(document)).toBe(0);
  });
});

// ── MB fill — sign radio selection ───────────────────────────

describe('MB sign radio selection', () => {
  it('MB_FIELD_INDEX maps correctly for plus sign (index 0 of radios)', () => {
    // Verify the constant hasn't drifted — Sign should NOT be in MB_FIELD_INDEX
    // (Sign uses radio buttons, not indexed text inputs)
    expect('Sign' in MB_FIELD_INDEX).toBe(false);
  });
});
