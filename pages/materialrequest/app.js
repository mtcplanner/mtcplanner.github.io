// ============================================================
// KONFIGURASI ENDPOINT GOOGLE APPS SCRIPT (MODULE MATERIAL REQUEST)
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzXTiknzZQk5KULVx7SQui7ur2QYgIy81pTvmTGtXH_I-pTKb2Vf6TzdrNaYeUElExF/exec";
const STORAGE_KEY_API = "MTC_MATERIAL_REQUEST_GAS_URL";
const STORAGE_KEY_SNAPSHOT = "MTC_MR_DATA_SNAPSHOT_V1";
const INITIAL_RENDER_ROW_LIMIT = 250; // Batasi DOM awal agar rendering instan

let entryColumns = [];
let allRecords = [];
let filteredRecords = [];
let dropdownLists = {};
let materialCatalog = []; // [{ code, partNo, itemName, itemSize, unit }]
let fixedAssetCatalog = []; // [{ equipmentNo, equipmentName, type, serialNo }]
let activeApprovers = []; // [{ level, nama, email, label }]
let selectedNoMr = null;
let currentView = "all"; // "all" | "detail"
let isInlineEditingDoc = false;
let activeSuggestContext = null; // { inputEl, onSelect }
let activeAssetSuggestContext = null; // { inputEl, onSelect }
let showAllRowsOverride = false;
let filterDebounceTimer = null;
let legacyMaterialCatalogTimestamp = 0;
let legacyFixedAssetCatalogTimestamp = 0;

function getGasUrl() {
  const saved = (localStorage.getItem(STORAGE_KEY_API) || "").trim();
  if (saved && !saved.includes("GANTI_DENGAN_ID_DEPLOYMENT")) return saved;
  return DEFAULT_GAS_URL;
}

function resolveUserRole() {
  const params = new URLSearchParams(window.location.search);
  const urlRole = params.get("role");
  if (urlRole) sessionStorage.setItem("MTC_USER_ROLE", urlRole.trim());
  const portalUser = window.parent && window.parent.currentUser;
  if (portalUser && portalUser.role) return String(portalUser.role).trim();
  return (sessionStorage.getItem("MTC_USER_ROLE") || localStorage.getItem("MTC_USER_ROLE") || "").trim();
}

function applyDeveloperAccess() {
  const isDev = resolveUserRole().toLowerCase() === "developer";
  const btn = document.getElementById("btnApiConfig");
  if (btn) btn.style.display = isDev ? "inline-flex" : "none";
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi")}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3400);
}

function showDocumentSaveLoading(title) {
  Swal.fire({
    title,
    html: `
      <div class="mr-save-caption" role="status" aria-live="polite">
        <span class="mr-save-live-dot"></span>
        <span>Mohon tunggu, data sedang diproses</span>
      </div>
    `,
    customClass: {
      popup: "mr-save-popup",
      title: "mr-save-title",
      htmlContainer: "mr-save-html"
    },
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });
}

async function callGasApi(payload) {
  const url = getGasUrl();
  if (!url || url.includes("GANTI_DENGAN_ID_DEPLOYMENT")) {
    if (resolveUserRole().toLowerCase() === "developer") openApiConfigModal();
    throw new Error("URL Web App GAS Material Request belum diatur.");
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      mode: "cors",
      redirect: "follow",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    throw new Error(
      "Gagal terhubung ke GAS (Failed to fetch). Pastikan Web App GAS di-deploy dengan akses 'Anyone' dan sudah di-publish versi terbaru."
    );
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("Respons GAS bukan JSON valid (cek izin akses 'Anyone' pada deployment Web App).");
  }

  if (data.status === "error") throw new Error(data.message);
  return data;
}

// ============================================================
// FORMAT TANGGAL STANDAR INDONESIA: dd/MM/yyyy
// ============================================================
function formatDateDmy(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:$|\s)/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, "0");
    const mm = String(dmy[2]).padStart(2, "0");
    const yyyy = dmy[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  const ymd = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:$|[T\s])/);
  if (ymd) {
    const yyyy = ymd[1];
    const mm = String(ymd[2]).padStart(2, "0");
    const dd = String(ymd[3]).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return raw;
}

function getTodayDmy() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getTodayIsoForInput() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function toDateInputValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:$|\s)/);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:$|[T\s])/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return "";
      year = parsed.getFullYear();
      month = parsed.getMonth() + 1;
      day = parsed.getDate();
    }
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Pre-compute search index agar filter/pencarian berjalan dalam < 5ms
function prepareRecordsSearchIndex(records) {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    r.date = formatDateDmy(r.date || "");
    r._stLow = String(r.status || "").toLowerCase();
    r._prLow = String(r.priorities || "").toLowerCase();
    r._ccLow = String(r.costCenter || "").toLowerCase();
    r._hay = `${r.date || ""} ${r.noMr || ""} ${r.materialNo || ""} ${r.itemName || ""} ${r.itemSize || ""} ${r.equipmentNo || ""} ${r.equipmentName || ""} ${r.picRequest || ""} ${r.description || ""} ${r.noPr || ""} ${r.materialCondition || ""} ${r.status || ""} ${r.approvedBy || ""}`.toLowerCase();
  }
  return records;
}

function saveLocalSnapshot() {
  try {
    const cleanRecords = allRecords.map(({ _stLow, _prLow, _ccLow, _hay, ...rest }) => rest);
    const snap = {
      ts: Date.now(),
      columns: entryColumns,
      records: cleanRecords,
      dropdowns: dropdownLists,
      approvers: activeApprovers
    };
    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(snap));
  } catch (_) {}
}

function restoreLocalSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || !Array.isArray(snap.records)) return false;

    entryColumns = Array.isArray(snap.columns) ? snap.columns : [];
    allRecords = prepareRecordsSearchIndex(snap.records);
    dropdownLists = snap.dropdowns || {};
    materialCatalog = Array.isArray(snap.materials) ? snap.materials : [];
    legacyMaterialCatalogTimestamp = Number(snap.ts) || 0;
    fixedAssetCatalog = Array.isArray(snap.assets) ? snap.assets : [];
    legacyFixedAssetCatalogTimestamp = Number(snap.ts) || 0;
    activeApprovers = Array.isArray(snap.approvers) ? snap.approvers : [];

    populateAllDropdowns();
    applyFilters(true);
    return true;
  } catch (_) {
    return false;
  }
}

function toMaterialRequestCatalog(records) {
  return records.map(record => ({
    code: String(record.code || record.bmc || "").trim(),
    partNo: String(record.partNo || "").trim(),
    itemName: String(record.itemName || "").trim(),
    itemSize: String(record.itemSize || "").trim(),
    unit: String(record.unit || "").trim()
  })).filter(record => record.code || record.itemName);
}

async function syncSharedMaterialCatalog(forceRefresh = false, fallbackRecords = []) {
  const snapshot = await MTCMaterialCatalogCache.loadCatalog({
    forceRefresh,
    fallbackRecords,
    fallbackUpdatedAt: legacyMaterialCatalogTimestamp
  });
  materialCatalog = toMaterialRequestCatalog(snapshot.records);
  if (snapshot.error) {
    showToast(`Cache Material Code ditampilkan, tetapi sinkronisasi gagal: ${snapshot.error}`, "error", "Sinkronisasi Gagal");
  }
  return snapshot;
}

function toMaterialRequestAssetCatalog(records) {
  return records.map(asset => ({
    equipmentNo: String(asset.equipmentNo || "").trim(),
    equipmentName: String(asset.equipmentName || "").trim(),
    type: String(asset.type || "").trim(),
    serialNo: String(asset.serialNo || "").trim()
  })).filter(asset => asset.equipmentNo);
}

async function syncSharedFixedAssetCatalog(forceRefresh = false, fallbackRecords = []) {
  const snapshot = await MTCFixedAssetCatalogCache.loadCatalog({
    forceRefresh,
    fallbackRecords,
    fallbackUpdatedAt: legacyFixedAssetCatalogTimestamp
  });
  fixedAssetCatalog = toMaterialRequestAssetCatalog(snapshot.records);
  if (snapshot.error) {
    showToast(`Cache Fixed Asset ditampilkan, tetapi sinkronisasi gagal: ${snapshot.error}`, "error", "Sinkronisasi Gagal");
  }
  return snapshot;
}

