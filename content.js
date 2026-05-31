// Content script for IRWCMS form auto-fill

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillForm') {
    // Check if we're on the correct form page first
    if (!isOnMeasurementForm()) {
      sendResponse({ success: false, error: 'NOT_ON_FORM', message: 'Please open a measurement item form first. Click on an item row to open the form with "Add row" button.' });
      return true;
    }
    // Pass appendMode flag (default false = replace mode)
    fillFormRows(request.data, request.appendMode || false);
    sendResponse({ success: true });
  }
  if (request.action === 'fillVariation') {
    // Check if we're on variation statement form
    if (!isOnVariationForm()) {
      sendResponse({ success: false, error: 'NOT_ON_VARIATION', message: 'Please open a Variation Statement page (Schedule A/B tabs with "Proposed Qty." column).' });
      return true;
    }
    // Fill variation form by matching Item No.
    const result = fillVariationForm(request.data);
    sendResponse(result);
    return true;
  }
  if (request.action === 'getMeasurementNo') {
    const measurementNo = extractMeasurementNo();
    sendResponse({ measurementNo: measurementNo });
  }
  if (request.action === 'checkFormPage') {
    const isOnForm = isOnMeasurementForm();
    sendResponse({ isOnForm: isOnForm });
  }
  if (request.action === 'checkVariationForm') {
    const isOnVariation = isOnVariationForm();
    sendResponse({ isOnVariation: isOnVariation });
  }
  if (request.action === 'getFormType') {
    // Returns 'variation', 'measurement', or 'none'
    if (isOnVariationForm()) {
      sendResponse({ formType: 'variation' });
    } else if (isOnMeasurementForm()) {
      sendResponse({ formType: 'measurement' });
    } else {
      sendResponse({ formType: 'none' });
    }
    return true;
  }
  if (request.action === 'getExistingRowCount') {
    const count = countExistingRows();
    sendResponse({ existingRows: count });
  }
  return true;
});

// Count existing rows in the measurement form
function countExistingRows() {
  console.log('IRWCMS Auto-Fill: Counting existing rows');
  
  // Function to count rows in a document
  function countInDoc(doc) {
    // Try multiple selectors for the data table body
    const tbody = doc.querySelector('#datatabody, #datatable tbody, table.datatable tbody, .measurement-table tbody');
    if (tbody) {
      const rows = tbody.querySelectorAll('tr');
      let validRows = 0;
      for (const row of rows) {
        const inputs = row.querySelectorAll('input[type="text"], input:not([type])');
        // Early-exit loop — stop scanning inputs the moment we find a filled one
        let hasData = false;
        for (const inp of inputs) {
          if (inp.value && inp.value.trim() !== '') { hasData = true; break; }
        }
        if (hasData) validRows++;
      }
      return validRows;
    }
    
    // Fallback: count rows in any table that looks like measurement data
    const tables = doc.querySelectorAll('table');
    for (const table of tables) {
      const tbody = table.querySelector('tbody');
      if (tbody) {
        const rows = tbody.querySelectorAll('tr');
        if (rows.length > 0) {
          // Check if this looks like a measurement table (has Particulars-like inputs)
          const firstRow = rows[0];
          if (firstRow.querySelector('input[name="disc"], input[placeholder*="Particulars" i]')) {
            return rows.length;
          }
        }
      }
    }
    return 0;
  }
  
  // Check main document
  let count = countInDoc(document);
  if (count > 0) {
    console.log('IRWCMS Auto-Fill: Found', count, 'existing rows in main document');
    return count;
  }
  
  // Check iframes
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        count = countInDoc(iframeDoc);
        if (count > 0) {
          console.log('IRWCMS Auto-Fill: Found', count, 'existing rows in iframe');
          return count;
        }
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
  
  console.log('IRWCMS Auto-Fill: No existing rows found');
  return 0;
}

