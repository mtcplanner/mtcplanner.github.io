// ============================================================
// KONFIGURASI ENDPOINT GOOGLE APPS SCRIPT (MODULE MATERIAL REQUEST)
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzXTiknzZQk5KULVx7SQui7ur2QYgIy81pTvmTGtXH_I-pTKb2Vf6TzdrNaYeUElExF/exec";
const STORAGE_KEY_API = "MTC_MATERIAL_REQUEST_GAS_URL";

let entryColumns = [];
let allRecords = [];
let filteredRecords = [];
let dropdownLists = {};
let materialCatalog = []; // [{ code, partNo, itemName, itemSize, unit }]
let fixedAssetCatalog = []; // [{ equipmentNo, equipmentName, type, serialNo }]
let selectedNoMr = null;
let currentView = "all"; // "all" | "detail"
let isInlineEditingDoc = false;
let activeSuggestContext = null; // { inputEl, onSelect }
let activeAssetSuggestContext = null; // { inputEl, onSelect }

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
  }, 3600);
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

document.addEventListener("DOMContentLoaded", () => {
  applyDeveloperAccess();
  loadData(false);

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
});

async function loadData(forceRefresh = false) {
  try {
    document.getElementById("entryTableBody").innerHTML =
      `<tr><td colspan="21" class="empty-box">Memuat data Material Request, Dropdown, Katalog Material Code &amp; Fixed Asset...</td></tr>`;

    const res = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    entryColumns = Array.isArray(res.columns) ? res.columns : [];
    allRecords = Array.isArray(res.records) ? res.records : [];
    dropdownLists = res.dropdowns || {};
    materialCatalog = Array.isArray(res.materials) ? res.materials : [];
    fixedAssetCatalog = Array.isArray(res.assets) ? res.assets : [];

    populateAllDropdowns();
    applyFilters();
    showToast(
      `Data dimuat (${materialCatalog.length} Material Code • ${fixedAssetCatalog.length} Fixed Asset aktif).`,
      "success"
    );
  } catch (err) {
    document.getElementById("entryTableBody").innerHTML =
      `<tr><td colspan="21" class="empty-box" style="color:#dc2626;">${escapeHtml(err.message)}</td></tr>`;
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
  const conditions = getDropdownOptions("materialCondition", ["On Stock", "Need Order", "Ex-Used"]);
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
  return fixedAssetCatalog
    .filter(a =>
      String(a.equipmentNo || "").toLowerCase().includes(q) ||
      String(a.equipmentName || "").toLowerCase().includes(q) ||
      String(a.type || "").toLowerCase().includes(q) ||
      String(a.serialNo || "").toLowerCase().includes(q)
    )
    .slice(0, 40);
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
  if (!eqNoEl || !eqNameEl) return;

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
  const q = String(query || "").trim().toLowerCase();
  if (!q) return materialCatalog.slice(0, 35);
  return materialCatalog
    .filter(m =>
      String(m.code || "").toLowerCase().includes(q) ||
      String(m.itemName || "").toLowerCase().includes(q) ||
      String(m.itemSize || "").toLowerCase().includes(q) ||
      String(m.partNo || "").toLowerCase().includes(q)
    )
    .slice(0, 40);
}

function showMaterialSuggestPopup(inputEl, onSelectCallback) {
  const popup = document.getElementById("materialSuggestPopup");
  if (!popup || !inputEl) return;

  hideAssetSuggestPopup();
  activeSuggestContext = { inputEl, onSelect: onSelectCallback };
  const matches = searchMaterialCatalog(inputEl.value);

  const rect = inputEl.getBoundingClientRect();
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 400)}px`;
  popup.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 260)}px`;

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
  popup.style.display = "block";
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
    codeInp.addEventListener("focus", () => showMaterialSuggestPopup(codeInp, applyMat));
    codeInp.addEventListener("input", () => {
      const exact = materialCatalog.find(m => String(m.code).trim() === String(codeInp.value).trim());
      if (exact) {
        applyMat(exact);
      } else {
        codeInp.classList.remove("valid-match");
        if (sizeInp) sizeInp.value = "";
        if (unitInp) unitInp.value = "";
      }
      showMaterialSuggestPopup(codeInp, applyMat);
    });
  }

  if (nameInp) {
    nameInp.addEventListener("focus", () => showMaterialSuggestPopup(nameInp, applyMat));
    nameInp.addEventListener("input", () => {
      const valid = validateStrictMaterialPair(codeInp ? codeInp.value : "", nameInp.value);
      if (!valid) {
        nameInp.classList.remove("valid-match");
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
function applyFilters() {
  const stVal = document.getElementById("filterStatus").value;
  const prVal = document.getElementById("filterPriority").value;
  const ccVal = document.getElementById("filterCostCenter").value;
  const q = document.getElementById("filterSearch").value.trim().toLowerCase();

  filteredRecords = allRecords.filter(r => {
    if (stVal !== "ALL" && String(r.status || "").toLowerCase() !== stVal.toLowerCase()) return false;
    if (prVal !== "ALL" && String(r.priorities || "").toLowerCase() !== prVal.toLowerCase()) return false;
    if (ccVal !== "ALL" && String(r.costCenter || "").toLowerCase() !== ccVal.toLowerCase()) return false;
    if (q) {
      const hay = `${r.noMr} ${r.materialNo} ${r.itemName} ${r.itemSize} ${r.equipmentNo} ${r.equipmentName} ${r.picRequest} ${r.description} ${r.noPr} ${r.materialCondition} ${r.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  updateKpis();
  renderMrList();
  renderEntryTableMerged();
  renderMrDetail();
}

function updateKpis() {
  const uniqueMrs = new Set(filteredRecords.map(r => String(r.noMr || "").trim()).filter(Boolean));
  let pending = 0;
  let done = 0;
  let urgent = 0;

  filteredRecords.forEach(r => {
    const st = String(r.status || "").toLowerCase();
    const pr = String(r.priorities || "").toLowerCase();
    if (st.includes("pending") || st.includes("open")) pending++;
    if (st.includes("done") || st.includes("close")) done++;
    if (pr.includes("urgent") || pr.includes("p3")) urgent++;
  });

  document.getElementById("kpiTotalMr").textContent = uniqueMrs.size;
  document.getElementById("kpiPending").textContent = pending;
  document.getElementById("kpiDone").textContent = done;
  document.getElementById("kpiUrgent").textContent = urgent;
  document.getElementById("mrSummaryMeta").textContent = `• ${filteredRecords.length} Baris Request`;
}

function renderMrList() {
  const container = document.getElementById("mrListContainer");
  const groups = new Map();

  filteredRecords.forEach(r => {
    const key = String(r.noMr || "").trim() || "(Tanpa No MR)";
    if (!groups.has(key)) {
      groups.set(key, {
        noMr: key,
        date: r.date || "-",
        equipment: [r.equipmentNo, r.equipmentName].filter(Boolean).join(" - ") || r.description || "-",
        pic: r.picRequest || "-",
        itemCount: 0
      });
    }
    groups.get(key).itemCount++;
  });

  const arr = Array.from(groups.values());
  document.getElementById("mrListCount").textContent = arr.length;

  if (arr.length === 0) {
    container.innerHTML = `<div class="empty-box">Tidak ada dokumen MR ditemukan.</div>`;
    return;
  }

  container.innerHTML = arr.map(g => {
    const isActive = selectedNoMr === g.noMr;
    return `
      <div class="mr-card-item ${isActive ? "active" : ""}" onclick="selectMrDocument('${escapeJsStr(g.noMr)}')">
        <div class="mr-card-top">
          <span class="mr-no">${escapeHtml(g.noMr)}</span>
          <span class="badge-count">${g.itemCount} Item</span>
        </div>
        <div class="mr-eq">${escapeHtml(g.equipment)}</div>
        <div class="mr-sub">${escapeHtml(g.date)} • ${escapeHtml(g.pic)}</div>
      </div>
    `;
  }).join("");
}

function selectMrDocument(noMr) {
  isInlineEditingDoc = false;
  selectedNoMr = noMr;
  document.getElementById("activeMrInfo").textContent = `Dokumen MR: ${noMr}`;
  renderMrList();
  renderMrDetail();
  switchView("detail");
}

function switchView(mode) {
  currentView = mode;
  if (mode === "all") {
    isInlineEditingDoc = false;
    document.getElementById("activeMrInfo").textContent = "Semua Dokumen MR";
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

function renderEntryTableMerged() {
  const tbody = document.getElementById("entryTableBody");
  if (filteredRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="21" class="empty-box">Belum ada data Material Request pada sheet Entry.</td></tr>`;
    return;
  }

  const blocks = [];
  filteredRecords.forEach(r => {
    const mrKey = String(r.noMr || "").trim() || `__ROW_${r.rowIndex}`;
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.mrKey === mrKey) {
      lastBlock.rows.push(r);
    } else {
      blocks.push({ mrKey, rows: [r] });
    }
  });

  let seqNo = 0;
  const htmlRows = [];

  blocks.forEach(blk => {
    const span = blk.rows.length;
    const head = blk.rows[0];
    const docTarget = String(head.noMr || "").trim();

    blk.rows.forEach((r, idxInBlock) => {
      seqNo++;
      const isFirst = idxInBlock === 0;
      const rsAttr = span > 1 ? ` rowspan="${span}"` : "";
      const mergedCls = span > 1 ? "merged-header-cell" : "";

      const headerCellsHtml = isFirst ? `
        <td class="text-center ${mergedCls}"${rsAttr}>${escapeHtml(head.date || "-")}</td>
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
    });
  });

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

  const head = lines[0];

  if (!isInlineEditingDoc) {
    container.innerHTML = `
      <div class="doc-summary-box">
        <div>
          <div style="font-size:15px; font-weight:800;">${escapeHtml(selectedNoMr)}</div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
            ${escapeHtml(head.description || "Material Request Requisition")}
          </div>
        </div>
        <div class="no-print" style="display:flex; gap:6px; align-items:center;">
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
        <div class="meta-item"><span>Date</span><strong>${escapeHtml(head.date || "-")}</strong></div>
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

  container.innerHTML = `
    <div class="doc-summary-box">
      <div>
        <div style="font-size:14px; font-weight:800; color:var(--primary);">Mode Edit Langsung — ${escapeHtml(selectedNoMr)}</div>
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
        <input type="date" id="inlDate" class="inline-input" value="${escapeHtml(head.date || "")}" />
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

  const conditionsList = conditions;
  document.querySelectorAll("#inlineItemsBody tr").forEach(tr => {
    bindInlineRowEvents(tr, conditionsList);
  });
}

function renderInlineItemRowHtml(itemObj, seq, isNewRow, conditions, statuses) {
  const onStock = isOnStockCondition(itemObj.materialCondition);
  const rowTypeAttr = isNewRow ? `data-is-new="1"` : `data-is-new="0" data-row-index="${itemObj.rowIndex}"`;
  const condHtml = buildSelectHtml(conditions, itemObj.materialCondition || "On Stock", "inline-select inl-cond");
  const statusHtml = buildSelectHtml(statuses, itemObj.status || "Open", "inline-select inl-status");

  return `
    <tr ${rowTypeAttr}>
      <td class="text-center row-num">${seq}</td>
      <td><input type="text" class="inline-input text-center code-mono inl-code" value="${escapeHtml(String(itemObj.materialNo || ""))}" placeholder="Kode..." autocomplete="off" /></td>
      <td><input type="text" class="inline-input inl-name" value="${escapeHtml(itemObj.itemName || "")}" placeholder="Nama item..." autocomplete="off" /></td>
      <td><input type="text" class="inline-input text-center inl-size" value="${escapeHtml(itemObj.itemSize || "")}" readonly /></td>
      <td><input type="number" class="inline-input text-center inl-qty" value="${itemObj.qty ?? 1}" min="0" step="any" /></td>
      <td><input type="text" class="inline-input text-center inl-unit" value="${escapeHtml(itemObj.unit || "")}" readonly /></td>
      <td>${condHtml}</td>
      <td><input type="text" class="inline-input text-center inl-nopr" value="${onStock ? "" : escapeHtml(itemObj.noPr || "")}" ${onStock ? 'disabled placeholder="Tidak perlu PR"' : 'placeholder="No PR..."'} /></td>
      <td><input type="number" class="inline-input text-center inl-qtyrec" value="${itemObj.qtyReceived ?? 0}" min="0" step="any" /></td>
      <td><input type="number" class="inline-input text-center fw-bold inl-rem" value="${itemObj.remainingQty ?? Math.max((Number(itemObj.qty) || 0) - (Number(itemObj.qtyReceived) || 0), 0)}" readonly /></td>
      <td>${statusHtml}</td>
      <td><input type="text" class="inline-input inl-remarks" value="${escapeHtml(itemObj.remarks || "")}" placeholder="Remarks..." /></td>
      <td class="text-center">
        <button type="button" class="btn-icon del" onclick="removeInlineItemRow(this)" title="Hapus Item"><i class="bi bi-x-lg"></i></button>
      </td>
    </tr>
  `;
}

function bindInlineRowEvents(tr, conditionsList) {
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
  };
  if (qtyInp) qtyInp.addEventListener("input", recalc);
  if (recInp) recInp.addEventListener("input", recalc);
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
  bindInlineRowEvents(newTr, conditions);
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
  const date = document.getElementById("inlDate").value;
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
    const qtyVal = Number(tr.querySelector(".inl-qty").value) || 0;
    const unitVal = tr.querySelector(".inl-unit").value.trim();
    const condVal = tr.querySelector(".inl-cond").value;
    const noPrVal = isOnStockCondition(condVal) ? "" : tr.querySelector(".inl-nopr").value.trim();
    const qtyRecVal = Number(tr.querySelector(".inl-qtyrec").value) || 0;
    const statusVal = tr.querySelector(".inl-status").value;
    const remarksVal = tr.querySelector(".inl-remarks").value.trim();

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
    allRecords = res.records || [];
    if (res.dropdowns) dropdownLists = res.dropdowns;
    if (Array.isArray(res.materials)) materialCatalog = res.materials;
    if (Array.isArray(res.assets)) fixedAssetCatalog = res.assets;
    selectedNoMr = noMr;
    isInlineEditingDoc = false;
    applyFilters();
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

  document.getElementById("mrDate").value = new Date().toISOString().split("T")[0];
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
  card.class.remove("minimized");
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
      <input type="text" class="modal-input inp-mat-name" placeholder="Ketik nama item (mis. Hose)..." autocomplete="off" />
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
  const date = document.getElementById("mrDate").value;
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
    allRecords = res.records || [];
    if (res.dropdowns) dropdownLists = res.dropdowns;
    if (Array.isArray(res.materials)) materialCatalog = res.materials;
    if (Array.isArray(res.assets)) fixedAssetCatalog = res.assets;
    selectedNoMr = noMr;
    isInlineEditingDoc = false;
    applyFilters();
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
    confirmButtonColor: "#ef4444",
    confirmButtonText: "Ya, Hapus MR"
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    Swal.fire({ title: "Menghapus Dokumen MR...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await callGasApi({ action: "deleteMR", noMr });
      Swal.close();
      allRecords = res.records || [];
      selectedNoMr = null;
      isInlineEditingDoc = false;
      applyFilters();
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
    r.date, r.description, String(r.materialNo || ""), r.itemName, r.itemSize, r.qty, r.unit,
    r.equipmentNo, r.equipmentName, r.picRequest, r.costCenter, r.noMr,
    r.priorities, r.materialCondition, r.noPr, r.event, r.qtyReceived, r.remainingQty, r.status, r.remarks
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Entry");
  XLSX.writeFile(wb, `Material_Request_${new Date().toISOString().slice(0, 10)}.xlsx`);
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