document.addEventListener("DOMContentLoaded", () => {
  applyDeveloperAccess();

  // 1. Render instan dari cache lokal jika tersedia, lalu sinkron di background
  const hasCached = restoreLocalSnapshot();
  const legacyCatalog = materialCatalog;
  const legacyAssets = fixedAssetCatalog;
  syncSharedMaterialCatalog(false, legacyCatalog).then(() => {
    if (legacyCatalog.length) saveLocalSnapshot();
  }).catch(error => {
    console.warn("Cache bersama MaterialCode belum tersedia.", error);
    if (legacyCatalog.length) materialCatalog = legacyCatalog;
    showToast(error.message, "error", "Sinkronisasi Material Code Gagal");
  });
  syncSharedFixedAssetCatalog(false, legacyAssets).then(() => {
    if (legacyAssets.length) saveLocalSnapshot();
  }).catch(error => {
    console.warn("Cache bersama Fixed Asset belum tersedia.", error);
    if (legacyAssets.length) fixedAssetCatalog = legacyAssets;
    showToast(error.message, "error", "Sinkronisasi Fixed Asset Gagal");
  });
  loadData(false, hasCached);

  // 2. Pasang debounce 200ms pada input search agar ketikan tidak lagging
  const searchInp = document.getElementById("filterSearch");
  if (searchInp) {
    searchInp.oninput = () => {
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => {
        showAllRowsOverride = false;
        applyFilters(true);
      }, 200);
    };
  }

  document.addEventListener("click", (e) => {
    const popup = document.getElementById("materialSuggestPopup");
    if (popup && popup.style.display !== "none") {
      if (!popup.contains(e.target) && (!activeSuggestContext || e.target !== activeSuggestContext.inputEl)) {
        hideMaterialSuggestPopup();
      }
    }

    const assetPopup = document.getElementById("assetSuggestPopup");
    if (assetPopup && assetPopup.style.display !== "none") {
      if (!assetPopup.contains(e.target) && (!activeAssetSuggestContext || e.target !== activeAssetSuggestContext.inputEl)) {
        hideAssetSuggestPopup();
      }
    }
  });
  window.addEventListener("resize", repositionMaterialSuggestPopup);
  document.addEventListener("scroll", event => {
    const popup = document.getElementById("materialSuggestPopup");
    if (popup && !popup.contains(event.target)) repositionMaterialSuggestPopup();
  }, true);
});

async function loadData(forceRefresh = false, silentBackground = false) {
  if (forceRefresh) {
    syncSharedMaterialCatalog(true).catch(error => {
      showToast(error.message, "error", "Sinkronisasi Material Code Gagal");
    });
    syncSharedFixedAssetCatalog(true).catch(error => {
      showToast(error.message, "error", "Sinkronisasi Fixed Asset Gagal");
    });
  }
  try {
    if (!silentBackground) {
      document.getElementById("entryTableBody").innerHTML =
        `<tr><td colspan="21" class="empty-box">Memuat data Material Request, Dropdown, Katalog Material Code &amp; Fixed Asset...</td></tr>`;
    } else {
      document.getElementById("mrSummaryMeta").textContent = `• Menyinkronkan data terbaru...`;
    }

    const res = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    entryColumns = Array.isArray(res.columns) ? res.columns : [];
    allRecords = prepareRecordsSearchIndex(Array.isArray(res.records) ? res.records : []);
    if (res.dropdowns) dropdownLists = res.dropdowns;
    if (!materialCatalog.length && Array.isArray(res.materials) && res.materials.length) {
      materialCatalog = toMaterialRequestCatalog(res.materials);
      MTCMaterialCatalogCache.seedCatalog(res.materials).catch(error => {
        console.warn("Katalog fallback tidak dapat disimpan ke cache bersama.", error);
      });
    }
    if (!fixedAssetCatalog.length && Array.isArray(res.assets) && res.assets.length) {
      fixedAssetCatalog = toMaterialRequestAssetCatalog(res.assets);
      MTCFixedAssetCatalogCache.seedCatalog(res.assets).catch(error => {
        console.warn("Katalog Fixed Asset fallback tidak dapat disimpan ke cache bersama.", error);
      });
    }
    if (Array.isArray(res.approvers)) activeApprovers = res.approvers;

    saveLocalSnapshot();
    populateAllDropdowns();
    applyFilters(true);

    if (!silentBackground || forceRefresh) {
      showToast(
        `Data diperbarui (${materialCatalog.length} Material Code • ${fixedAssetCatalog.length} Fixed Asset).`,
        "success"
      );
    }
  } catch (err) {
    if (!silentBackground) {
      document.getElementById("entryTableBody").innerHTML =
        `<tr><td colspan="21" class="empty-box" style="color:#dc2626;">${escapeHtml(err.message)}</td></tr>`;
    }
    showToast(err.message, "error", "Koneksi Gagal");
  }
}

// ============================================================
// DROPDOWN & ATURAN CONDITION ("On Stock" -> NO PR TERKUNCI)
// ============================================================
function getDropdownOptions(key, fallbackList) {
  const list = dropdownLists[key];
  if (Array.isArray(list) && list.length > 0) return list;
  return fallbackList;
}

function fillSelectOptions(selectId, options, includeAllLabel = null) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = sel.value;
  let html = "";
  if (includeAllLabel) {
    html += `<option value="ALL">${escapeHtml(includeAllLabel)}</option>`;
  }
  options.forEach(opt => {
    html += `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`;
  });
  sel.innerHTML = html;
  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  }
}

function populateAllDropdowns() {
  const costCenters = getDropdownOptions("costCenter", ["Maintenance", "Welder"]);
  const statuses = getDropdownOptions("status", ["Open", "Pending", "Done", "Close"]);
  if (!statuses.some(s => s.toLowerCase() === "open")) statuses.unshift("Open");
  const events = getDropdownOptions("event", ["Repair", "Service", "Overhaul", "Predictive", "Backlog", "Idle Asset"]);
  const priorities = getDropdownOptions("priorities", ["P1-Low", "P2-Medium", "P3-Urgent"]);

  fillSelectOptions("filterStatus", statuses, "Semua Status");
  fillSelectOptions("filterPriority", priorities, "Semua Priority");
  fillSelectOptions("filterCostCenter", costCenters, "Semua Cost Center");

  fillSelectOptions("mrCostCenter", costCenters);
  fillSelectOptions("mrEvent", events);
  fillSelectOptions("mrPriorities", priorities);
}

function isOnStockCondition(condVal) {
  return String(condVal || "").trim().toLowerCase() === "on stock";
}

function syncRowConditionNoPr(condSelectEl, noPrInputEl) {
  if (!condSelectEl || !noPrInputEl) return;
  if (isOnStockCondition(condSelectEl.value)) {
    noPrInputEl.value = "";
    noPrInputEl.disabled = true;
    noPrInputEl.placeholder = "Tidak perlu PR";
  } else {
    noPrInputEl.disabled = false;
    noPrInputEl.placeholder = "No PR...";
  }
}

// ============================================================
// AUTOCOMPLETE & VALIDASI KETAT KATALOG FIXED ASSET
// ============================================================
function searchFixedAssetCatalog(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return fixedAssetCatalog.slice(0, 35);
  const out = [];
  for (let i = 0; i < fixedAssetCatalog.length; i++) {
    const a = fixedAssetCatalog[i];
    if (
      String(a.equipmentNo || "").toLowerCase().includes(q) ||
      String(a.equipmentName || "").toLowerCase().includes(q) ||
      String(a.type || "").toLowerCase().includes(q) ||
      String(a.serialNo || "").toLowerCase().includes(q)
    ) {
      out.push(a);
      if (out.length >= 40) break;
    }
  }
  return out;
}

function getOrCreateAssetPopup() {
  let popup = document.getElementById("assetSuggestPopup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "assetSuggestPopup";
    popup.className = "asset-suggest-popup";
    popup.style.display = "none";
    document.body.appendChild(popup);
  }
  return popup;
}

function showAssetSuggestPopup(inputEl, onSelectCallback) {
  const popup = getOrCreateAssetPopup();
  if (!inputEl) return;

  hideMaterialSuggestPopup();
  activeAssetSuggestContext = { inputEl, onSelect: onSelectCallback };
  const matches = searchFixedAssetCatalog(inputEl.value);

  const rect = inputEl.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 380))}px`;
  popup.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 250)}px`;

  if (matches.length === 0) {
    popup.innerHTML = `<div class="mat-suggest-empty">Tidak ditemukan di database Fixed Asset (tidak dapat diinput).</div>`;
  } else {
    popup.innerHTML = matches.map((a, idx) => `
      <div class="mat-suggest-item" data-idx="${idx}" onmousedown="selectAssetFromPopup(${idx})">
        <div class="mat-suggest-top">
          <span class="mat-suggest-code">${escapeHtml(a.equipmentNo || "-")}</span>
          <span class="mat-suggest-size">${escapeHtml([a.type, a.serialNo].filter(Boolean).join(" • ") || "Fixed Asset")}</span>
        </div>
        <div class="mat-suggest-name">${escapeHtml(a.equipmentName || "-")}</div>
      </div>
    `).join("");
  }

  popup._currentMatches = matches;
  popup.style.display = "block";
}

function hideAssetSuggestPopup() {
  const popup = document.getElementById("assetSuggestPopup");
  if (popup) popup.style.display = "none";
  activeAssetSuggestContext = null;
}

function selectAssetFromPopup(matchIndex) {
  const popup = document.getElementById("assetSuggestPopup");
  if (!popup || !popup._currentMatches || !activeAssetSuggestContext) return;
  const asset = popup._currentMatches[matchIndex];
  if (!asset) return;
  if (typeof activeAssetSuggestContext.onSelect === "function") {
    activeAssetSuggestContext.onSelect(asset);
  }
  hideAssetSuggestPopup();
}

function validateStrictEquipmentPair(eqNoVal, eqNameVal) {
  const noClean = String(eqNoVal || "").trim();
  const nameClean = String(eqNameVal || "").trim().toLowerCase();
  if (!noClean && !nameClean) return null;

  return fixedAssetCatalog.find(a => {
    const aNo = String(a.equipmentNo || "").trim();
    const aName = String(a.equipmentName || "").trim().toLowerCase();
    if (noClean && nameClean) return aNo === noClean && aName === nameClean;
    if (noClean) return aNo === noClean;
    return aName === nameClean;
  }) || null;
}