// Check if user is on the measurement form page (the one with "Add row" button)
function isOnMeasurementForm() {
  // Function to check a document for form elements
  function checkDocForForm(doc) {
    // Look for "Add row" button
    const buttons = doc.querySelectorAll('button, input[type="button"], a.btn, .btn');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || btn.innerText || '').toLowerCase();
      if (text.includes('add row') || text.includes('addrow')) {
        return true;
      }
    }
    // Check by ID or class
    if (doc.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]')) {
      return true;
    }
    // Check for form table structure (Particulars, N1, N2, N3 columns + Save as draft)
    const pageText = doc.body?.innerText || doc.body?.textContent || '';
    const hasParticulars = pageText.includes('Particulars');
    const hasN1N2N3 = pageText.includes('N1') && pageText.includes('N2');
    const hasSaveAsDraft = pageText.toLowerCase().includes('save as draft');
    if (hasParticulars && hasN1N2N3 && hasSaveAsDraft) {
      return true;
    }
    return false;
  }
  
  // Check main document
  if (checkDocForForm(document)) {
    console.log('IRWCMS Auto-Fill: On measurement form page ✓');
    return true;
  }
  
  // Check all iframes
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc && checkDocForForm(iframeDoc)) {
        console.log('IRWCMS Auto-Fill: On measurement form page (in iframe) ✓');
        return true;
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
  
  console.log('IRWCMS Auto-Fill: Not on form - form elements not found');
  return false;
}

// Find "Add row" button and the document context it lives in
// Returns { btn, doc } so callers can query the same document for table rows
function findAddRowButton() {
  function findInDoc(doc) {
    const buttons = doc.querySelectorAll('button, input[type="button"], a.btn, .btn');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || btn.innerText || '').toLowerCase();
      if (text.includes('add row') || text.includes('addrow')) {
        return btn;
      }
    }
    return doc.querySelector('[id*="addrow" i], [id*="add_row" i], [class*="addrow" i]') || null;
  }

  let btn = findInDoc(document);
  if (btn) return { btn, doc: document };

  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        btn = findInDoc(iframeDoc);
        if (btn) return { btn, doc: iframeDoc };
      }
    } catch (e) {}
  }

  return { btn: null, doc: document };
}

// Extract Measurement No. from IRWCMS page
function extractMeasurementNo() {
  console.log('IRWCMS Auto-Fill: Extracting Measurement No.');
  
  // Strategy 1: Find label "Measurement No." or "Measurement No. :" and get adjacent link/text
  const allElements = document.querySelectorAll('td, th, label, span, div');
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase().trim() || '';
    if (text.includes('measurement no') || text.includes('measurement number')) {
      // Check if next sibling has the value
      let nextEl = el.nextElementSibling;
      if (nextEl) {
        const link = nextEl.querySelector('a');
        if (link && link.textContent.trim()) {
          console.log('IRWCMS Auto-Fill: Found Measurement No. via sibling link:', link.textContent.trim());
          return link.textContent.trim();
        }
        if (nextEl.textContent.trim() && !nextEl.textContent.toLowerCase().includes('measurement')) {
          console.log('IRWCMS Auto-Fill: Found Measurement No. via sibling:', nextEl.textContent.trim());
          return nextEl.textContent.trim();
        }
      }
      // Check if link is inside the same element
      const linkInside = el.querySelector('a');
      if (linkInside && linkInside.textContent.trim()) {
        console.log('IRWCMS Auto-Fill: Found Measurement No. inside element:', linkInside.textContent.trim());
        return linkInside.textContent.trim();
      }
    }
  }
  
  // Strategy 2: Look for table cell with Measurement No pattern (like 10431110050748/SSE/PW/...)
  const links = document.querySelectorAll('a');
  for (const link of links) {
    const text = link.textContent.trim();
    // Pattern: numbers/alphanumeric segments separated by slashes
    if (text && /^\d+\/\w+\//.test(text)) {
      console.log('IRWCMS Auto-Fill: Found Measurement No. via pattern match:', text);
      return text;
    }
  }
  
  // Strategy 3: Find element with id or class containing "measurement"
  const measurementEl = document.querySelector('[id*="measurement" i], [class*="measurement" i], [name*="measurement" i]');
  if (measurementEl) {
    const val = measurementEl.value || measurementEl.textContent?.trim();
    if (val) {
      console.log('IRWCMS Auto-Fill: Found Measurement No. via attribute match:', val);
      return val;
    }
  }
  
  console.log('IRWCMS Auto-Fill: Measurement No. not found');
  return null;
}

