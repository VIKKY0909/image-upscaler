/* ═══════════════════════════════════════════════════════════════
   CloudScale app.js — v2
   Light UI + parallel processing (faster)
═══════════════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG ─────────────────────────────────────────────────────
const CFG_KEY = 'cloudscale_v2';
function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; } }
function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

// ── STATE ──────────────────────────────────────────────────────
let files = [];
let running = false;
let zipBlob = null, zipName = '';
let stats = { total: 0, processing: 0, completed: 0, errors: 0 };

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const folderInput = $('folderInput');
const emptyState = $('emptyState');
const sidebar = $('sidebar');
const gridArea = $('gridArea');
const imageGrid = $('imageGrid');
const startBtn = $('startBtn');
const downloadBtn = $('downloadBtn');
const clearBtn = $('clearBtn');
const settingsBtn = $('settingsBtn');
const modalBackdrop = $('modalBackdrop');
const modalClose = $('modalClose');
const saveSettings = $('saveSettings');
const cloudNameIn = $('cloudName');
const presetIn = $('uploadPreset');
const concurrencyIn = $('concurrency');
const statFolder = $('statFolder');
const statTotal = $('statTotal');
const statProcessing = $('statProcessing');
const statCompleted = $('statCompleted');
const statErrors = $('statErrors');
const creditEst = $('creditEst');

// ── ALLOWED TYPES ──────────────────────────────────────────────
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

// ── TOASTS ─────────────────────────────────────────────────────
function toast(msg, type = 'info', ms = 4000) {
  const w = $('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ── SETTINGS ──────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  const c = loadCfg();
  cloudNameIn.value = c.cloudName || '';
  presetIn.value = c.uploadPreset || '';
  concurrencyIn.value = c.concurrency ?? 2;
  modalBackdrop.hidden = false;
});
modalClose.addEventListener('click', () => modalBackdrop.hidden = true);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) modalBackdrop.hidden = true; });
saveSettings.addEventListener('click', () => {
  const c = { cloudName: cloudNameIn.value.trim(), uploadPreset: presetIn.value.trim(), concurrency: parseInt(concurrencyIn.value) || 2 };
  if (!c.cloudName || !c.uploadPreset) { toast('Fill in Cloud Name and Upload Preset.', 'error'); return; }
  saveCfg(c);
  modalBackdrop.hidden = true;
  toast('Settings saved ✓', 'success');
});

// ── FOLDER SELECT ──────────────────────────────────────────────
folderInput.addEventListener('change', e => {
  const imgs = Array.from(e.target.files).filter(f => ALLOWED.includes(f.type));
  if (!imgs.length) { toast('No supported images found.', 'error'); return; }
  loadImages(imgs);
});

function loadImages(imgs) {
  files = imgs;
  stats = { total: imgs.length, processing: 0, completed: 0, errors: 0 };
  zipBlob = null; zipName = '';
  downloadBtn.hidden = true;
  renderSidebar();
  renderGrid();
  emptyState.hidden = true;
  sidebar.hidden = false;
  gridArea.hidden = false;
}

// ── SIDEBAR ────────────────────────────────────────────────────
function renderSidebar() {
  const folder = files[0]?.webkitRelativePath?.split('/')[0] || 'images';
  statFolder.textContent = folder.length > 16 ? folder.slice(0, 14) + '…' : folder;
  statTotal.textContent = stats.total;
  statProcessing.textContent = stats.processing;
  statCompleted.textContent = stats.completed;
  statErrors.textContent = stats.errors;
  creditEst.textContent = stats.total;
}
function updateStats(delta) {
  Object.assign(stats, delta);
  statProcessing.textContent = stats.processing;
  statCompleted.textContent = stats.completed;
  statErrors.textContent = stats.errors;
}

// ── GRID ───────────────────────────────────────────────────────
function renderGrid() {
  imageGrid.innerHTML = '';
  files.forEach((f, i) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.id = `card-${i}`;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.alt = f.name;
    thumbWrap.appendChild(img);

    // status badge
    const badge = document.createElement('div');
    badge.className = 'card-badge wait';
    badge.id = `badge-${i}`;
    badge.textContent = '○';
    thumbWrap.appendChild(badge);

    const info = document.createElement('div');
    info.className = 'card-info';

    const filename = document.createElement('div');
    filename.className = 'card-filename';
    filename.innerHTML = `<span>▣</span> ${f.name}`;

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const sizeEl = document.createElement('span');
    sizeEl.className = 'card-size';
    sizeEl.textContent = fmtBytes(f.size);
    const statusTxt = document.createElement('span');
    statusTxt.className = 'card-status-text wait';
    statusTxt.id = `stxt-${i}`;
    statusTxt.textContent = 'WAITING';
    meta.appendChild(sizeEl);
    meta.appendChild(statusTxt);

    const bar = document.createElement('div');
    bar.className = 'card-bar';
    bar.id = `cbar-${i}`;
    bar.innerHTML = `<div class="card-bar-fill" id="cbarf-${i}" style="width:0%"></div>`;

    info.appendChild(filename);
    info.appendChild(meta);
    info.appendChild(bar);
    card.appendChild(thumbWrap);
    card.appendChild(info);
    imageGrid.appendChild(card);
  });
}

function setCard(i, state, statusText, pct) {
  const badge = $(`badge-${i}`);
  const stxt = $(`stxt-${i}`);
  const bar = $(`cbar-${i}`);
  const barFill = $(`cbarf-${i}`);
  const card = $(`card-${i}`);

  const icons = { wait: '○', upload: '↑', scale: '⟳', done: '✓', error: '✕' };
  if (badge) { badge.className = `card-badge ${state}`; badge.textContent = icons[state] || ''; }
  if (stxt) { stxt.className = `card-status-text ${state}`; stxt.textContent = statusText; }
  if (bar) { bar.style.display = (state === 'wait' ? 'none' : 'block'); }
  if (barFill && pct != null) barFill.style.width = pct + '%';
  if (card) {
    card.classList.toggle('processing', state === 'upload' || state === 'scale');
  }
}

// ── START ──────────────────────────────────────────────────────
startBtn.addEventListener('click', startUpscaling);
clearBtn.addEventListener('click', resetAll);
downloadBtn.addEventListener('click', () => { if (zipBlob) saveAs(zipBlob, zipName); });

async function startUpscaling() {
  if (running) return;
  const cfg = loadCfg();
  if (!cfg.cloudName || !cfg.uploadPreset) {
    settingsBtn.click();
    toast('Configure Cloudinary settings first.', 'error');
    return;
  }

  running = true;
  startBtn.disabled = true;
  startBtn.textContent = '⏳ Processing…';

  const zip = new JSZip();
  const concurrency = Math.max(1, Math.min(cfg.concurrency || 2, 5));
  let completed = 0, errors = 0;

  // ── Parallel processing with concurrency limit ─────────────
  // Split files into chunks of `concurrency` size
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchIdxs = batch.map((_, j) => i + j);

    // Mark all in batch as uploading
    batchIdxs.forEach(idx => {
      setCard(idx, 'upload', 'UPLOADING', 10);
      updateStats({ processing: stats.processing + 1, completed, errors });
    });

    // Process batch in parallel
    await Promise.allSettled(
      batch.map((file, j) => processOne(file, batchIdxs[j], cfg, zip))
    ).then(results => {
      results.forEach((r, j) => {
        const idx = batchIdxs[j];
        if (r.status === 'fulfilled') {
          completed++;
          setCard(idx, 'done', 'COMPLETED', 100);
        } else {
          errors++;
          setCard(idx, 'error', 'FAILED', 0);
          toast(`Failed: ${files[idx].name}`, 'error', 5000);
        }
        updateStats({ processing: Math.max(0, stats.processing - 1), completed, errors });
      });
    });

    // Small cooldown between batches — free plan rate limit guard
    // Only wait if there are more batches remaining
    if (i + concurrency < files.length) await sleep(600);
  }

  // ── ZIP ────────────────────────────────────────────────────
  if (completed > 0) {
    startBtn.textContent = '📦 Zipping…';
    const folder = files[0]?.webkitRelativePath?.split('/')[0] || 'images';
    zipName = `${folder}_upscaled.zip`;
    zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    saveAs(zipBlob, zipName);
    downloadBtn.hidden = false;
    toast(`✓ ${completed} image(s) upscaled & downloaded!`, 'success', 6000);
  } else {
    toast('All images failed. Check your Cloudinary credentials.', 'error', 7000);
  }

  startBtn.disabled = false;
  startBtn.textContent = '⚡ Start Upscaling';
  running = false;
}

// ── PROCESS ONE IMAGE ──────────────────────────────────────────
async function processOne(file, idx, cfg, zip) {
  // Step 1: Upload
  setCard(idx, 'upload', 'UPLOADING', 15);
  const publicId = await uploadToCloudinary(file, cfg);
  setCard(idx, 'scale', 'UPSCALING…', 45);

  // Step 2: Build upscale URL and fetch
  const url = `https://res.cloudinary.com/${cfg.cloudName}/image/upload/e_upscale/${publicId}`;
  const blob = await fetchWithRetry(url);
  setCard(idx, 'done', 'COMPLETED', 100);

  // Step 3: Add to ZIP
  const ext = getExt(file.name);
  const base = file.name.replace(/\.[^.]+$/, '');
  const outName = `${base}_upscaled.${ext}`;
  zip.file(outName, blob);

  // Log public_id for manual cleanup if needed
  console.info(`[cloudscale] Uploaded: ${publicId} — delete from Cloudinary Media Library if needed.`);
}

// ── CLOUDINARY UPLOAD ──────────────────────────────────────────
async function uploadToCloudinary(file, cfg) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', cfg.uploadPreset);
  fd.append('tags', 'cloudscale_temp');

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
    method: 'POST', body: fd
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Upload HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.public_id;
}

// ── FETCH WITH RETRY ───────────────────────────────────────────
async function fetchWithRetry(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } catch (e) {
      if (t === tries - 1) throw e;
      await sleep(2000 * (t + 1)); // exponential backoff
    }
  }
}

// ── RESET ──────────────────────────────────────────────────────
function resetAll() {
  if (running) return;
  files = []; zipBlob = null; zipName = '';
  imageGrid.innerHTML = '';
  stats = { total: 0, processing: 0, completed: 0, errors: 0 };
  emptyState.hidden = false;
  sidebar.hidden = true;
  gridArea.hidden = true;
  downloadBtn.hidden = true;
  folderInput.value = '';
}

// ── UTILS ──────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function getExt(name) { const p = name.split('.'); return p.length > 1 ? p.pop().toLowerCase() : 'jpg'; }

// ── INIT ───────────────────────────────────────────────────────
(function () {
  const c = loadCfg();
  if (!c.cloudName || !c.uploadPreset) {
    setTimeout(() => toast('👋 Click ⚙ Settings to add your Cloudinary credentials first.', 'info', 7000), 600);
  }
})();