function bindEquipmentPairInputs(eqNoEl, eqNameEl) {
  if (!eqNoEl || !eqNameEl || eqNoEl.dataset.assetBound === "1") return;
  eqNoEl.dataset.assetBound = "1";
  eqNameEl.dataset.assetBound = "1";

  const applyAsset = (asset) => {
    eqNoEl.value = String(asset.equipmentNo || "").trim();
    eqNameEl.value = String(asset.equipmentName || "").trim();
    eqNoEl.classList.remove("invalid-match");
    eqNameEl.classList.remove("invalid-match");
    eqNoEl.classList.add("valid-match");
    eqNameEl.classList.add("valid-match");
  };

  eqNoEl.addEventListener("focus", () => showAssetSuggestPopup(eqNoEl, applyAsset));
  eqNoEl.addEventListener("input", () => {
    const exactNo = fixedAssetCatalog.find(a => String(a.equipmentNo || "").trim() === String(eqNoEl.value).trim());
    if (exactNo) {
      applyAsset(exactNo);
    } else {
      eqNoEl.classList.remove("valid-match");
      eqNameEl.value = "";
      eqNameEl.classList.remove("valid-match");
    }
    showAssetSuggestPopup(eqNoEl, applyAsset);
  });

  eqNameEl.addEventListener("focus", () => showAssetSuggestPopup(eqNameEl, applyAsset));
  eqNameEl.addEventListener("input", () => {
    const exactName = fixedAssetCatalog.find(
      a => String(a.equipmentName || "").trim().toLowerCase() === String(eqNameEl.value).trim().toLowerCase()
    );
    if (exactName) {
      applyAsset(exactName);
    } else {
      eqNameEl.classList.remove("valid-match");
      eqNoEl.value = "";
      eqNoEl.classList.remove("valid-match");
    }
    showAssetSuggestPopup(eqNameEl, applyAsset);
  });
}

// ============================================================
// AUTOCOMPLETE & VALIDASI KETAT KATALOG MATERIAL CODE
// ============================================================
function searchMaterialCatalog(query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (let i = 0; i < materialCatalog.length; i++) {
    const m = materialCatalog[i];
    const values = [m.code, m.itemName, m.itemSize, m.partNo, m.unit]
      .map(value => String(value || "").toLowerCase());
    if (terms.every(term => values.some(value => value.includes(term)))) {
      out.push(m);
      if (out.length >= 40) break;
    }
  }
  return out;
}

function positionMaterialSuggestPopup(popup, inputEl) {
  const rect = inputEl.getBoundingClientRect();
  const margin = 8;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableWidth = Math.max(0, viewportWidth - margin * 2);
  const width = Math.min(560, availableWidth, Math.max(rect.width, Math.min(380, availableWidth)));
  const aboveSpace = Math.max(0, rect.top - margin - 4);
  const belowSpace = Math.max(0, viewportHeight - rect.bottom - margin - 4);

  popup.style.width = `${width}px`;
  popup.style.minWidth = `${Math.min(380, availableWidth)}px`;
  popup.style.maxWidth = `${availableWidth}px`;
  popup.style.left = `${Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))}px`;
  popup.style.maxHeight = "250px";
  popup.style.display = "block";

  const desiredHeight = Math.min(250, popup.scrollHeight);
  const placeAbove = belowSpace < desiredHeight && aboveSpace > belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  popup.style.maxHeight = `${Math.max(40, Math.min(250, availableHeight))}px`;
  const popupHeight = popup.getBoundingClientRect().height;
  popup.style.top = `${placeAbove
    ? Math.max(margin, rect.top - popupHeight - 4)
    : rect.bottom + 4}px`;
}

function repositionMaterialSuggestPopup() {
  const popup = document.getElementById("materialSuggestPopup");
  if (popup && popup.style.display !== "none" && activeSuggestContext) {
    positionMaterialSuggestPopup(popup, activeSuggestContext.inputEl);
  }
}

function showMaterialSuggestPopup(inputEl, onSelectCallback) {
  const popup = document.getElementById("materialSuggestPopup");
  if (!popup || !inputEl) return;

  if (!inputEl.value.trim()) {
    hideMaterialSuggestPopup();
    return;
  }

  hideAssetSuggestPopup();
  activeSuggestContext = { inputEl, onSelect: onSelectCallback };
  const matches = searchMaterialCatalog(inputEl.value);

  if (matches.length === 0) {
    popup.innerHTML = `<div class="mat-suggest-empty">Tidak ditemukan di database Material Code (tidak dapat diinput).</div>`;
  } else {
    popup.innerHTML = matches.map((m, idx) => `
      <div class="mat-suggest-item" data-idx="${idx}" onmousedown="selectMaterialFromPopup(${idx})">
        <div class="mat-suggest-top">
          <span class="mat-suggest-code">${escapeHtml(m.code)}</span>
          <span class="mat-suggest-size">Size: ${escapeHtml(m.itemSize || "-")} • ${escapeHtml(m.unit || "-")}</span>
        </div>
        <div class="mat-suggest-name">${escapeHtml(m.itemName)}</div>
      </div>
    `).join("");
  }

  popup._currentMatches = matches;
  positionMaterialSuggestPopup(popup, inputEl);
}

function hideMaterialSuggestPopup() {
  const popup = document.getElementById("materialSuggestPopup");
  if (popup) popup.style.display = "none";
  activeSuggestContext = null;
}

function selectMaterialFromPopup(matchIndex) {
  const popup = document.getElementById("materialSuggestPopup");
  if (!popup || !popup._currentMatches || !activeSuggestContext) return;
  const mat = popup._currentMatches[matchIndex];
  if (!mat) return;
  if (typeof activeSuggestContext.onSelect === "function") {
    activeSuggestContext.onSelect(mat);
  }
  hideMaterialSuggestPopup();
}

function validateStrictMaterialPair(codeVal, nameVal) {
  const c = String(codeVal || "").trim();
  const n = String(nameVal || "").trim().toLowerCase();
  if (!c || !n) return null;
  return materialCatalog.find(m =>
    String(m.code || "").trim() === c &&
    String(m.itemName || "").trim().toLowerCase() === n
  ) || null;
}

function bindCatalogPairToContainer(containerEl, selectors, isCreateModal = true) {
  const codeInp = containerEl.querySelector(selectors.code);
  const nameInp = containerEl.querySelector(selectors.name);
  const sizeInp = containerEl.querySelector(selectors.size);
  const unitInp = containerEl.querySelector(selectors.unit);
  const inputCls = isCreateModal ? "modal-input" : "inline-input";

  const applyMat = (mat) => {
    if (codeInp) {
      codeInp.value = String(mat.code).trim();
      codeInp.classList.remove(`${inputCls}-invalid`, "invalid-match");
      codeInp.classList.add("valid-match");
    }
    if (nameInp) {
      nameInp.value = mat.itemName;
      nameInp.classList.remove("invalid-match");
      nameInp.classList.add("valid-match");
    }
    if (sizeInp) sizeInp.value = mat.itemSize || "-";
    if (unitInp) unitInp.value = mat.unit || "-";
  };

  if (codeInp) {
    codeInp.addEventListener("focus", () => {
      if (codeInp.value.trim()) showMaterialSuggestPopup(codeInp, applyMat);
    });
    codeInp.addEventListener("input", () => {
      if (!codeInp.value.trim()) {
        codeInp.classList.remove("valid-match", "invalid-match");
        if (nameInp) {
          nameInp.value = "";
          nameInp.classList.remove("valid-match", "invalid-match");
        }
        if (sizeInp) sizeInp.value = "";
        if (unitInp) unitInp.value = "";
        hideMaterialSuggestPopup();
        return;
      }
      const exact = materialCatalog.find(m => String(m.code).trim() === String(codeInp.value).trim());
      if (exact) {
        applyMat(exact);
      } else {
        codeInp.classList.remove("valid-match");
        if (nameInp) {
          nameInp.value = "";
          nameInp.classList.remove("valid-match");
        }
        if (sizeInp) sizeInp.value = "";
        if (unitInp) unitInp.value = "";
      }
      showMaterialSuggestPopup(codeInp, applyMat);
    });
  }

  if (nameInp) {
    nameInp.addEventListener("focus", () => {
      if (nameInp.value.trim()) showMaterialSuggestPopup(nameInp, applyMat);
    });
    nameInp.addEventListener("input", () => {
      if (!nameInp.value.trim()) {
        nameInp.classList.remove("valid-match", "invalid-match");
        if (codeInp) {
          codeInp.value = "";
          codeInp.classList.remove("valid-match", "invalid-match");
        }
        if (sizeInp) sizeInp.value = "";
        if (unitInp) unitInp.value = "";
        hideMaterialSuggestPopup();
        return;
      }
      const valid = validateStrictMaterialPair(codeInp ? codeInp.value : "", nameInp.value);
      if (!valid) {
        nameInp.classList.remove("valid-match");
        if (codeInp) {
          codeInp.value = "";
          codeInp.classList.remove("valid-match");
        }
        if (sizeInp) sizeInp.value = "";
        if (unitInp) unitInp.value = "";
      }
      showMaterialSuggestPopup(nameInp, applyMat);
    });
  }
}