async function fillFormRows(data, appendMode = false) {
  console.log('IRWCMS Auto-Fill: Starting to fill', data.length, 'rows in', appendMode ? 'APPEND' : 'REPLACE', 'mode');
  
  // Check if any row needs coefficient (has K or Sign)
  const needsCoefficient = data.some(row => 
    (row.K !== undefined && row.K !== null && row.K !== '') ||
    (row.Sign !== undefined && row.Sign !== null && row.Sign !== '')
  );
  
  // Check the "Use Coefficient" checkbox if needed
  if (needsCoefficient) {
    console.log('IRWCMS Auto-Fill: Enabling coefficient checkbox');
    // Look for checkbox near "Use Coefficient" text
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const useCoeffCheckbox = checkboxes.find(cb => {
      const parent = cb.closest('div, label, td') || cb.parentElement;
      const text = parent?.textContent || '';
      return text.toLowerCase().includes('coefficient') || text.toLowerCase().includes('coeff');
    });
    
    if (useCoeffCheckbox && !useCoeffCheckbox.checked) {
      useCoeffCheckbox.click();
      await delay(300);
      console.log('IRWCMS Auto-Fill: Coefficient checkbox enabled');
    }
  }
  
  // Resolve the document context once (form may be inside an iframe)
  let formDoc = document;
  {
    const { doc } = findAddRowButton();
    formDoc = doc;
  }

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    console.log('IRWCMS Auto-Fill: Filling row', i + 1, row);

    // In APPEND mode: Always click "Add row" (including first row) to add after existing
    // In REPLACE mode: Click "Add row" only after the first row
    const shouldAddRow = appendMode ? true : (i > 0);

    if (shouldAddRow) {
      const { btn: addRowBtn } = findAddRowButton();
      if (addRowBtn) {
        addRowBtn.click();
        await delay(400);
        console.log('IRWCMS Auto-Fill: Added new row');
      } else {
        console.warn('IRWCMS Auto-Fill: Add row button not found');
      }
    }

    // Get the last row — search in the same document as the button
    const tbody = formDoc.querySelector('#datatabody, #datatable tbody, table.datatable tbody');
    const tableRows = tbody ? tbody.querySelectorAll('tr') : formDoc.querySelectorAll('table tbody tr');
    const lastRow = tableRows[tableRows.length - 1];
    
    if (!lastRow) {
      console.error('IRWCMS Auto-Fill: No row found to fill');
      continue;
    }
    
    console.log('IRWCMS Auto-Fill: Found row element', lastRow);
    
    // Fill the Particulars field (name="disc" or placeholder="Particulars")
    fillParticulars(lastRow, row.Particulars);
    
    // Fill numeric fields in the row
    fillNumericFields(lastRow, row);
    
    // Handle Sign (+/-) radio button
    selectSign(lastRow, row.Sign);
    
    await delay(300);
  }
  
  console.log('IRWCMS Auto-Fill: Completed filling all rows in', appendMode ? 'APPEND' : 'REPLACE', 'mode');
}

// Note: findAddRowButton() is defined above with iframe support

function fillParticulars(row, value) {
  if (value === undefined || value === null || value === '') return;
  
  // Primary: input with name="disc"
  let input = row.querySelector('input[name="disc"]');
  
  // Fallback: input with placeholder="Particulars"
  if (!input) {
    input = row.querySelector('input[placeholder="Particulars"]');
  }
  
  // Fallback: first text input in row
  if (!input) {
    input = row.querySelector('input[type="text"], input:not([type])');
  }
  
  // Skip if input is disabled or readonly
  if (isInputDisabled(input)) {
    console.log('IRWCMS Auto-Fill: Skipping Particulars - input is disabled/readonly');
    return;
  }
  
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('IRWCMS Auto-Fill: Filled Particulars:', value);
  } else {
    console.warn('IRWCMS Auto-Fill: Particulars input not found');
  }
}

