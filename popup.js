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
    
    await chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      data: parsedData
    });
    
    showStatus(`Filled ${parsedData.length} rows!`, 'success');
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
});

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