// ============================================================
// FILTER, KPI, DAFTAR DOKUMEN MR & RENDER TABEL MERGED HEADER
// ============================================================
function applyFilters(fromDebounce = false) {
  if (!fromDebounce) showAllRowsOverride = false;

  const stVal = document.getElementById("filterStatus").value.toLowerCase();
  const prVal = document.getElementById("filterPriority").value.toLowerCase();
  const ccVal = document.getElementById("filterCostCenter").value.toLowerCase();
  const q = document.getElementById("filterSearch").value.trim().toLowerCase();

  const out = [];
  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (stVal !== "all" && (r._stLow || String(r.status || "").toLowerCase()) !== stVal) continue;
    if (prVal !== "all" && (r._prLow || String(r.priorities || "").toLowerCase()) !== prVal) continue;
    if (ccVal !== "all" && (r._ccLow || String(r.costCenter || "").toLowerCase()) !== ccVal) continue;
    if (q && !(r._hay || "").includes(q)) continue;
    out.push(r);
  }
  filteredRecords = out;

  updateKpis();
  renderMrList();

  if (currentView === "all") {
    renderEntryTableMerged();
  } else {
    renderMrDetail();
  }
}

function updateKpis() {
  const uniqueMrs = new Set();
  let pending = 0;
  let done = 0;
  let urgent = 0;

  for (let i = 0; i < filteredRecords.length; i++) {
    const r = filteredRecords[i];
    const noMr = String(r.noMr || "").trim();
    if (noMr) uniqueMrs.add(noMr);

    const st = r._stLow || String(r.status || "").toLowerCase();
    const pr = r._prLow || String(r.priorities || "").toLowerCase();
    if (st.includes("pending") || st.includes("open")) pending++;
    if (st.includes("done") || st.includes("close")) done++;
    if (pr.includes("urgent") || pr.includes("p3")) urgent++;
  }

  document.getElementById("kpiTotalMr").textContent = uniqueMrs.size;
  document.getElementById("kpiPending").textContent = pending;
  document.getElementById("kpiDone").textContent = done;
  document.getElementById("kpiUrgent").textContent = urgent;
  document.getElementById("mrSummaryMeta").textContent = `• ${filteredRecords.length} Baris Request`;
}

function renderMrList() {
  const container = document.getElementById("mrListContainer");
  const groups = new Map();

  for (let i = 0; i < filteredRecords.length; i++) {
    const r = filteredRecords[i];
    const key = String(r.noMr || "").trim() || "(Tanpa No MR)";
    let g = groups.get(key);
    if (!g) {
      g = {
        noMr: key,
        date: formatDateDmy(r.date) || "-",
        equipment: [r.equipmentNo, r.equipmentName].filter(Boolean).join(" - ") || r.description || "-",
        pic: r.picRequest || "-",
        itemCount: 0
      };
      groups.set(key, g);
    }
    g.itemCount++;
  }

  const arr = Array.from(groups.values());
  document.getElementById("mrListCount").textContent = arr.length;

  if (arr.length === 0) {
    container.innerHTML = `<div class="empty-box">Tidak ada dokumen MR ditemukan.</div>`;
    return;
  }

  const parts = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const g = arr[i];
    const isActive = selectedNoMr === g.noMr;
    parts[i] = `
      <div class="mr-card-item ${isActive ? "active" : ""}" onclick="selectMrDocument('${escapeJsStr(g.noMr)}')">
        <div class="mr-card-top">
          <span class="mr-no">${escapeHtml(g.noMr)}</span>
          <span class="badge-count">${g.itemCount} Item</span>
        </div>
        <div class="mr-eq">${escapeHtml(g.equipment)}</div>
        <div class="mr-sub">${escapeHtml(g.date)} • ${escapeHtml(g.pic)}</div>
      </div>
    `;
  }
  container.innerHTML = parts.join("");
}

function selectMrDocument(noMr) {
  isInlineEditingDoc = false;
  selectedNoMr = noMr;
  document.getElementById("activeMrInfo").textContent = `Dokumen MR: ${noMr}`;
  renderMrList();
  switchView("detail");
}

function switchView(mode) {
  currentView = mode;
  if (mode === "all") {
    isInlineEditingDoc = false;
    document.getElementById("activeMrInfo").textContent = "Semua Dokumen MR";
    renderEntryTableMerged();
  } else {
    renderMrDetail();
  }
  document.getElementById("tabBtnAll").classList.toggle("active", mode === "all");
  document.getElementById("tabBtnDetail").classList.toggle("active", mode === "detail");
  document.getElementById("viewAll").classList.toggle("active", mode === "all");
  document.getElementById("viewDetail").classList.toggle("active", mode === "detail");
}

function getStatusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("done")) return "pill-done";
  if (s.includes("close")) return "pill-close";
  if (s.includes("open")) return "pill-open";
  return "pill-pending";
}

function getPriorityPillClass(priority) {
  const p = String(priority || "").toLowerCase();
  if (p.includes("urgent") || p.includes("p3")) return "pill-urgent";
  if (p.includes("medium") || p.includes("p2")) return "pill-pending";
  return "pill-info";
}

function formatWrapCell(value, maxLen = 69, extraAttrs = "", extraClasses = "") {
  const str = String(value ?? "");
  const isLong = str.length > maxLen;
  const wrapClass = isLong ? " wrap-cell" : "";
  const clsAttr = ` class="${`${extraClasses}${wrapClass}`.trim()}"`;
  return `<td${clsAttr}${extraAttrs}>${escapeHtml(str)}</td>`;
}

function expandAllTableRows() {
  showAllRowsOverride = true;
  renderEntryTableMerged();
}