function isInputDisabled(input) {
  // Check if input is disabled, readonly, or hidden
  if (!input) return true;
  if (input.disabled) return true;
  if (input.readOnly) return true;
  if (input.hasAttribute('disabled')) return true;
  if (input.hasAttribute('readonly')) return true;
  
  // Check computed styles for visibility
  const style = window.getComputedStyle(input);
  if (style.display === 'none') return true;
  if (style.visibility === 'hidden') return true;
  if (style.pointerEvents === 'none') return true;
  
  // Check if parent cell/container is disabled or hidden
  const parentCell = input.closest('td');
  if (parentCell) {
    const cellStyle = window.getComputedStyle(parentCell);
    if (cellStyle.display === 'none') return true;
    if (cellStyle.visibility === 'hidden') return true;
    // Check for greyed out appearance (opacity < 0.5 indicates disabled)
    if (parseFloat(cellStyle.opacity) < 0.5) return true;
  }
  
  return false;
}

function fillNumericFields(row, data) {
  // Get all inputs in the row, excluding radio buttons and checkboxes
  const inputs = Array.from(row.querySelectorAll('input')).filter(inp => 
    inp.type !== 'radio' && inp.type !== 'checkbox' && inp.type !== 'hidden'
  );
  
  console.log('IRWCMS Auto-Fill: Found', inputs.length, 'inputs in row');
  
  // Log disabled status of each input for debugging
  inputs.forEach((inp, idx) => {
    const disabled = isInputDisabled(inp);
    if (disabled) {
      console.log(`IRWCMS Auto-Fill: Input at index ${idx} is DISABLED/READONLY - will skip`);
    }
  });
  
  // Expected order based on IRWCMS: Particulars(0), N1(1), N2(2), N3(3), K(4), L(5), B(6), H(7)
  const fieldMap = [
    { name: 'Particulars', index: 0 },  // Already filled separately
    { name: 'N1', index: 1 },
    { name: 'N2', index: 2 },
    { name: 'N3', index: 3 },
    { name: 'K', index: 4 },
    { name: 'L', index: 5 },
    { name: 'B', index: 6 },
    { name: 'H', index: 7 }
  ];
  
  for (const field of fieldMap) {
    if (field.name === 'Particulars') continue; // Already handled
    
    const value = data[field.name];
    if (value === undefined || value === null || value === '') continue;
    
    // Try to find by name/placeholder first
    let input = row.querySelector(`input[name="${field.name}" i], input[placeholder="${field.name}" i]`);
    
    // Fallback to position
    if (!input && inputs[field.index]) {
      input = inputs[field.index];
    }
    
    // Skip if input is disabled or readonly
    if (isInputDisabled(input)) {
      console.log(`IRWCMS Auto-Fill: Skipping ${field.name} - input is disabled/readonly`);
      continue;
    }
    
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`IRWCMS Auto-Fill: Filled ${field.name}:`, value);
    }
  }
}

