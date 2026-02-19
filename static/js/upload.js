// SolarGuard — Upload JS (Folder-aware)

const uploadZone    = document.getElementById('uploadZone');
const folderInput   = document.getElementById('folderInput');
const fileInput     = document.getElementById('fileInput');
const uploadInner   = document.getElementById('uploadInner');
const filePreview   = document.getElementById('filePreview');
const fileList      = document.getElementById('fileList');
const folderName    = document.getElementById('folderName');
const folderCount   = document.getElementById('folderCount');
const clearBtn      = document.getElementById('clearBtn');
const analyzeBtn    = document.getElementById('analyzeBtn');
const readyHint     = document.getElementById('readyHint');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingStatus  = document.getElementById('loadingStatus');
const progressFill   = document.getElementById('progressFill');
const progressCount  = document.getElementById('progressCount');

const VALID_EXT = /\.(png|jpg|jpeg|tif|tiff|bmp)$/i;
const PREVIEW_LIMIT = 80;

let selectedFiles = [];
let sourceName = '';

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};
const totalSize = (files) => files.reduce((sum, f) => sum + f.size, 0);

// Button wiring
document.getElementById('folderBtn').addEventListener('click', () => folderInput.click());
document.getElementById('filesBtn').addEventListener('click', () => fileInput.click());

// Folder input (webkitdirectory)
folderInput.addEventListener('change', () => {
  const files = Array.from(folderInput.files).filter(f => VALID_EXT.test(f.name));
  const rel = folderInput.files[0]?.webkitRelativePath || '';
  sourceName = rel ? rel.split('/')[0] : 'Selected folder';
  loadFiles(files, sourceName);
});

// Individual files
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files).filter(f => VALID_EXT.test(f.name));
  sourceName = `${files.length} file${files.length !== 1 ? 's' : ''} selected`;
  loadFiles(files, sourceName);
});

// Drag & drop with folder traversal
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', (e) => {
  if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over');
});
uploadZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');

  const items = Array.from(e.dataTransfer.items || []);
  const files = [];
  let name = 'Dropped files';

  const entries = items.map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if (entries.length) {
    if (entries[0]?.isDirectory) name = entries[0].name;
    await Promise.all(entries.map(entry => traverseEntry(entry, files)));
  } else {
    Array.from(e.dataTransfer.files).forEach(f => { if (VALID_EXT.test(f.name)) files.push(f); });
  }

  sourceName = name;
  loadFiles(files, name);
});

async function traverseEntry(entry, out) {
  if (entry.isFile) {
    const file = await new Promise(res => entry.file(res));
    if (VALID_EXT.test(file.name)) out.push(file);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let allEntries = [];
    // readEntries may need multiple calls (Chrome returns max 100 at a time)
    const readAll = () => new Promise(res => reader.readEntries(entries => {
      if (entries.length) { allEntries = allEntries.concat(entries); readAll().then(res); }
      else res();
    }));
    await readAll();
    await Promise.all(allEntries.map(e => traverseEntry(e, out)));
  }
}

function loadFiles(files, name) {
  if (!files.length) {
    showError('No valid image files found. Supported formats: PNG, JPG, TIFF, BMP');
    return;
  }
  selectedFiles = files;
  renderPreview(name);
}

function renderPreview(name) {
  uploadInner.style.display = 'none';
  filePreview.style.display = 'flex';

  folderName.textContent = name;
  folderCount.textContent = `${selectedFiles.length} image${selectedFiles.length !== 1 ? 's' : ''} · ${formatSize(totalSize(selectedFiles))}`;
  readyHint.textContent = `${selectedFiles.length} panel${selectedFiles.length !== 1 ? 's' : ''} queued`;

  const visible = selectedFiles.slice(0, PREVIEW_LIMIT);
  fileList.innerHTML = visible.map(f => {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    const fname = parts[parts.length - 1];
    const fpath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    return `
    <div class="file-item">
      <div class="file-item-dot"></div>
      <div class="file-item-name" title="${rel}">${fname}</div>
      ${fpath ? `<div class="file-item-path" title="${fpath}">${fpath}</div>` : ''}
      <div class="file-item-size">${formatSize(f.size)}</div>
    </div>`;
  }).join('');

  if (selectedFiles.length > PREVIEW_LIMIT) {
    fileList.insertAdjacentHTML('beforeend',
      `<div class="file-list-more">+ ${selectedFiles.length - PREVIEW_LIMIT} more files not shown</div>`
    );
  }
}

clearBtn.addEventListener('click', () => {
  selectedFiles = [];
  folderInput.value = '';
  fileInput.value = '';
  uploadInner.style.display = 'flex';
  filePreview.style.display = 'none';
});

const statusMessages = [
  'Initializing YOLOv8 model...',
  'Loading EL images from folder...',
  'Running defect detection...',
  'Localizing bounding boxes...',
  'Calculating health scores...',
  'Ranking panels by priority...',
  'Generating analytics data...',
  'Finalizing inspection report...'
];

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) return;

  loadingOverlay.style.display = 'flex';
  loadingStatus.textContent = statusMessages[0];
  progressFill.style.width = '0%';
  progressFill.style.background = 'linear-gradient(90deg, #F5C842, #ffd566)';
  progressCount.textContent = `0 / ${selectedFiles.length}`;

  const total = selectedFiles.length;
  let msgIdx = 0;
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % statusMessages.length;
    loadingStatus.textContent = statusMessages[msgIdx];
  }, 1400);

  let fakeProgress = 0;
  const progressInterval = setInterval(() => {
    const inc = fakeProgress < 40 ? 4 : fakeProgress < 70 ? 2 : 0.4;
    fakeProgress = Math.min(fakeProgress + inc * Math.random(), 88);
    progressFill.style.width = fakeProgress + '%';
    progressCount.textContent = `${Math.round(fakeProgress / 100 * total)} / ${total}`;
  }, 250);

  const formData = new FormData();
  selectedFiles.forEach(f => formData.append('images', f));
  formData.append('folder_name', sourceName);

  try {
    const resp = await fetch('/api/analyze', { method: 'POST', body: formData });
    clearInterval(msgInterval);
    clearInterval(progressInterval);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || `Server error ${resp.status}`);
    }

    const data = await resp.json();
    loadingStatus.textContent = `✓ Analysis complete — ${data.summary.total_panels} panels processed`;
    progressFill.style.width = '100%';
    progressFill.style.background = 'linear-gradient(90deg, #34C759, #5ddc7a)';
    progressCount.textContent = `${total} / ${total}`;

    setTimeout(() => {
      loadingOverlay.style.display = 'none';
      window.location.href = `/dashboard?session=${data.session_id}`;
    }, 700);

  } catch (err) {
    clearInterval(msgInterval);
    clearInterval(progressInterval);
    loadingOverlay.style.display = 'none';
    showError(err.message);
  }
});

function showError(msg) {
  const existing = document.getElementById('errorToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'errorToast';
  toast.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#1a1a1a;border:1px solid rgba(255,59,48,0.4);
    color:#FF3B30;padding:14px 20px;border-radius:10px;
    font-family:var(--font-mono);font-size:13px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);z-index:10000;
    display:flex;align-items:center;gap:10px;max-width:440px;
  `;
  toast.innerHTML = `<span style="font-size:16px">⚠</span> ${msg}
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;margin-left:8px;font-size:18px">×</button>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}