function renderEntryTableMerged() {
  const tbody = document.getElementById("entryTableBody");
  if (filteredRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="21" class="empty-box">Belum ada data Material Request pada sheet Entry.</td></tr>`;
    return;
  }

  const isTruncated = !showAllRowsOverride && filteredRecords.length > INITIAL_RENDER_ROW_LIMIT;
  const recordsToRender = isTruncated
    ? filteredRecords.slice(filteredRecords.length - INITIAL_RENDER_ROW_LIMIT)
    : filteredRecords;

  const blocks = [];
  for (let i = 0; i < recordsToRender.length; i++) {
    const r = recordsToRender[i];
    const mrKey = String(r.noMr || "").trim() || `__ROW_${r.rowIndex}`;
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.mrKey === mrKey) {
      lastBlock.rows.push(r);
    } else {
      blocks.push({ mrKey, rows: [r] });
    }
  }

  let seqNo = isTruncated ? (filteredRecords.length - recordsToRender.length) : 0;
  const htmlRows = [];

  if (isTruncated) {
    htmlRows.push(`
      <tr>
        <td colspan="21" style="background:#f0f9ff; text-align:center; padding:8px; font-weight:700; color:#0369a1;">
          Menampilkan ${recordsToRender.length} baris terakhir dari ${filteredRecords.length} total baris agar halaman ringan.
          <button type="button" class="btn btn-primary btn-sm" style="margin-left:8px;" onclick="expandAllTableRows()">
            Tampilkan Semua (${filteredRecords.length} Baris)
          </button>
        </td>
      </tr>
    `);
  }

  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    const span = blk.rows.length;
    const head = blk.rows[0];
    const docTarget = String(head.noMr || "").trim();
    const headDateFormatted = formatDateDmy(head.date) || "-";

    for (let idxInBlock = 0; idxInBlock < span; idxInBlock++) {
      const r = blk.rows[idxInBlock];
      seqNo++;
      const isFirst = idxInBlock === 0;
      const rsAttr = span > 1 ? ` rowspan="${span}"` : "";
      const mergedCls = span > 1 ? "merged-header-cell" : "";

      const headerCellsHtml = isFirst ? `
        <td class="text-center ${mergedCls}"${rsAttr}>${escapeHtml(headDateFormatted)}</td>
        <td class="text-center fw-bold ${mergedCls}"${rsAttr} style="color:var(--primary);">${escapeHtml(head.noMr || "-")}</td>
        <td class="text-center ${mergedCls}"${rsAttr}>${escapeHtml(head.equipmentNo || "")}</td>
        <td class="${mergedCls}"${rsAttr}>${escapeHtml(head.equipmentName || "")}</td>
        ${formatWrapCell(head.description || "", 69, rsAttr, mergedCls)}
        <td class="${mergedCls}"${rsAttr}>${escapeHtml(head.picRequest || "")}</td>
        <td class="text-center ${mergedCls}"${rsAttr}>${escapeHtml(head.costCenter || "")}</td>
        <td class="text-center ${mergedCls}"${rsAttr}><span class="pill-badge ${getPriorityPillClass(head.priorities)}">${escapeHtml(head.priorities || "-")}</span></td>
        <td class="text-center ${mergedCls}"${rsAttr}>${escapeHtml(head.event || "")}</td>
      ` : "";

      htmlRows.push(`
        <tr class="clickable-row" onclick="onEntryRowJump('${escapeJsStr(docTarget)}')">
          <td class="text-center">${seqNo}</td>
          ${headerCellsHtml}
          <td class="text-center code-mono">${escapeHtml(String(r.materialNo || ""))}</td>
          ${formatWrapCell(r.itemName || "", 69, "", "fw-bold")}
          <td class="text-center">${escapeHtml(r.itemSize || "")}</td>
          <td class="text-center fw-bold">${r.qty ?? 0}</td>
          <td class="text-center">${escapeHtml(r.unit || "")}</td>
          <td class="text-center">${escapeHtml(r.materialCondition || "")}</td>
          <td class="text-center">${escapeHtml(r.noPr || "")}</td>
          <td class="text-center">${r.qtyReceived ?? 0}</td>
          <td class="text-center fw-bold">${r.remainingQty ?? 0}</td>
          <td class="text-center"><span class="pill-badge ${getStatusPillClass(r.status)}">${escapeHtml(r.status || "-")}</span></td>
          ${formatWrapCell(r.remarks || "", 69, "", "")}
        </tr>
      `);
    }
  }

  tbody.innerHTML = htmlRows.join("");
}

function onEntryRowJump(noMr) {
  if (!noMr) return;
  selectMrDocument(noMr);
}

// ============================================================
// TAB RINCIAN DOKUMEN MR: MODE BACA & MODE INLINE EDIT + TAMBAH ITEM
// ============================================================
function startInlineEditDocument() {
  isInlineEditingDoc = true;
  renderMrDetail();
}

function cancelInlineEditDocument() {
  isInlineEditingDoc = false;
  hideMaterialSuggestPopup();
  hideAssetSuggestPopup();
  renderMrDetail();
}

function buildSelectHtml(options, selectedVal, cls = "inline-select", extraAttrs = "") {
  const opts = Array.isArray(options) && options.length > 0 ? options : [selectedVal].filter(Boolean);
  const allOpts = selectedVal && !opts.includes(selectedVal) ? [selectedVal, ...opts] : opts;
  return `<select class="${cls}" ${extraAttrs}>` +
    allOpts.map(o => `<option value="${escapeHtml(o)}" ${String(o) === String(selectedVal) ? "selected" : ""}>${escapeHtml(o)}</option>`).join("") +
    `</select>`;
}

function renderMrDetail() {
  const container = document.getElementById("mrDetailBody");
  if (!selectedNoMr) {
    container.innerHTML = `<div class="empty-box">Pilih nomor Material Request di panel kiri atau klik baris data untuk melihat detail item.</div>`;
    return;
  }

  const lines = allRecords.filter(r => String(r.noMr || "").trim() === selectedNoMr);
  if (lines.length === 0) {
    container.innerHTML = `<div class="empty-box">Dokumen MR tidak ditemukan.</div>`;
    return;
  }

  const appInfo = getDocumentApprovalSummary(lines);
  const checkIconHtml = appInfo.isFullApproved
    ? `<button type="button" class="approval-check-btn approved" onclick="showApprovalInfoPopup('${escapeJsStr(selectedNoMr)}')" title="Full Approved (${appInfo.approvedActorsCount}/${appInfo.requiredApproversCount} approver) — Klik untuk lihat detail">
         <i class="bi bi-check-circle-fill"></i>
       </button>`
    : `<button type="button" class="approval-check-btn pending" onclick="showApprovalInfoPopup('${escapeJsStr(selectedNoMr)}')" title="Approval ${appInfo.approvedActorsCount}/${appInfo.requiredApproversCount} approver — Klik untuk lihat detail">
         <i class="bi bi-check-circle-fill"></i>
       </button>`;
  const head = lines[0];
  const headDateFormatted = formatDateDmy(head.date) || "-";

  if (!isInlineEditingDoc) {
    container.innerHTML = `
      <div class="doc-summary-box">
        <div>
          <div style="font-size:15px; font-weight:800; display:flex; align-items:center; gap:4px;">
            <span>${escapeHtml(selectedNoMr)}</span>
            ${checkIconHtml}
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
            ${escapeHtml(head.description || "Material Request Requisition")}
          </div>
        </div>
        <div class="no-print" style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="btn btn-success btn-sm" onclick="sendApprovalMr('${escapeJsStr(selectedNoMr)}')">
            <i class="bi bi-send-check"></i> Send Approval
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.print()">
            <i class="bi bi-printer"></i> Cetak MR
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="startInlineEditDocument()">
            <i class="bi bi-pencil-square"></i> Edit
          </button>
          <button type="button" class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="confirmDeleteMr('${escapeJsStr(selectedNoMr)}')">
            <i class="bi bi-trash3"></i> Hapus Dokumen MR
          </button>
        </div>
      </div>

      <div class="doc-meta-grid">
        <div class="meta-item"><span>Date</span><strong>${escapeHtml(headDateFormatted)}</strong></div>
        <div class="meta-item"><span>No Material Request</span><strong>${escapeHtml(head.noMr || "-")}</strong></div>
        <div class="meta-item"><span>Equipment</span><strong>${escapeHtml([head.equipmentNo, head.equipmentName].filter(Boolean).join(" - ") || "-")}</strong></div>
        <div class="meta-item"><span>PIC Request</span><strong>${escapeHtml(head.picRequest || "-")}</strong></div>
        <div class="meta-item"><span>Cost Center</span><strong>${escapeHtml(head.costCenter || "-")}</strong></div>
        <div class="meta-item"><span>Priority / Event</span><strong>${escapeHtml(head.priorities || "-")} • ${escapeHtml(head.event || "-")}</strong></div>
      </div>

      <table class="mr-table">
        <thead>
          <tr>
            <th style="width:40px;">No</th>
            <th>Material No</th>
            <th>Item Name</th>
            <th>Item Size</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Condition</th>
            <th>No PR</th>
            <th>Qty Received</th>
            <th>Remaining QTY</th>
            <th>Status</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((ln, idx) => `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td class="text-center code-mono">${escapeHtml(String(ln.materialNo || ""))}</td>
              <td class="fw-bold">${escapeHtml(ln.itemName || "")}</td>
              <td class="text-center">${escapeHtml(ln.itemSize || "")}</td>
              <td class="text-center fw-bold">${ln.qty ?? 0}</td>
              <td class="text-center">${escapeHtml(ln.unit || "")}</td>
              <td class="text-center">${escapeHtml(ln.materialCondition || "")}</td>
              <td class="text-center">${escapeHtml(ln.noPr || "")}</td>
              <td class="text-center">${ln.qtyReceived ?? 0}</td>
              <td class="text-center fw-bold">${ln.remainingQty ?? 0}</td>
              <td class="text-center"><span class="pill-badge ${getStatusPillClass(ln.status)}">${escapeHtml(ln.status || "-")}</span></td>
              <td>${escapeHtml(ln.remarks || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    return;
  }

  const costCenters = getDropdownOptions("costCenter", ["Maintenance", "Welder"]);
  const priorities = getDropdownOptions("priorities", ["P1-Low", "P2-Medium", "P3-Urgent"]);
  const events = getDropdownOptions("event", ["Repair", "Service", "Overhaul", "Predictive", "Backlog", "Idle Asset"]);
  const conditions = getDropdownOptions("materialCondition", ["On Stock", "Need Order", "Ex-Used"]);
  const statuses = getDropdownOptions("status", ["Open", "Pending", "Done", "Close"]);
  ["Open", "Pending", "Close"].forEach(status => {
    if (!statuses.some(option => String(option) === status)) {
      statuses.push(status);
    }
  });

  container.innerHTML = `
    <div class="doc-summary-box">
      <div>
        <div style="font-size:14px; font-weight:800; color:var(--primary);">Mode Edit — ${escapeHtml(selectedNoMr)}</div>
        <div style="font-size:10.5px; color:var(--text-secondary);">Ubah langsung field dokumen/item atau tambah item baru ke MR ini</div>
      </div>
      <div class="no-print" style="display:flex; gap:6px; align-items:center;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="cancelInlineEditDocument()">Batal</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineDocumentEdits()">
          <i class="bi bi-check2-circle"></i> Simpan Perubahan
        </button>
      </div>
    </div>

    <div class="doc-meta-grid" id="inlineHeaderForm">
      <div class="meta-item">
        <span>Date</span>
        <input type="date" id="inlDate" class="inline-input" value="${escapeHtml(toDateInputValue(head.date))}" />
      </div>
      <div class="meta-item">
        <span>No Material Request</span>
        <input type="text" id="inlNoMr" class="inline-input fw-bold" value="${escapeHtml(head.noMr || "")}" />
      </div>
      <div class="meta-item">
        <span>Equipment No *</span>
        <input type="text" id="inlEqNo" class="inline-input" value="${escapeHtml(head.equipmentNo || "")}" placeholder="Pilih Equipment No..." autocomplete="off" />
      </div>
      <div class="meta-item">
        <span>Equipment Name *</span>
        <input type="text" id="inlEqName" class="inline-input" value="${escapeHtml(head.equipmentName || "")}" placeholder="Pilih Equipment Name..." autocomplete="off" />
      </div>
      <div class="meta-item">
        <span>PIC Request</span>
        <input type="text" id="inlPic" class="inline-input" value="${escapeHtml(head.picRequest || "")}" />
      </div>
      <div class="meta-item">
        <span>Cost Center</span>
        ${buildSelectHtml(costCenters, head.costCenter, "inline-select", 'id="inlCostCenter"')}
      </div>
      <div class="meta-item">
        <span>Priorities</span>
        ${buildSelectHtml(priorities, head.priorities, "inline-select", 'id="inlPriorities"')}
      </div>
      <div class="meta-item">
        <span>Event</span>
        ${buildSelectHtml(events, head.event, "inline-select", 'id="inlEvent"')}
      </div>
      <div class="meta-item" style="grid-column: span 2;">
        <span>Description</span>
        <input type="text" id="inlDescription" class="inline-input" value="${escapeHtml(head.description || "")}" />
      </div>
    </div>

    <div class="inline-add-bar">
      <span><i class="bi bi-list-check"></i> Daftar Item Dokumen MR (Condition &amp; No PR melekat per item)</span>
      <button type="button" class="btn btn-success btn-sm" onclick="addInlineItemRow()">
        <i class="bi bi-plus-lg"></i> Tambah Item ke MR Ini
      </button>
    </div>

    <table class="mr-table" id="inlineItemsTable">
      <thead>
        <tr>
          <th style="width:36px;">No</th>
          <th style="width:115px;">Material No</th>
          <th style="min-width:185px;">Item Name</th>
          <th style="width:125px;">Item Size</th>
          <th style="width:68px;">Qty</th>
          <th style="width:62px;">Unit</th>
          <th style="width:120px;">Condition</th>
          <th style="width:105px;">No PR</th>
          <th style="width:72px;">Qty Rec.</th>
          <th style="width:72px;">Rem. QTY</th>
          <th style="width:105px;">Status</th>
          <th style="min-width:120px;">Remarks</th>
          <th style="width:45px;">Hapus</th>
        </tr>
      </thead>
      <tbody id="inlineItemsBody">
        ${lines.map((ln, idx) => renderInlineItemRowHtml(ln, idx + 1, false, conditions, statuses)).join("")}
      </tbody>
    </table>
  `;

  const inlEqNo = document.getElementById("inlEqNo");
  const inlEqName = document.getElementById("inlEqName");
  bindEquipmentPairInputs(inlEqNo, inlEqName);
  if (validateStrictEquipmentPair(inlEqNo.value, inlEqName.value)) {
    inlEqNo.classList.add("valid-match");
    inlEqName.classList.add("valid-match");
  }

  document.querySelectorAll("#inlineItemsBody tr").forEach(tr => {
    bindInlineRowEvents(tr);
  });
}

function renderInlineItemRowHtml(itemObj, seq, isNewRow, conditions, statuses) {
  const onStock = isOnStockCondition(itemObj.materialCondition);
  const rowTypeAttr = isNewRow ? `data-is-new="1"` : `data-is-new="0" data-row-index="${itemObj.rowIndex}"`;
  const condHtml = buildSelectHtml(conditions, itemObj.materialCondition || "On Stock", "inline-select inl-cond");
  const statusHtml = buildSelectHtml(
    statuses,
    itemObj.status || "Open",
    "inline-select inl-status",
    'disabled aria-label="Status otomatis berdasarkan Qty Received"'
  );

  return `
    <tr ${rowTypeAttr}>
      <td class="text-center row-num">${seq}</td>
      <td><input type="text" class="inline-input text-center code-mono inl-code" value="${escapeHtml(String(itemObj.materialNo || ""))}" placeholder="Kode..." autocomplete="off" /></td>
      <td><input type="text" class="inline-input inl-name" value="${escapeHtml(itemObj.itemName || "")}" placeholder="Nama / ukuran (mis. Hose 3/4)..." autocomplete="off" /></td>
      <td><input type="text" class="inline-input text-center inl-size" value="${escapeHtml(itemObj.itemSize || "")}" readonly /></td>
      <td><input type="number" class="inline-input text-center inl-qty" value="${itemObj.qty ?? 1}" min="0" step="any" /></td>
      <td><input type="text" class="inline-input text-center inl-unit" value="${escapeHtml(itemObj.unit || "")}" readonly /></td>
      <td>${condHtml}</td>
      <td><input type="text" class="inline-input text-center inl-nopr" value="${onStock ? "" : escapeHtml(itemObj.noPr || "")}" ${onStock ? 'disabled placeholder="Tidak perlu PR"' : 'placeholder="No PR..."'} /></td>
      <td><input type="number" class="inline-input text-center inl-qtyrec" value="${itemObj.qtyReceived ?? 0}" min="0" max="${Number(itemObj.qty) || 0}" step="any" /></td>
      <td><input type="number" class="inline-input text-center fw-bold inl-rem" value="${itemObj.remainingQty ?? Math.max((Number(itemObj.qty) || 0) - (Number(itemObj.qtyReceived) || 0), 0)}" readonly /></td>
      <td>${statusHtml}</td>
      <td><input type="text" class="inline-input inl-remarks" value="${escapeHtml(itemObj.remarks || "")}" placeholder="Remarks..." /></td>
      <td class="text-center">
        <button type="button" class="btn-icon del" onclick="removeInlineItemRow(this)" title="Hapus Item"><i class="bi bi-x-lg"></i></button>
      </td>
    </tr>
  `;
}

function bindInlineRowEvents(tr) {
  bindCatalogPairToContainer(tr, {
    code: ".inl-code",
    name: ".inl-name",
    size: ".inl-size",
    unit: ".inl-unit"
  }, false);

  const condSel = tr.querySelector(".inl-cond");
  const noPrInp = tr.querySelector(".inl-nopr");
  if (condSel && noPrInp) {
    condSel.addEventListener("change", () => syncRowConditionNoPr(condSel, noPrInp));
  }

  const qtyInp = tr.querySelector(".inl-qty");
  const recInp = tr.querySelector(".inl-qtyrec");
  const remInp = tr.querySelector(".inl-rem");
  const recalc = () => {
    const q = Number(qtyInp ? qtyInp.value : 0) || 0;
    const r = Number(recInp ? recInp.value : 0) || 0;
    if (remInp) remInp.value = Math.max(q - r, 0);
    syncInlineReceivedStatus(tr);
  };
  if (qtyInp) qtyInp.addEventListener("input", recalc);
  if (recInp) recInp.addEventListener("input", recalc);
  recalc();
}

function getReceivedStatus(qty, qtyReceived) {
  if (qtyReceived === 0) return "Open";
  if (qtyReceived === qty) return "Close";
  return "Pending";
}

function syncInlineReceivedStatus(tr) {
  const qtyInput = tr.querySelector(".inl-qty");
  const qtyReceivedInput = tr.querySelector(".inl-qtyrec");
  const statusSelect = tr.querySelector(".inl-status");
  if (!qtyInput || !qtyReceivedInput || !statusSelect) return;

  const qty = qtyInput.value.trim() === "" ? 0 : Number(qtyInput.value);
  const qtyReceived = qtyReceivedInput.value.trim() === "" ? 0 : Number(qtyReceivedInput.value);
  const isValid = Number.isFinite(qty) && qty >= 0
    && Number.isFinite(qtyReceived) && qtyReceived >= 0 && qtyReceived <= qty;

  qtyReceivedInput.max = String(Number.isFinite(qty) && qty >= 0 ? qty : 0);
  qtyReceivedInput.classList.toggle("invalid-match", !isValid);
  if (isValid) statusSelect.value = getReceivedStatus(qty, qtyReceived);
}

let pendingDeletedRowIndices = [];

function addInlineItemRow() {
  const tbody = document.getElementById("inlineItemsBody");
  if (!tbody) return;
  const conditions = getDropdownOptions("materialCondition", ["On Stock", "Need Order", "Ex-Used"]);
  const statuses = getDropdownOptions("status", ["Open", "Pending", "Done", "Close"]);
  const seq = tbody.children.length + 1;

  const tempDiv = document.createElement("tbody");
  tempDiv.innerHTML = renderInlineItemRowHtml({
    materialNo: "",
    itemName: "",
    itemSize: "",
    qty: 1,
    unit: "",
    materialCondition: conditions[0] || "On Stock",
    noPr: "",
    qtyReceived: 0,
    remainingQty: 1,
    status: "Open",
    remarks: ""
  }, seq, true, conditions, statuses);

  const newTr = tempDiv.firstElementChild;
  tbody.appendChild(newTr);
  bindInlineRowEvents(newTr);
}

function removeInlineItemRow(btn) {
  const tr = btn.closest("tr");
  const tbody = document.getElementById("inlineItemsBody");
  if (!tr || !tbody) return;
  if (tbody.children.length <= 1) {
    return showToast("Minimal harus ada 1 item pada dokumen MR.", "error");
  }
  if (tr.getAttribute("data-is-new") !== "1") {
    const rIdx = Number(tr.getAttribute("data-row-index"));
    if (rIdx) pendingDeletedRowIndices.push(rIdx);
  }
  tr.remove();
  Array.from(tbody.children).forEach((row, i) => {
    row.querySelector(".row-num").textContent = i + 1;
  });
}

async function saveInlineDocumentEdits() {
  const rawDate = document.getElementById("inlDate").value;
  const date = formatDateDmy(rawDate);
  const noMr = document.getElementById("inlNoMr").value.trim();
  const eqNoEl = document.getElementById("inlEqNo");
  const eqNameEl = document.getElementById("inlEqName");
  const equipmentNo = eqNoEl.value.trim();
  const equipmentName = eqNameEl.value.trim();
  const picRequest = document.getElementById("inlPic").value.trim();
  const costCenter = document.getElementById("inlCostCenter").value;
  const priorities = document.getElementById("inlPriorities").value;
  const event = document.getElementById("inlEvent").value;
  const description = document.getElementById("inlDescription").value.trim();

  if (!date || !noMr || !picRequest) {
    return showToast("Date, No Material Request, dan PIC Request wajib diisi.", "error");
  }

  const validAsset = validateStrictEquipmentPair(equipmentNo, equipmentName);
  if (!validAsset) {
    eqNoEl.classList.add("invalid-match");
    eqNameEl.classList.add("invalid-match");
    return showToast(
      `Equipment "${equipmentNo} - ${equipmentName}" tidak terdaftar di database Fixed Asset.`,
      "error",
      "Validasi Fixed Asset"
    );
  }

  const trs = Array.from(document.querySelectorAll("#inlineItemsBody tr"));
  const existingItems = [];
  const newItems = [];

  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const codeInp = tr.querySelector(".inl-code");
    const nameInp = tr.querySelector(".inl-name");
    const sizeInp = tr.querySelector(".inl-size");
    const qtyInput = tr.querySelector(".inl-qty");
    const qtyReceivedInput = tr.querySelector(".inl-qtyrec");
    const qtyVal = qtyInput.value.trim() === "" ? 0 : Number(qtyInput.value);
    const unitVal = tr.querySelector(".inl-unit").value.trim();
    const condVal = tr.querySelector(".inl-cond").value;
    const noPrVal = isOnStockCondition(condVal) ? "" : tr.querySelector(".inl-nopr").value.trim();
    const qtyRecVal = qtyReceivedInput.value.trim() === "" ? 0 : Number(qtyReceivedInput.value);
    const remarksVal = tr.querySelector(".inl-remarks").value.trim();

    if (!Number.isFinite(qtyVal) || qtyVal < 0
      || !Number.isFinite(qtyRecVal) || qtyRecVal < 0 || qtyRecVal > qtyVal) {
      qtyReceivedInput.classList.add("invalid-match");
      qtyReceivedInput.focus();
      return showToast(
        `Item #${i + 1}: Qty Received harus antara 0 dan Qty Order (${Number.isFinite(qtyVal) ? qtyVal : 0}).`,
        "error",
        "Validasi Qty"
      );
    }

    qtyReceivedInput.classList.remove("invalid-match");
    const statusVal = getReceivedStatus(qtyVal, qtyRecVal);
    const rawCode = codeInp.value.trim();
    const rawName = nameInp.value.trim();

    const validMat = validateStrictMaterialPair(rawCode, rawName);
    if (!validMat) {
      codeInp.classList.add("invalid-match");
      nameInp.classList.add("invalid-match");
      return showToast(
        `Item #${i + 1}: "${rawCode} - ${rawName}" tidak ada di katalog Material Code.`,
        "error",
        "Validasi Material Code"
      );
    }

    const payloadItem = {
      materialNo: String(validMat.code).trim(),
      itemName: validMat.itemName,
      itemSize: validMat.itemSize || sizeInp.value.trim(),
      qty: qtyVal,
      unit: validMat.unit || unitVal,
      materialCondition: condVal,
      noPr: noPrVal,
      qtyReceived: qtyRecVal,
      remainingQty: Math.max(qtyVal - qtyRecVal, 0),
      status: statusVal,
      remarks: remarksVal
    };

    if (tr.getAttribute("data-is-new") === "1") {
      newItems.push(payloadItem);
    } else {
      payloadItem.rowIndex = Number(tr.getAttribute("data-row-index"));
      existingItems.push(payloadItem);
    }
  }

  if (existingItems.length + newItems.length === 0) {
    return showToast("Minimal harus ada 1 item.", "error");
  }

  const deletedIndices = [...pendingDeletedRowIndices];
  pendingDeletedRowIndices = [];

  showDocumentSaveLoading("Menyimpan Perubahan MR");

  try {
    const res = await callGasApi({
      action: "saveDocumentEdits",
      docUpdate: {
        header: {
          date,
          noMr,
          equipmentNo: validAsset.equipmentNo,
          equipmentName: validAsset.equipmentName,
          picRequest,
          costCenter,
          priorities,
          event,
          description
        },
        existingItems,
        newItems,
        deletedRowIndices: deletedIndices
      }
    });
    Swal.close();
    allRecords = prepareRecordsSearchIndex(res.records || []);
    saveLocalSnapshot();
    selectedNoMr = noMr;
    isInlineEditingDoc = false;
    applyFilters(true);
    showToast(`Perubahan dokumen ${noMr} berhasil disimpan.`, "success");
  } catch (err) {
    pendingDeletedRowIndices = deletedIndices;
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: err.message });
  }
}