function selectSign(container, sign) {
  if (!sign) return;
  
  const signValue = String(sign).trim();
  const isPlus = signValue === '+' || signValue.toLowerCase() === 'plus' || signValue === '1';
  
  console.log('IRWCMS Auto-Fill: Setting sign to', isPlus ? '+' : '-');
  
  // Find radio buttons for +/-
  const radios = container.querySelectorAll('input[type="radio"]');
  
  for (const radio of radios) {
    const label = radio.nextSibling?.textContent || radio.parentElement?.textContent || '';
    const value = radio.value || '';
    
    if (isPlus) {
      if (label.includes('+') || value === '+' || value === 'plus' || value === '1') {
        radio.click();
        console.log('IRWCMS Auto-Fill: Selected + radio');
        return;
      }
    } else {
      if (label.includes('-') || value === '-' || value === 'minus' || value === '0') {
        radio.click();
        console.log('IRWCMS Auto-Fill: Selected - radio');
        return;
      }
    }
  }
  
  // Fallback: click by position (first = +, second = -)
  if (radios.length >= 2) {
    radios[isPlus ? 0 : 1].click();
    console.log('IRWCMS Auto-Fill: Selected radio by position');
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ VARIATION STATEMENT FORM SUPPORT ============

// Check if we're on a Variation Statement form (Schedule A/B tabs with "Proposed Qty." column)
function isOnVariationForm() {
  function checkDocForVariation(doc) {
    if (!doc || !doc.body) return false;
    
    const pageText = doc.body.innerText || doc.body.textContent || '';
    
    // Look for key indicators of Variation Statement form:
    // 1. "Proposed Qty." column header
    // 2. Schedule tabs (Schedule-A1, Schedule-B1, etc.)
    // 3. "Item No." column
    // 4. "% variation" or "variation" text
    
    const hasProposedQty = pageText.includes('Proposed') && (pageText.includes('Qty') || pageText.includes('qty'));
    const hasScheduleTabs = /Schedule[-\s]?[AB]\d?/i.test(pageText);
    const hasItemNo = pageText.includes('Item No') || pageText.includes('Item no');
    const hasVariation = pageText.toLowerCase().includes('variation');
    
    // Must have Proposed Qty and at least one other indicator
    if (hasProposedQty && (hasScheduleTabs || hasItemNo || hasVariation)) {
      // Additional check: Find actual input fields in rows with Item Numbers
      const tables = doc.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          // Look for a row with Item No pattern (like 21.1.1.1) and an input field
          for (const cell of cells) {
            const text = cell.textContent?.trim() || '';
            // Item No pattern: digits separated by dots
            if (/^\d+(\.\d+)+$/.test(text)) {
              // Found an Item No, check if row has editable input
              const inputs = row.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
              if (inputs.length > 0) {
                console.log('IRWCMS Auto-Fill: Detected Variation Statement form ✓');
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }
  
  // Check main document
  if (checkDocForVariation(document)) {
    return true;
  }
  
  // Check iframes
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc && checkDocForVariation(iframeDoc)) {
        return true;
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
  
  console.log('IRWCMS Auto-Fill: Not on Variation Statement form');
  return false;
}

// Fill Variation Statement form by matching Item No. to Proposed Qty.
function fillVariationForm(data) {
  console.log('IRWCMS Auto-Fill: Starting Variation fill with', data.length, 'items');
  
  // Normalize data - expect array of { itemNo: '21.1.1.1', proposedQty: 205.33 }
  // Also accept: { 'Item No': '21.1.1.1', 'Proposed Qty': 205.33 }
  const normalizedData = data.map(row => {
    const itemNo = row.itemNo || row['Item No'] || row['Item No.'] || row.ItemNo || row.item_no || '';
    const proposedQty = row.proposedQty || row['Proposed Qty'] || row['Proposed Qty.'] || row.ProposedQty || row.proposed_qty || row.Qty || '';
    return { 
      itemNo: String(itemNo).trim(), 
      proposedQty: String(proposedQty).trim() 
    };
  }).filter(row => row.itemNo && row.proposedQty);
  
  console.log('IRWCMS Auto-Fill: Normalized data:', normalizedData);
  
  if (normalizedData.length === 0) {
    return { 
      success: false, 
      message: 'No valid data found. Excel must have "Item No" and "Proposed Qty" columns.',
      filled: 0,
      notFound: []
    };
  }
  
  // Build a map of Item No -> Proposed Qty for quick lookup
  const dataMap = new Map();
  normalizedData.forEach(row => {
    dataMap.set(row.itemNo, row.proposedQty);
  });
  
  let filledCount = 0;
  const notFoundItems = [];
  const foundItems = [];
  
  // Function to fill variation in a document
  function fillInDoc(doc) {
    const tables = doc.querySelectorAll('table');
    
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        let itemNoCell = null;
        let itemNoValue = null;
        
        // Find the Item No. cell in this row
        for (const cell of cells) {
          const text = cell.textContent?.trim() || '';
          // Item No pattern: digits separated by dots (e.g., 21.1.1.1, 1.1.1.2)
          if (/^\d+(\.\d+)+$/.test(text)) {
            itemNoValue = text;
            itemNoCell = cell;
            break;
          }
        }
        
        if (!itemNoValue) continue;
        
        // Check if we have data for this Item No.
        const proposedQty = dataMap.get(itemNoValue);
        if (!proposedQty) continue;
        
        // Find the "Proposed Qty" input field in this row
        // It's typically a green highlighted input field
        const inputs = row.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
        
        // The "Proposed Qty" input is usually one of the editable inputs
        // Look for input with green background or in a cell with "Proposed" nearby
        let proposedInput = null;
        
        for (const input of inputs) {
          // Check if input is editable
          if (input.disabled || input.readOnly) continue;
          
          // Check parent cell for green background
          const parentCell = input.closest('td');
          const bgColor = parentCell ? window.getComputedStyle(parentCell).backgroundColor : '';
          const isGreen = bgColor.includes('144') || bgColor.includes('238') || bgColor.includes('rgb(144') || 
                          parentCell?.style.backgroundColor?.includes('green') ||
                          parentCell?.classList?.contains('bg-success') ||
                          input.style.backgroundColor?.includes('green');
          
          if (isGreen) {
            proposedInput = input;
            break;
          }
        }
        
        // Fallback: Look for the first editable input that's not in a readonly column
        if (!proposedInput) {
          for (const input of inputs) {
            if (!input.disabled && !input.readOnly) {
              // Skip inputs that already have values and look readonly-ish
              const parentCell = input.closest('td');
              const cellIndex = parentCell ? Array.from(parentCell.parentElement.children).indexOf(parentCell) : -1;
              
              // Proposed Qty is typically around column 10-13 in the variation table
              if (cellIndex >= 7) { 
                proposedInput = input;
                break;
              }
            }
          }
        }
        
        // Final fallback: just get first editable input
        if (!proposedInput) {
          for (const input of inputs) {
            if (!input.disabled && !input.readOnly) {
              proposedInput = input;
              break;
            }
          }
        }
        
        if (proposedInput) {
          proposedInput.value = proposedQty;
          proposedInput.dispatchEvent(new Event('input', { bubbles: true }));
          proposedInput.dispatchEvent(new Event('change', { bubbles: true }));
          proposedInput.dispatchEvent(new Event('blur', { bubbles: true }));
          
          console.log(`IRWCMS Auto-Fill: Filled Item ${itemNoValue} with Proposed Qty: ${proposedQty}`);
          filledCount++;
          foundItems.push(itemNoValue);
          dataMap.delete(itemNoValue); // Remove from map to track not-found items
        }
      }
    }
  }
  
  // Fill in main document
  fillInDoc(document);
  
  // Fill in iframes
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        fillInDoc(iframeDoc);
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
  
  // Items not found on page
  dataMap.forEach((qty, itemNo) => {
    notFoundItems.push(itemNo);
  });
  
  console.log(`IRWCMS Auto-Fill: Variation fill complete. Filled: ${filledCount}, Not found: ${notFoundItems.length}`);
  
  return {
    success: filledCount > 0,
    message: filledCount > 0 
      ? `✅ Filled ${filledCount} items` + (notFoundItems.length > 0 ? `. ${notFoundItems.length} items not found on page.` : '')
      : 'No matching Item Numbers found on this page.',
    filled: filledCount,
    notFound: notFoundItems,
    found: foundItems
  };
}

console.log('IRWCMS Auto-Fill extension loaded');
