// Content script for IRWCMS form auto-fill

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillForm') {
    fillFormRows(request.data);
    sendResponse({ success: true });
  }
  return true;
});

async function fillFormRows(data) {
  console.log('IRWCMS Auto-Fill: Starting to fill', data.length, 'rows');
  
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
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    console.log('IRWCMS Auto-Fill: Filling row', i + 1, row);
    
    // Click "Add row" button if not the first row
    if (i > 0) {
      const addRowBtn = findAddRowButton();
      if (addRowBtn) {
        addRowBtn.click();
        await delay(400);
        console.log('IRWCMS Auto-Fill: Added new row');
      } else {
        console.warn('IRWCMS Auto-Fill: Add row button not found');
      }
    }
    
    // Get the last row in datatabody or table
    const tbody = document.querySelector('#datatabody, #datatable tbody, table.datatable tbody');
    const tableRows = tbody ? tbody.querySelectorAll('tr') : document.querySelectorAll('table tbody tr');
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
  
  console.log('IRWCMS Auto-Fill: Completed filling all rows');
}

function findAddRowButton() {
  // Strategy 1: Button with "Add row" text
  const buttons = Array.from(document.querySelectorAll('button'));
  let btn = buttons.find(b => b.textContent.trim().toLowerCase() === 'add row');
  if (btn) return btn;
  
  // Strategy 2: Button containing "Add" with btn-info class
  btn = buttons.find(b => 
    b.textContent.toLowerCase().includes('add') && 
    (b.classList.contains('btn-info') || b.classList.contains('btn-primary'))
  );
  if (btn) return btn;
  
  // Strategy 3: Any button with "add" text
  btn = buttons.find(b => b.textContent.toLowerCase().includes('add row'));
  return btn;
}

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
  
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('IRWCMS Auto-Fill: Filled Particulars:', value);
  } else {
    console.warn('IRWCMS Auto-Fill: Particulars input not found');
  }
}

function fillNumericFields(row, data) {
  // Get all inputs in the row, excluding radio buttons and checkboxes
  const inputs = Array.from(row.querySelectorAll('input')).filter(inp => 
    inp.type !== 'radio' && inp.type !== 'checkbox' && inp.type !== 'hidden'
  );
  
  console.log('IRWCMS Auto-Fill: Found', inputs.length, 'inputs in row');
  
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

console.log('IRWCMS Auto-Fill extension loaded');