// ============================================================
// MODAL BUAT MR BARU (MINIMIZE / MAXIMIZE, CONDITION & NO PR PER ITEM)
// ============================================================
function openCreateMrModal() {
  const card = document.getElementById("createMrModalCard");
  const backdrop = document.getElementById("createMrModal");
  card.classList.remove("minimized", "maximized");
  backdrop.classList.remove("minimized-backdrop");

  document.getElementById("mrDate").value = getTodayIsoForInput();
  document.getElementById("mrNo").value = "";
  document.getElementById("mrPic").value = "";

  const eqNoEl = document.getElementById("mrEqNo");
  const eqNameEl = document.getElementById("mrEqName");
  eqNoEl.value = "";
  eqNameEl.value = "";
  eqNoEl.classList.remove("valid-match", "invalid-match");
  eqNameEl.classList.remove("valid-match", "invalid-match");
  bindEquipmentPairInputs(eqNoEl, eqNameEl);

  document.getElementById("mrDescription").value = "";

  const tbody = document.getElementById("mrLinesBody");
  tbody.innerHTML = "";
  addMrLineRow();
  backdrop.classList.add("active");
}

function closeCreateMrModal() {
  hideMaterialSuggestPopup();
  hideAssetSuggestPopup();
  const card = document.getElementById("createMrModalCard");
  const backdrop = document.getElementById("createMrModal");
  card.classList.remove("minimized", "maximized");
  backdrop.classList.remove("minimized-backdrop", "active");
}

