/**
 * detection.test.ts — Tests for detectFormType and isOnMeasurementForm/VS detection
 *                     using real jsdom HTML.
 */
import { detectFormType, extractPageInfo } from '../content';

// ── detectFormType ────────────────────────────────────────────

describe('detectFormType', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns "measurement" when Add Row button present', () => {
    document.body.innerHTML = `
      <div>
        <p>Particulars N1 N2 N3</p>
        <button>Add Row</button>
        <p>Save as Draft</p>
      </div>`;
    const result = detectFormType();
    expect(result.formType).toBe('measurement');
    expect(result.hasAddRow).toBe(true);
  });

  it('returns "measurement" when Particulars + N1 text present', () => {
    document.body.innerHTML = '<p>Particulars column and N1 column are here</p>';
    const result = detectFormType();
    expect(result.formType).toBe('measurement');
    expect(result.hasParticulars).toBe(true);
  });

  it('returns "variation" when Contract Variation heading present', () => {
    document.body.innerHTML = '<h1>Contract Variation</h1><p>Some content</p>';
    const result = detectFormType();
    expect(result.formType).toBe('variation');
    expect(result.hasContractVariation).toBe(true);
  });

  it('returns "variation" when Proposed Qty + Schedule tabs present', () => {
    document.body.innerHTML = `
      <table>
        <tr><th>Item No</th><th>Proposed Qty</th></tr>
      </table>
      <div>Schedule A1 | Schedule B1</div>`;
    const result = detectFormType();
    expect(result.formType).toBe('variation');
    expect(result.hasProposedQty).toBe(true);
  });

  it('returns "none" for an unrelated page', () => {
    document.body.innerHTML = '<p>Welcome to this page. Please select an option.</p>';
    const result = detectFormType();
    expect(result.formType).toBe('none');
  });

  it('prefers "measurement" over "variation" when Add Row is present alongside variation text', () => {
    document.body.innerHTML = `
      <p>Particulars N1 N2 variation Proposed Qty</p>
      <button>Add Row</button>`;
    const result = detectFormType();
    expect(result.formType).toBe('measurement');
  });
});

// ── extractPageInfo ───────────────────────────────────────────

describe('extractPageInfo', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('extracts railway official name from Welcome text', () => {
    document.body.innerHTML = '<p>Welcome K VENKATESH (SSE/Works/B-1/GOC)</p>';
    const info = extractPageInfo();
    expect(info.railwayOfficialName).toBe('K VENKATESH');
    expect(info.railwayOfficialDesignation).toBe('SSE/Works/B-1/GOC');
  });

  it('extracts email address from page', () => {
    document.body.innerHTML = '<p>Contact: officer@ircep.gov.in for details</p>';
    const info = extractPageInfo();
    expect(info.irwcmsEmail).toBe('officer@ircep.gov.in');
  });

  it('extracts agreement number', () => {
    document.body.innerHTML = '<p>Agreement Number: SR/TPJ/Civil/2023/0071</p>';
    const info = extractPageInfo();
    expect(info.agreementNo).toBe('SR/TPJ/Civil/2023/0071');
  });

  it('extracts measurement number from input field', () => {
    document.body.innerHTML = '<input type="text" value="10431110050748/SSE/PW/GOC">';
    const info = extractPageInfo();
    expect(info.measurementNo).toBe('10431110050748/SSE/PW/GOC');
  });

  it('extracts contractor name', () => {
    document.body.innerHTML = `<p>Name of Contractor: M/S RAVI CONSTRUCTION CO.  Agreement Number SR/001</p>`;
    const info = extractPageInfo();
    expect(info.contractorName).toBe('M/S RAVI CONSTRUCTION CO.');
  });

  it('returns empty info for blank page', () => {
    document.body.innerHTML = '<p>Nothing useful here</p>';
    const info = extractPageInfo();
    expect(info.railwayOfficialName).toBeUndefined();
    expect(info.irwcmsEmail).toBeUndefined();
  });
});
