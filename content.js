// Content script for IRWCMS form auto-fill

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillForm') {
    fillFormRows(request.data);
    sendResponse({ success: true });
  }
  return true;
});

async function fillFormRows(data) {
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Click "Add row" button if not the first row (first row usually exists)
    if (i > 0) {
      const addRowBtn = document.querySelector('button.btn-info, button[class*="Add"], button');
      const addRowBtns = Array.from(document.querySelectorAll('button')).filter(
        btn => btn.textContent.toLowerCase().includes('add row') || 
               btn.textContent.toLowerCase().includes('add')
      );
      
      if (addRowBtns.length > 0) {
        addRowBtns[0].click();
        await delay(300);
      }
    }
    
    // Get all rows in the form table
    const tableRows = document.querySelectorAll('table tbody tr, .measurement-row, tr');
    const lastRow = tableRows[tableRows.length - 1] || document;
    
    // Fill the fields - try multiple selector strategies
    fillField(lastRow, 'Particulars', row.Particulars);
    fillField(lastRow, 'N1', row.N1);
    fillField(lastRow, 'N2', row.N2);
    fillField(lastRow, 'N3', row.N3);
    fillField(lastRow, 'K', row.K);
    fillField(lastRow, 'L', row.L);
    fillField(lastRow, 'B', row.B);
    fillField(lastRow, 'H', row.H);
    
    await delay(200);
  }
}

function fillField(container, fieldName, value) {
  if (value === undefined || value === null || value === '') return;
  
  // Strategy 1: Find by placeholder
  let input = container.querySelector(`input[placeholder*="${fieldName}" i]`);
  
  // Strategy 2: Find by name attribute
  if (!input) {
    input = container.querySelector(`input[name*="${fieldName}" i]`);
  }
  
  // Strategy 3: Find by id
  if (!input) {
    input = container.querySelector(`input[id*="${fieldName}" i]`);
  }
  
  // Strategy 4: Find input near label with field name
  if (!input) {
    const labels = container.querySelectorAll('label, th, td');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes(fieldName.toLowerCase())) {
        input = label.querySelector('input') || 
                label.parentElement?.querySelector('input') ||
                label.nextElementSibling?.querySelector('input');
        if (input) break;
      }
    }
  }
  
  // Strategy 5: Position-based for known fields
  if (!input) {
    const inputs = container.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
    const fieldIndex = {
      'Particulars': 0,
      'N1': 1,
      'N2': 2,
      'N3': 3,
      'K': 4,
      'L': 5,
      'B': 6,
      'H': 7
    };
    
    if (fieldIndex[fieldName] !== undefined && inputs[fieldIndex[fieldName]]) {
      input = inputs[fieldIndex[fieldName]];
    }
  }
  
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('IRWCMS Auto-Fill extension loaded');