function toggleMinimizeCreateMr() {
  const card = document.getElementById("createMrModalCard");
  const backdrop = document.getElementById("createMrModal");
  card.classList.remove("maximized");
  const isMin = card.classList.toggle("minimized");
  backdrop.classList.toggle("minimized-backdrop", isMin);
  hideMaterialSuggestPopup();
  hideAssetSuggestPopup();
}

function toggleMaximizeCreateMr() {
  const card = document.getElementById("createMrModalCard");
  const backdrop = document.getElementById("createMrModal");
  card.classList.remove("minimized");
  backdrop.classList.remove("minimized-backdrop");
  card.classList.toggle("maximized");
}

function addMrLineRow() {
  const tbody = document.getElementById("mrLinesBody");
  const idx = tbody.children.length + 1;
  const conditions = getDropdownOptions("materialCondition", ["On Stock", "Need Order", "Ex-Used"]);
  const defaultCond = conditions[0] || "On Stock";
  const onStock = isOnStockCondition(defaultCond);

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="text-center row-num">${idx}</td>
    <td>
      <input type="text" class="modal-input inp-mat-code text-center code-mono" placeholder="Kode (09521)..." autocomplete="off" />
    </td>
    <td>
      <input type="text" class="modal-input inp-mat-name" placeholder="Cari nama / ukuran (mis. Hose 3/4)..." autocomplete="off" />
    </td>
    <td>
      <input type="text" class="modal-input inp-mat-size text-center" readonly placeholder="Otomatis..." style="background:#f1f5f9; font-weight:700;" />
    </td>
    <td>
      <input type="number" class="modal-input inp-qty text-center" value="1" min="0" step="any" />
    </td>
    <td>
      <input type="text" class="modal-input inp-mat-unit text-center" readonly placeholder="Unit" style="background:#f1f5f9; font-weight:700;" />
    </td>
    <td>
      ${buildSelectHtml(conditions, defaultCond, "modal-input inp-cond")}
    </td>
    <td>
      <input type="text" class="modal-input text-center inp-nopr" ${onStock ? 'disabled placeholder="Tidak perlu PR"' : 'placeholder="No PR..."'} />
    </td>
    <td>
      <input type="text" class="modal-input inp-remarks" placeholder="Remarks..." />
    </td>
    <td class="text-center">
      <button type="button" class="btn-icon del" onclick="removeMrLineRow(this)"><i class="bi bi-x-lg"></i></button>
    </td>
  `;
  tbody.appendChild(tr);

  bindCatalogPairToContainer(tr, {
    code: ".inp-mat-code",
    name: ".inp-mat-name",
    size: ".inp-mat-size",
    unit: ".inp-mat-unit"
  }, true);

  const condSel = tr.querySelector(".inp-cond");
  const noPrInp = tr.querySelector(".inp-nopr");
  condSel.addEventListener("change", () => syncRowConditionNoPr(condSel, noPrInp));
}

function removeMrLineRow(btn) {
  const tbody = document.getElementById("mrLinesBody");
  if (tbody.children.length <= 1) return;
  btn.closest("tr").remove();
  Array.from(tbody.children).forEach((tr, i) => {
    tr.querySelector(".row-num").textContent = i + 1;
  });
}

async function submitCreateMr() {
  const rawDate = document.getElementById("mrDate").value;
  const date = formatDateDmy(rawDate);
  const noMr = document.getElementById("mrNo").value.trim();
  const picRequest = document.getElementById("mrPic").value.trim();
  const costCenter = document.getElementById("mrCostCenter").value;
  const eqNoEl = document.getElementById("mrEqNo");
  const eqNameEl = document.getElementById("mrEqName");
  const equipmentNo = eqNoEl.value.trim();
  const equipmentName = eqNameEl.value.trim();
  const priorities = document.getElementById("mrPriorities").value;
  const event = document.getElementById("mrEvent").value;
  const description = document.getElementById("mrDescription").value.trim();

  if (!date || !noMr || !picRequest) {
    return showToast("Date, No Material Request, dan PIC Request wajib diisi.", "error");
  }

  const validAsset = validateStrictEquipmentPair(equipmentNo, equipmentName);
  if (!validAsset) {
    eqNoEl.classList.add("invalid-match");
    eqNameEl.classList.add("invalid-match");
    return showToast(
      `Equipment "${equipmentNo} - ${equipmentName}" tidak terdaftar di database Fixed Asset.`,
      "error",
      "Validasi Fixed Asset"
    );
  }

  const lineTrs = Array.from(document.querySelectorAll("#mrLinesBody tr"));
  const items = [];

  for (let i = 0; i < lineTrs.length; i++) {
    const tr = lineTrs[i];
    const codeInp = tr.querySelector(".inp-mat-code");
    const nameInp = tr.querySelector(".inp-mat-name");
    const qtyVal = Number(tr.querySelector(".inp-qty").value) || 0;
    const condVal = tr.querySelector(".inp-cond").value;
    const noPrVal = isOnStockCondition(condVal) ? "" : tr.querySelector(".inp-nopr").value.trim();
    const remarksVal = tr.querySelector(".inp-remarks").value.trim();

    const rawCode = codeInp.value.trim();
    const rawName = nameInp.value.trim();
    if (!rawCode && !rawName) continue;

    const validMat = validateStrictMaterialPair(rawCode, rawName);
    if (!validMat) {
      codeInp.classList.add("invalid-match");
      nameInp.classList.add("invalid-match");
      return showToast(
        `Baris #${i + 1}: Material "${rawCode} - ${rawName}" tidak ada di katalog Material Code.`,
        "error",
        "Validasi Material Code"
      );
    }

    items.push({
      materialNo: String(validMat.code).trim(),
      itemName: validMat.itemName,
      itemSize: validMat.itemSize || "",
      unit: validMat.unit || "",
      qty: qtyVal,
      materialCondition: condVal,
      noPr: noPrVal,
      qtyReceived: 0,
      remainingQty: qtyVal,
      status: "Open",
      remarks: remarksVal
    });
  }

  if (items.length === 0) {
    return showToast("Isi minimal 1 item barang yang valid dari katalog Material Code.", "error");
  }

  closeCreateMrModal();
  showDocumentSaveLoading("Menyimpan Material Request");

  try {
    const res = await callGasApi({
      action: "createMR",
      mr: {
        date,
        description,
        equipmentNo: validAsset.equipmentNo,
        equipmentName: validAsset.equipmentName,
        picRequest,
        costCenter,
        noMr,
        priorities,
        event,
        status: "Open",
        items
      }
    });
    Swal.close();
    allRecords = prepareRecordsSearchIndex(res.records || []);
    saveLocalSnapshot();
    selectedNoMr = noMr;
    isInlineEditingDoc = false;
    applyFilters(true);
    showToast(`Material Request ${noMr} (${items.length} item) berhasil disimpan dengan status Open.`, "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: err.message });
  }
}

