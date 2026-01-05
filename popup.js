let parsedData = [];

const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const fillBtn = document.getElementById('fillBtn');
const status = document.getElementById('status');
const rowCount = document.getElementById('rowCount');
const previewContainer = document.getElementById('previewContainer');
const previewBody = document.getElementById('previewBody');

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  fileName.textContent = file.name;
  showStatus('Parsing file...', 'info');
  
  try {
    const data = await parseFile(file);
    parsedData = data;
    rowCount.textContent = `Found ${data.length} rows`;
    renderPreview(data);
    fillBtn.disabled = false;
    showStatus('File parsed successfully! Review data below.', 'success');
  } catch (err) {
    showStatus('Error parsing file: ' + err.message, 'error');
    fillBtn.disabled = true;
  }
});

async function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        // Normalize column names
        const normalized = jsonData.map(row => {
          const normalized = {};
          for (const key in row) {
            const lowerKey = key.toLowerCase().trim();
            if (lowerKey.includes('particular')) normalized.Particulars = row[key];
            else if (lowerKey === 'n1') normalized.N1 = row[key];
            else if (lowerKey === 'n2') normalized.N2 = row[key];
            else if (lowerKey === 'n3') normalized.N3 = row[key];
            else if (lowerKey === 'k' || lowerKey.includes('coefficient')) normalized.K = row[key];
            else if (lowerKey === 'l' || lowerKey === 'length') normalized.L = row[key];
            else if (lowerKey === 'b' || lowerKey === 'breadth') normalized.B = row[key];
            else if (lowerKey === 'h' || lowerKey === 'height') normalized.H = row[key];
            else if (lowerKey === 'sign' || lowerKey === '+/-') normalized.Sign = row[key];
          }
          return normalized;
        });
        
        resolve(normalized.filter(row => row.Particulars || row.N1 || row.L));
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

fillBtn.addEventListener('click', async () => {
  if (parsedData.length === 0) {
    showStatus('No data to fill', 'error');
    return;
  }
  
  showStatus('Filling form...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Use chrome.scripting.executeScript to inject and run code directly
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillFormOnPage,
      args: [parsedData]
    });
    
    showStatus(`Filled ${parsedData.length} rows!`, 'success');
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
});

// This function will be injected into the page
function fillFormOnPage(data) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  async function fillFormRows() {
    console.log('IRWCMS Auto-Fill: Starting to fill', data.length, 'rows');
    
    // Check if any row needs coefficient
    const needsCoefficient = data.some(row => 
      (row.K !== undefined && row.K !== null && row.K !== '') ||
      (row.Sign !== undefined && row.Sign !== null && row.Sign !== '')
    );
    
    // Check the "Use Coefficient" checkbox if needed
    if (needsCoefficient) {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const useCoeffCheckbox = checkboxes.find(cb => {
        const parent = cb.closest('div, label, td') || cb.parentElement;
        const text = parent?.textContent || '';
        return text.toLowerCase().includes('coefficient');
      });
      
      if (useCoeffCheckbox && !useCoeffCheckbox.checked) {
        useCoeffCheckbox.click();
        await delay(300);
      }
    }
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      console.log('IRWCMS Auto-Fill: Filling row', i + 1, row);
      
      // Click "Add row" button if not the first row
      if (i > 0) {
        const buttons = Array.from(document.querySelectorAll('button'));
        const addRowBtn = buttons.find(b => 
          b.textContent.trim().toLowerCase() === 'add row' ||
          b.textContent.toLowerCase().includes('add row')
        );
        if (addRowBtn) {
          addRowBtn.click();
          await delay(400);
        }
      }
      
      // Get the last row in the table
      const tbody = document.querySelector('#datatabody, #datatable tbody, table.datatable tbody');
      const tableRows = tbody ? tbody.querySelectorAll('tr') : document.querySelectorAll('table tbody tr');
      const lastRow = tableRows[tableRows.length - 1];
      
      if (!lastRow) continue;
      
      // Fill Particulars
      if (row.Particulars) {
        let input = lastRow.querySelector('input[name="disc"]') || 
                    lastRow.querySelector('input[placeholder="Particulars"]') ||
                    lastRow.querySelector('input[type="text"], input:not([type])');
        if (input) {
          input.value = row.Particulars;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      
      // Get all non-radio/checkbox inputs in the row
      const inputs = Array.from(lastRow.querySelectorAll('input')).filter(inp => 
        inp.type !== 'radio' && inp.type !== 'checkbox' && inp.type !== 'hidden'
      );
      
      // Form field order: [0]=Particulars, [1]=N1, [2]=N2, [3]=N3, [4]=K, [5]=L, [6]=B, [7]=H
      // Handle Sign first (radio buttons between N3 and K)
      if (row.Sign) {
        const isPlus = String(row.Sign).trim() === '+' || row.Sign === '1' || row.Sign === 1;
        const radios = lastRow.querySelectorAll('input[type="radio"]');
        
        for (const radio of radios) {
          const label = radio.nextSibling?.textContent || radio.parentElement?.textContent || '';
          if (isPlus && label.includes('+')) { radio.click(); break; }
          if (!isPlus && label.includes('-')) { radio.click(); break; }
        }
        if (radios.length >= 2 && !Array.from(radios).some(r => r.checked)) {
          radios[isPlus ? 0 : 1].click();
        }
      }
      
      // Fill N1, N2, N3 (indices 1, 2, 3)
      ['N1', 'N2', 'N3'].forEach((field, idx) => {
        const value = row[field];
        if (value === undefined || value === null || value === '') return;
        const input = inputs[idx + 1]; // +1 because index 0 is Particulars
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      
      // Fill K (coefficient) - index 4
      if (row.K !== undefined && row.K !== null && row.K !== '') {
        const input = inputs[4];
        if (input) {
          input.value = row.K;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      
      // Fill L, B, H (indices 5, 6, 7)
      ['L', 'B', 'H'].forEach((field, idx) => {
        const value = row[field];
        if (value === undefined || value === null || value === '') return;
        const input = inputs[idx + 5]; // L=5, B=6, H=7
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      
      await delay(300);
    }
    
    console.log('IRWCMS Auto-Fill: Completed filling all rows');
  }
  
  fillFormRows();
}

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = type;
  status.style.display = 'block';
}

function renderPreview(data) {
  previewBody.innerHTML = '';
  const cols = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'];
  
  data.forEach(row => {
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const td = document.createElement('td');
      td.textContent = row[col] ?? '';
      td.title = row[col] ?? '';
      tr.appendChild(td);
    });
    previewBody.appendChild(tr);
  });
  
  previewContainer.style.display = data.length ? 'block' : 'none';
}

// Download template functionality
document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const headers = ['Particulars', 'N1', 'N2', 'N3', 'K', 'Sign', 'L', 'B', 'H'];
  const sampleData = [
    ['Foundation excavation', '2', '1', '1', '1', '+', '10.5', '3.0', '1.5'],
    ['Backfill work', '1', '1', '1', '1', '+', '8.0', '2.5', '1.0']
  ];
  
  const csvContent = [
    headers.join(','),
    ...sampleData.map(row => row.join(','))
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'irwcms_template.csv';
  a.click();
  URL.revokeObjectURL(url);
});