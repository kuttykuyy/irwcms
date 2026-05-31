/**
 * preview.test.ts — Unit tests for data normalization and formatDecimal.
 */
import { normalizeMBData, normalizeVSData, normalizeData, formatDecimal } from '../src/preview';

// ── formatDecimal ─────────────────────────────────────────────

describe('formatDecimal', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatDecimal(null)).toBe('');
    expect(formatDecimal(undefined)).toBe('');
    expect(formatDecimal('')).toBe('');
  });

  it('preserves integers as-is', () => {
    expect(formatDecimal(10)).toBe('10');
    expect(formatDecimal('5')).toBe('5');
  });

  it('preserves up to 4 decimal places', () => {
    expect(formatDecimal(3.14)).toBe('3.14');
    expect(formatDecimal(1.2345)).toBe('1.2345');
  });

  it('truncates beyond 4 decimals', () => {
    expect(formatDecimal(1.23456)).toBe('1.2346');
  });

  it('handles scientific notation — must not return "1e-5" string', () => {
    // 1e-5 = 0.00001 has 5 decimal places → capped to 4 → "0.0000"
    // Key invariant: result must NEVER be the scientific notation string "1e-5"
    const result = formatDecimal(1e-5);
    expect(result).not.toContain('e');
    // 5 decimal places > 4 cap → rounded to 4 sig decimals → "0.0000"
    expect(result).toBe('0.0000');
  });

  it('strips trailing zeros', () => {
    expect(formatDecimal(1.5000)).toBe('1.5');
    expect(formatDecimal(2.0)).toBe('2');
  });

  it('returns original string for non-numeric', () => {
    expect(formatDecimal('abc')).toBe('abc');
  });
});

// ── normalizeMBData ───────────────────────────────────────────

describe('normalizeMBData', () => {
  it('returns empty array for empty input', () => {
    expect(normalizeMBData([])).toEqual([]);
  });

  it('maps standard column names correctly', () => {
    const input = [{ Particulars: 'Excavation', N1: '2', N2: '1', N3: '1', K: '1', L: '10.5', B: '3', H: '1.5', Sign: '+' }];
    const [row] = normalizeMBData(input);
    expect(row?.Particulars).toBe('Excavation');
    expect(row?.N1).toBe('2');
    expect(row?.L).toBe('10.5');
    expect(row?.Sign).toBe('+');
  });

  it('maps alternative column names (length, breadth, height)', () => {
    const input = [{ Particulars: 'Wall', Length: '5.0', Breadth: '2.0', Height: '3.0' }];
    const [row] = normalizeMBData(input);
    expect(row?.L).toBe('5');
    expect(row?.B).toBe('2');
    expect(row?.H).toBe('3');
  });

  it('maps "coefficient" column to K', () => {
    const input = [{ Particulars: 'Test', Coefficient: '0.85', L: '10' }];
    const [row] = normalizeMBData(input);
    expect(row?.K).toBe('0.85');
  });

  it('filters rows with no meaningful data', () => {
    const input = [
      { Particulars: 'Valid', L: '10' },
      { SomeOtherCol: 'Junk' },
    ];
    expect(normalizeMBData(input)).toHaveLength(1);
  });

  it('excludes Infinity and NaN from numeric fields', () => {
    const input = [{ Particulars: 'Test', N1: Infinity, L: '5' }];
    const [row] = normalizeMBData(input);
    expect(row?.N1).toBe('');
    expect(row?.L).toBe('5');
  });

  it('handles case-insensitive column names', () => {
    const input = [{ particulars: 'Trench', n1: '3', l: '8.0' }];
    const [row] = normalizeMBData(input);
    expect(row?.Particulars).toBe('Trench');
    expect(row?.N1).toBe('3');
  });
});

// ── normalizeVSData ───────────────────────────────────────────

describe('normalizeVSData', () => {
  it('returns empty array for empty input', () => {
    expect(normalizeVSData([])).toEqual([]);
  });

  it('maps Item No and Proposed Qty', () => {
    const input = [{ 'Item No': '21.1.1.1', 'Proposed Qty': '205.33' }];
    const [row] = normalizeVSData(input);
    expect(row?.ItemNo).toBe('21.1.1.1');
    expect(row?.ProposedQty).toBe('205.33');
  });

  it('handles alternate column names (ItemNo, Proposed Qty.)', () => {
    // "Proposed Qty." (with trailing period) is a real IRWCMS export variant
    const input = [{ 'Item No.': '1.2.3', 'Proposed Qty.': '100' }];
    const [row] = normalizeVSData(input as any);
    expect(row?.ItemNo).toBe('1.2.3');
    expect(row?.ProposedQty).toBe('100');
  });

  it('filters rows missing ItemNo or ProposedQty', () => {
    const input = [
      { 'Item No': '1.1', 'Proposed Qty': '50' },
      { 'Item No': '1.2' },                        // missing qty
      { 'Proposed Qty': '30' },                    // missing item
    ];
    expect(normalizeVSData(input)).toHaveLength(1);
  });

  it('captures Description and Unit', () => {
    const input = [{ 'Item No': '1.1', 'Proposed Qty': '10', Description: 'Earthwork', Unit: 'Cum' }];
    const [row] = normalizeVSData(input);
    expect(row?.Description).toBe('Earthwork');
    expect(row?.Unit).toBe('Cum');
  });
});

// ── normalizeData auto-detection ─────────────────────────────

describe('normalizeData', () => {
  it('detects MB format when Particulars column present', () => {
    const input = [{ Particulars: 'Trench', N1: '1', L: '5' }];
    const result = normalizeData(input);
    expect(result).toHaveLength(1);
    expect((result[0] as any).Particulars).toBe('Trench');
  });

  it('detects VS format when Item No + Proposed Qty present and no MB fields', () => {
    const input = [{ 'Item No': '1.1.1', 'Proposed Qty': '100.5' }];
    const result = normalizeData(input);
    expect((result[0] as any).ItemNo).toBe('1.1.1');
  });

  it('falls back to MB when both have Proposed Qty AND Particulars', () => {
    const input = [{ Particulars: 'Test', 'Proposed Qty': '50', L: '10' }];
    const result = normalizeData(input);
    // hasMBFields is true → should be MB
    expect((result[0] as any).Particulars).toBe('Test');
  });
});