function confirmDeleteMr(noMr) {
  Swal.fire({
    title: "Hapus Seluruh Dokumen MR?",
    text: `Semua item dengan No Material Request "${noMr}" akan dihapus.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus MR",
    cancelButtonText: "Batal",
    buttonsStyling: false,
    customClass: {
      popup: "mr-confirm-popup",
      title: "mr-confirm-title",
      htmlContainer: "mr-confirm-html",
      actions: "mr-confirm-actions",
      confirmButton: "mr-confirm-button",
      cancelButton: "mr-cancel-button"
    }
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    showDocumentSaveLoading("Menghapus Dokumen MR...");
    try {
      const res = await callGasApi({ action: "deleteMR", noMr });
      Swal.close();
      allRecords = prepareRecordsSearchIndex(res.records || []);
      saveLocalSnapshot();
      selectedNoMr = null;
      isInlineEditingDoc = false;
      applyFilters(true);
      switchView("all");
      showToast(`Dokumen ${noMr} telah dihapus.`, "success");
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err.message });
    }
  });
}

function exportToExcel() {
  if (!filteredRecords.length) return showToast("Tidak ada data untuk diexport.", "info");
  const headers = [
    "Date", "Description", "Material No", "Item Name", "Item Size", "Qty", "Unit",
    "Equipment No", "Equipment Name", "PIC Request", "Cost Center", "No Material Request",
    "Priorities", "Material Condition", "No PR", "Event", "Qty Received", "Remaining QTY", "Status", "Remarks"
  ];
  const rows = filteredRecords.map(r => [
    formatDateDmy(r.date), r.description, String(r.materialNo || ""), r.itemName, r.itemSize, r.qty, r.unit,
    r.equipmentNo, r.equipmentName, r.picRequest, r.costCenter, r.noMr,
    r.priorities, r.materialCondition, r.noPr, r.event, r.qtyReceived, r.remainingQty, r.status, r.remarks
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Entry");
  XLSX.writeFile(wb, `Material_Request_${getTodayDmy().replace(/\//g, "-")}.xlsx`);
}

function openApiConfigModal() {
  if (resolveUserRole().toLowerCase() !== "developer") return;
  document.getElementById("gasApiUrlInput").value = localStorage.getItem(STORAGE_KEY_API) || "";
  document.getElementById("apiConfigModal").classList.add("active");
}
function closeApiConfigModal() {
  document.getElementById("apiConfigModal").classList.remove("active");
}
function saveApiConfig() {
  const val = document.getElementById("gasApiUrlInput").value.trim();
  if (!val.startsWith("https://script.google.com/")) return showToast("URL harus diawali https://script.google.com/", "error");
  localStorage.setItem(STORAGE_KEY_API, val);
  closeApiConfigModal();
  loadData(true);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeJsStr(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function sendApprovalMr(noMr) {
  if (!noMr) return;
  const confirmRes = await Swal.fire({
    title: "Kirim Email Approval?",
    text: `Kirim approval untuk Material Request "${noMr}" .`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#16a34a",
    confirmButtonText: "Ya, Kirim Approval"
  });
  if (!confirmRes.isConfirmed) return;

  showDocumentSaveLoading("Mengirim Email Approval...");
  try {
    const res = await callGasApi({
      action: "sendApprovalEmail",
      noMr: noMr
    });
    Swal.close();
    showToast(res.message || "Email approval berhasil dikirim.", "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal Kirim Email", text: err.message });
  }
}

function parseApprovalEntriesClient(approvedByRaw, approvedAtRaw) {
  const byParts = String(approvedByRaw || "")
    .split(/\s*\|\s*|\s*;\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  const atParts = String(approvedAtRaw || "")
    .split(/\s*\|\s*|\s*;\s*/)
    .map(s => s.trim())
    .filter(Boolean);

  return byParts.map((actor, idx) => ({
    actor,
    at: atParts[idx] || atParts[atParts.length - 1] || "-"
  }));
}

function getDocumentApprovalSummary(lines) {
  const total = lines.length;
  const requiredApproversCount = Math.max(activeApprovers.length, 1);

  const actorSet = new Set();
  const detailedEntries = [];
  let approvedItemCount = 0;

  lines.forEach(ln => {
    const st = String(ln.approvedStatus || "").trim().toLowerCase();
    const entries = parseApprovalEntriesClient(ln.approvedBy, ln.approvedAt);
    if (st.startsWith("approved") || entries.length > 0) {
      approvedItemCount++;
    }
    entries.forEach(e => {
      if (!actorSet.has(e.actor.toLowerCase())) {
        actorSet.add(e.actor.toLowerCase());
        detailedEntries.push(e);
      }
    });
  });

  const approvedActorsCount = detailedEntries.length;
  const isFullApproved =
    total > 0 &&
    approvedItemCount === total &&
    approvedActorsCount >= requiredApproversCount;

  const pendingApprovers = activeApprovers.filter(ap => {
    const lbl = String(ap.label || ap.email || ap.nama || "").toLowerCase();
    const em = String(ap.email || "").toLowerCase();
    return !detailedEntries.some(e => {
      const act = e.actor.toLowerCase();
      return act === lbl || (em && act.includes(em));
    });
  });

  return {
    total,
    approvedItemCount,
    approvedActorsCount,
    requiredApproversCount,
    isFullApproved,
    entries: detailedEntries,
    pendingApprovers
  };
}

function showApprovalInfoPopup(noMr) {
  const lines = allRecords.filter(r => String(r.noMr || "").trim() === String(noMr || "").trim());
  const info = getDocumentApprovalSummary(lines);

  const entriesHtml = info.entries.length
    ? info.entries.map((e, i) => `
        <div class="mr-approval-entry">
          <span><b>Tahap ${i + 1}:</b> ${escapeHtml(e.actor)}</span>
          <small>${escapeHtml(e.at)}</small>
        </div>
      `).join("")
    : `<div class="mr-approval-empty">Belum ada email kantor yang menyetujui dokumen ini.</div>`;

  const pendingHtml = info.pendingApprovers.length
    ? `<div class="mr-approval-pending"><b>Menunggu:</b> ${escapeHtml(info.pendingApprovers.map(p => p.label).join(", "))}</div>`
    : "";

  Swal.fire({
    title: info.isFullApproved ? `Full Approval — ${noMr}` : `Status Approval — ${noMr}`,
    html: `
      <div class="mr-save-caption" style="margin-bottom:10px;">
        <span class="mr-save-live-dot" style="background:${info.isFullApproved ? "#16a34a" : "#eab308"};"></span>
        <span>${info.isFullApproved ? "Full Approved" : "Belum Full Approval"} (${info.approvedActorsCount}/${info.requiredApproversCount} approver • ${info.approvedItemCount}/${info.total} item)</span>
      </div>
      <div class="mr-approval-list">${entriesHtml}</div>
      ${pendingHtml}
    `,
    customClass: {
      popup: "mr-save-popup mr-approval-popup",
      title: "mr-save-title",
      htmlContainer: "mr-save-html mr-approval-html",
      confirmButton: "btn btn-primary mr-approval-btn"
    },
    buttonsStyling: false,
    confirmButtonText: "Tutup"
  });
}