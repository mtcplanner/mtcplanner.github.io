// ============================================================
// KONFIGURASI ENDPOINT GOOGLE APPS SCRIPT (SURAT JALAN)
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbyCdP5LMXTjhg4OFguBeIGWh8NkGLovZ9dDL-Q863LSA1wJOpleCY5Ry9eFrbeNHgp59A/exec";
const STORAGE_KEY_API = "MTC_SURAT_JALAN_GAS_URL";
const STORAGE_KEY_SNAPSHOT = "MTC_SURAT_JALAN_DATA_SNAPSHOT_V2";
const STORAGE_KEY_LEGACY_SNAPSHOT = "MTC_SURAT_JALAN_DATA_SNAPSHOT_V1";
const STORAGE_KEY_MATERIALS = "MTC_SURAT_JALAN_MATERIALS_SNAPSHOT_V1";
const STORAGE_KEY_MATERIALS_META = "MTC_SURAT_JALAN_MATERIALS_META_V1";
const MATERIAL_SUGGESTION_LIMIT = 100;
const MATERIAL_CACHE_MAX_AGE = 15 * 60 * 1000;

let sheetColumns = [];
let allRecords = [];
let filteredRecords = [];
let materialCatalog = []; // [{ code, partNo, itemName, itemSize, unit }]
let selectedNoDoc = null;
let currentView = "all"; // "all" | "detail"
let hasCachedMaterialCatalog = false;
let materialCatalogIsStale = true;
let materialCatalogRevision = 0;
let materialCatalogSyncPromise = null;

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

// ============================================================
// MODAL MAXIMIZE / RESTORE TOGGLE
// ============================================================
function toggleMaximizeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const card = modal.querySelector(".modal-card");
  if (!card) return;
  card.classList.toggle("maximized");
  const icon = modal.querySelector(".modal-toggle-max i");
  if (icon) {
    if (card.classList.contains("maximized")) {
      icon.className = "bi bi-fullscreen-exit";
    } else {
      icon.className = "bi bi-arrows-fullscreen";
    }
  }
}

async function callGasApi(payload) {
  const url = getGasUrl();
  if (!url || url.includes("GANTI_DENGAN_ID_DEPLOYMENT")) {
    if (resolveUserRole().toLowerCase() === "developer") openApiConfigModal();
    throw new Error("URL Web App GAS Surat Jalan belum diatur.");
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
      "Gagal terhubung ke GAS (Failed to fetch). Pastikan deployment Web App GAS di-set ke 'Anyone' dan sudah di-publish versi terbaru."
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
  const hasCachedData = restoreLocalSnapshot();
  loadData(false, hasCachedData);
});

function scheduleIdleTask(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1500 });
  } else {
    window.setTimeout(callback, 50);
  }
}

function saveLocalSnapshot() {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify({
      ts: Date.now(),
      columns: sheetColumns,
      records: allRecords
    }));
    localStorage.removeItem(STORAGE_KEY_LEGACY_SNAPSHOT);
  } catch (err) {
    console.warn("Gagal menyimpan cache Surat Jalan ke localStorage.", err);
  }
}

function saveMaterialCatalogSnapshot() {
  scheduleIdleTask(() => {
    try {
      const ts = Date.now();
      localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify({
        ts,
        materials: materialCatalog
      }));
      localStorage.setItem(STORAGE_KEY_MATERIALS_META, JSON.stringify({ ts }));
    } catch (err) {
      console.warn("Gagal menyimpan cache Material Code ke localStorage.", err);
    }
  });
}

function applyMaterialCatalog(materials, persistSnapshot = false, snapshotTime = Date.now()) {
  materialCatalog = materials;
  hasCachedMaterialCatalog = true;
  materialCatalogIsStale = Date.now() - snapshotTime > MATERIAL_CACHE_MAX_AGE;
  materialCatalogRevision++;
  const activeInput = document.activeElement;
  const query = activeInput && activeInput.classList &&
    (activeInput.id === "editItemNo" || activeInput.classList.contains("inp-itemno"))
    ? activeInput.value
    : "";
  renderMaterialDatalist(query);
  if (persistSnapshot) saveMaterialCatalogSnapshot();
}

function restoreMaterialCatalogSnapshot(snapshotOrRaw, expectedRevision, persistSnapshot = false) {
  scheduleIdleTask(() => {
    if (materialCatalogRevision !== expectedRevision) return;
    try {
      let snapshot = snapshotOrRaw;
      if (typeof snapshotOrRaw === "string") {
        snapshot = JSON.parse(snapshotOrRaw);
      } else {
        if (!snapshot) {
          const stored = localStorage.getItem(STORAGE_KEY_MATERIALS);
          if (stored) snapshot = JSON.parse(stored);
        }
      }
      if (!snapshot || !Array.isArray(snapshot.materials)) {
        hasCachedMaterialCatalog = false;
        materialCatalogIsStale = true;
        loadMaterialCatalog();
        return;
      }
      applyMaterialCatalog(snapshot.materials, persistSnapshot, Number(snapshot.ts) || 0);
      if (materialCatalogIsStale) loadMaterialCatalog();
    } catch (err) {
      hasCachedMaterialCatalog = false;
      materialCatalogIsStale = true;
      console.warn("Gagal membaca cache Material Code dari localStorage.", err);
      loadMaterialCatalog();
    }
  });
}

function restoreLocalSnapshot() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    const isLegacySnapshot = !currentRaw;
    const raw = currentRaw || localStorage.getItem(STORAGE_KEY_LEGACY_SNAPSHOT);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.records)) return false;

    sheetColumns = Array.isArray(snapshot.columns) && snapshot.columns.length > 0
      ? snapshot.columns
      : getFallbackColumns();
    allRecords = snapshot.records;
    applyFilters();

    const expectedRevision = materialCatalogRevision;
    if (Array.isArray(snapshot.materials)) {
      hasCachedMaterialCatalog = true;
      materialCatalogIsStale = Date.now() - (Number(snapshot.ts) || 0) > MATERIAL_CACHE_MAX_AGE;
      restoreMaterialCatalogSnapshot({
        ts: snapshot.ts,
        materials: snapshot.materials
      }, expectedRevision, true);
      if (materialCatalogIsStale) loadMaterialCatalog();
    } else {
      const metaRaw = localStorage.getItem(STORAGE_KEY_MATERIALS_META);
      let meta = null;
      try {
        meta = metaRaw ? JSON.parse(metaRaw) : null;
      } catch (_) {
        meta = null;
      }
      hasCachedMaterialCatalog = Boolean(meta && Number(meta.ts));
      materialCatalogIsStale = !hasCachedMaterialCatalog ||
        Date.now() - Number(meta.ts) > MATERIAL_CACHE_MAX_AGE;
      if (hasCachedMaterialCatalog) {
        restoreMaterialCatalogSnapshot(null, expectedRevision);
      }
      if (materialCatalogIsStale) loadMaterialCatalog();
    }

    if (isLegacySnapshot) saveLocalSnapshot();
    return true;
  } catch (err) {
    console.warn("Gagal membaca cache Surat Jalan dari localStorage.", err);
    return false;
  }
}

async function loadData(forceRefresh = false, silentBackground = false) {
  try {
    if (!silentBackground) {
      const colSpan = Math.max(sheetColumns.length + 2, 11);
      document.getElementById("rekapTableBody").innerHTML =
        `<tr><td colspan="${colSpan}" class="empty-box">Memuat data silahkan tunggu...</td></tr>`;
    }

    const res = await callGasApi({
      action: "getData",
      forceRefresh: Boolean(forceRefresh),
      includeMaterials: false
    });
    sheetColumns = Array.isArray(res.columns) && res.columns.length > 0 ? res.columns : getFallbackColumns();
    allRecords = res.records || [];
    if (Array.isArray(res.materials)) {
      applyMaterialCatalog(res.materials, true);
    } else if (forceRefresh || !hasCachedMaterialCatalog || materialCatalogIsStale) {
      loadMaterialCatalog(forceRefresh);
    }
    applyFilters();
    saveLocalSnapshot();
    if (!silentBackground || forceRefresh) showToast("Data Surat Jalan berhasil dimuat.", "success");
  } catch (err) {
    if (silentBackground) {
      showToast(`Cache ditampilkan, tetapi sinkronisasi gagal: ${err.message}`, "error", "Sinkronisasi Gagal");
    } else {
      const colSpan = Math.max(sheetColumns.length + 2, 11);
      document.getElementById("rekapTableBody").innerHTML =
        `<tr><td colspan="${colSpan}" class="empty-box" style="color:#dc2626;">${escapeHtml(err.message)}</td></tr>`;
      showToast(err.message, "error", "Koneksi Gagal");
    }
  }
}

function loadMaterialCatalog(forceRefresh = false) {
  if (materialCatalogSyncPromise) return materialCatalogSyncPromise;
  materialCatalogSyncPromise = callGasApi({
    action: "getMaterials",
    forceRefresh: Boolean(forceRefresh)
  }).then(res => {
    if (!Array.isArray(res.materials)) {
      throw new Error("Respons GAS tidak menyertakan daftar Material Code.");
    }
    applyMaterialCatalog(res.materials, true);
  }).catch(err => {
    showToast(
      hasCachedMaterialCatalog
        ? `Cache Material Code ditampilkan, tetapi sinkronisasi gagal: ${err.message}`
        : err.message,
      "error",
      "Sinkronisasi Material Code Gagal"
    );
  }).finally(() => {
    materialCatalogSyncPromise = null;
  });
  return materialCatalogSyncPromise;
}

function renderMaterialDatalist(query = "") {
  const dl = document.getElementById("materialCodeDatalist");
  if (!dl) return;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const matches = normalizedQuery.length >= 2
    ? materialCatalog.filter(m => String(m.code || "").toLowerCase().startsWith(normalizedQuery))
    : materialCatalog;
  dl.innerHTML = matches
    .filter(m => m.code)
    .slice(0, MATERIAL_SUGGESTION_LIMIT)
    .map(m => `<option value="${escapeHtml(m.code)}" label="${escapeHtml(m.itemName)}${m.unit ? ` (${m.unit})` : ""}"></option>`)
    .join("");
}

function findMaterialMatch(rawVal) {
  const val = String(rawVal || "").trim().toLowerCase();
  if (!val) return null;
  return (
    materialCatalog.find(m => m.code.toLowerCase() === val) ||
    materialCatalog.find(m => m.code.toLowerCase().startsWith(val) && val.length >= 2) ||
    null
  );
}

/**
 * Mencocokkan Item No dengan Material Code, lalu auto-isi Item (ITEM NAME) dan Satuan (UNIT)
 */
function handleItemNoInput(inputEl, isEditModal = false) {
  if (!inputEl) return;
  renderMaterialDatalist(inputEl.value);
  const matched = findMaterialMatch(inputEl.value);
  if (!matched) return;

  inputEl.value = matched.code;

  if (isEditModal) {
    const itemEl = document.getElementById("editItem");
    if (itemEl && matched.itemName) itemEl.value = matched.itemName;
    const satuanEl = document.getElementById("editSatuan");
    if (satuanEl && matched.unit) satuanEl.value = matched.unit;
  } else {
    const tr = inputEl.closest("tr");
    if (!tr) return;
    const itemEl = tr.querySelector(".inp-item");
    if (itemEl && matched.itemName) itemEl.value = matched.itemName;
    const satuanEl = tr.querySelector(".inp-satuan");
    if (satuanEl && matched.unit) satuanEl.value = matched.unit;
  }
}

function getFallbackColumns() {
  return [
    { colIndex: 1, title: "Tanggal", key: "tanggal" },
    { colIndex: 2, title: "No Document", key: "noDoc" },
    { colIndex: 3, title: "Item No", key: "itemNo" },
    { colIndex: 4, title: "Item", key: "item" },
    { colIndex: 5, title: "Qty", key: "qty" },
    { colIndex: 6, title: "Satuan", key: "satuan" },
    { colIndex: 7, title: "Input", key: "inputType" },
    { colIndex: 8, title: "Pengirim", key: "pengirim" },
    { colIndex: 9, title: "Tujuan", key: "tujuan" },
    { colIndex: 10, title: "Keterangan", key: "keterangan" }
  ];
}

function getRecordFieldValue(r, key) {
  if (r.fields && r.fields[key] !== undefined) return r.fields[key];
  if (key === "input") return r.inputType || "";
  if (key === "unit") return r.satuan || "";
  return r[key] !== undefined ? r[key] : "";
}

function applyFilters() {
  const typeVal = document.getElementById("filterInputType").value;
  const monthVal = document.getElementById("filterMonth").value;
  const q = document.getElementById("filterSearch").value.trim().toLowerCase();

  filteredRecords = allRecords.filter(r => {
    const inType = String(getRecordFieldValue(r, "inputType") || getRecordFieldValue(r, "input") || "");
    const tgl = String(getRecordFieldValue(r, "tanggal") || "");
    if (typeVal !== "ALL" && inType.toLowerCase() !== typeVal.toLowerCase()) return false;
    if (monthVal && !tgl.startsWith(monthVal)) return false;
    if (q) {
      const allVals = Object.values(r.fields || {
        noDoc: r.noDoc, itemNo: r.itemNo, item: r.item, satuan: r.satuan, pengirim: r.pengirim, tujuan: r.tujuan, keterangan: r.keterangan
      }).join(" ").toLowerCase();
      if (!allVals.includes(q)) return false;
    }
    return true;
  });

  updateKpis();
  renderDocList();
  renderRekapTable();
  renderDetailDocument();
}

function updateKpis() {
  const uniqueDocs = new Set(filteredRecords.map(r => String(getRecordFieldValue(r, "noDoc") || "").trim()).filter(Boolean));
  let masukCount = 0;
  let keluarCount = 0;

  filteredRecords.forEach(r => {
    const t = String(getRecordFieldValue(r, "inputType") || getRecordFieldValue(r, "input") || "").toLowerCase();
    if (t.includes("masuk")) masukCount++;
    else if (t.includes("keluar")) keluarCount++;
  });

  document.getElementById("kpiTotalDoc").textContent = uniqueDocs.size;
  document.getElementById("kpiMasuk").textContent = masukCount;
  document.getElementById("kpiKeluar").textContent = keluarCount;
  document.getElementById("sjSummaryMeta").textContent =
    `• ${filteredRecords.length} Item pada ${uniqueDocs.size} Dokumen`;
}

function renderDocList() {
  const container = document.getElementById("docListContainer");
  const groups = new Map();

  filteredRecords.forEach(r => {
    const noDoc = String(getRecordFieldValue(r, "noDoc") || "").trim();
    const key = noDoc || "(Tanpa No Doc)";
    if (!groups.has(key)) {
      groups.set(key, {
        noDoc: key,
        tanggal: getRecordFieldValue(r, "tanggal") || "",
        inputType: getRecordFieldValue(r, "inputType") || getRecordFieldValue(r, "input") || "Barang Masuk",
        pengirim: getRecordFieldValue(r, "pengirim") || "",
        tujuan: getRecordFieldValue(r, "tujuan") || "",
        itemCount: 0,
        totalQty: 0
      });
    }
    const g = groups.get(key);
    g.itemCount++;
    g.totalQty += Number(getRecordFieldValue(r, "qty")) || 0;
  });

  const docArr = Array.from(groups.values());
  document.getElementById("docListCount").textContent = docArr.length;

  if (docArr.length === 0) {
    container.innerHTML = `<div class="empty-box">Tidak ada dokumen ditemukan.</div>`;
    return;
  }

  container.innerHTML = docArr.map(d => {
    const isIn = String(d.inputType).toLowerCase().includes("masuk");
    const isActive = selectedNoDoc === d.noDoc;
    return `
      <div class="doc-card-item ${isActive ? "active" : ""}" onclick="selectDocument('${escapeHtml(d.noDoc)}')">
        <div class="doc-card-top">
          <span class="doc-no">${escapeHtml(d.noDoc)}</span>
          <span class="pill-type ${isIn ? "pill-in" : "pill-out"}">${escapeHtml(d.inputType)}</span>
        </div>
        <div class="doc-route">${escapeHtml(d.pengirim || "-")} → ${escapeHtml(d.tujuan || "-")}</div>
        <div class="doc-sub">${escapeHtml(d.tanggal || "-")} • ${d.itemCount} Item (Total Qty: ${d.totalQty})</div>
      </div>
    `;
  }).join("");
}

function selectDocument(noDoc) {
  selectedNoDoc = noDoc;
  document.getElementById("activeDocInfo").textContent = `Dokumen: ${noDoc}`;
  renderDocList();
  renderDetailDocument();
  switchView("detail");
}

function switchView(mode) {
  currentView = mode;
  document.getElementById("tabBtnAll").classList.toggle("active", mode === "all");
  document.getElementById("tabBtnDetail").classList.toggle("active", mode === "detail");
  document.getElementById("viewAll").classList.toggle("active", mode === "all");
  document.getElementById("viewDetail").classList.toggle("active", mode === "detail");
  if (mode === "all") document.getElementById("activeDocInfo").textContent = "Semua Dokumen";
}

function renderRekapTable() {
  const table = document.querySelector("#viewAll table.sj-table");
  const thead = table.querySelector("thead tr");
  const tbody = document.getElementById("rekapTableBody");
  const cols = sheetColumns.length > 0 ? sheetColumns : getFallbackColumns();
  const itemColumnKeys = new Set(["itemNo", "item", "qty", "satuan", "keterangan"]);
  const recordGroups = new Map();

  filteredRecords.forEach((record, index) => {
    const noDoc = String(getRecordFieldValue(record, "noDoc") || "").trim();
    const key = noDoc ? `doc:${noDoc}` : `row:${record.rowIndex ?? index}`;
    if (!recordGroups.has(key)) recordGroups.set(key, []);
    recordGroups.get(key).push(record);
  });
  const groups = Array.from(recordGroups.values());

  thead.innerHTML =
    `<th style="width:40px;">No</th>` +
    cols.map(c => `<th class="${c.key === "item" ? "th-item" : ""}">${escapeHtml(c.title)}</th>`).join("");

  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-box">Belum ada data transaksi Surat Jalan.</td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map((items, idx) => {
    const r = items[0];
    const noDocVal = String(getRecordFieldValue(r, "noDoc") || "-");
    const cellsHtml = cols.map(c => {
      const val = getRecordFieldValue(r, c.key);
      if (itemColumnKeys.has(c.key)) {
        const values = items.map(itemRecord => {
          const itemValue = getRecordFieldValue(itemRecord, c.key);
          const text = c.key === "item" || c.key === "keterangan"
            ? String(itemValue ?? "")
            : c.key === "qty"
              ? String(itemValue ?? "-")
              : String(itemValue || "-");
          return `
            <button type="button" class="record-item-line" title="Klik untuk mengedit item ini"
              onclick="event.stopPropagation(); openEditRowModal(${itemRecord.rowIndex})"
              onkeydown="event.stopPropagation()">${escapeHtml(text)}</button>
          `;
        }).join("");
        const classes = [
          c.key === "item" ? "td-item fw-bold" : "",
          ["itemNo", "qty", "satuan"].includes(c.key) ? "text-center" : "",
          c.key === "qty" ? "fw-bold" : ""
        ].filter(Boolean).join(" ");
        return `<td class="${classes}"><div class="record-item-lines">${values}</div></td>`;
      }
      if (c.key === "tanggal") {
        return `<td class="text-center">${escapeHtml(String(val ?? "-"))}</td>`;
      }
      if (c.key === "noDoc") {
        return `<td class="text-center fw-bold" style="color:var(--primary);">${escapeHtml(noDocVal)}</td>`;
      }
      if (c.key === "inputType" || c.key === "input") {
        const strVal = String(val || "Barang Masuk");
        const isIn = strVal.toLowerCase().includes("masuk");
        return `<td class="text-center"><span class="pill-type ${isIn ? "pill-in" : "pill-out"}">${escapeHtml(strVal)}</span></td>`;
      }
      return `<td>${escapeHtml(String(val ?? ""))}</td>`;
    }).join("");

    return `
      <tr class="clickable-row" tabindex="0" title="Klik untuk mengedit item pertama; klik nilai item untuk memilih item tertentu"
        onclick="openEditRowModal(${r.rowIndex})"
        onkeydown="handleRecordRowKeydown(event, ${r.rowIndex})">
        <td class="text-center">${idx + 1}</td>
        ${cellsHtml}
      </tr>
    `;
  }).join("");
}

function handleRecordRowKeydown(event, rowIndex) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openEditRowModal(rowIndex);
  }
}

function renderDetailDocument() {
  const container = document.getElementById("docDetailBody");
  if (!selectedNoDoc) {
    container.innerHTML = `<div class="empty-box">Pilih nomor dokumen di panel kiri untuk melihat rincian Surat Jalan.</div>`;
    return;
  }

  const lines = allRecords.filter(r => String(getRecordFieldValue(r, "noDoc") || "").trim() === selectedNoDoc);
  if (lines.length === 0) {
    container.innerHTML = `<div class="empty-box">Dokumen tidak ditemukan.</div>`;
    return;
  }

  const head = lines[0];
  const inputTypeVal = String(getRecordFieldValue(head, "inputType") || getRecordFieldValue(head, "input") || "Barang Masuk");
  const isIn = inputTypeVal.toLowerCase().includes("masuk");
  const totalQty = lines.reduce((acc, cur) => acc + (Number(getRecordFieldValue(cur, "qty")) || 0), 0);
  const hasItemNoCol = sheetColumns.some(c => c.key === "itemNo");
  const hasSatuanCol = sheetColumns.some(c => c.key === "satuan");

  container.innerHTML = `
    <div class="doc-summary-box">
      <div>
        <div style="font-size:15px; font-weight:800; color:var(--text-primary);">${escapeHtml(selectedNoDoc)}</div>
        <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Rekapitulasi Surat Jalan Barang Masuk/Keluar</div>
      </div>
      <div class="no-print" style="display:flex; gap:6px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak</button>
        <button type="button" class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="confirmDeleteDocument('${escapeHtml(selectedNoDoc)}')">
          <i class="bi bi-trash3"></i> Hapus Dokumen
        </button>
      </div>
    </div>

    <div class="doc-meta-grid">
      <div class="meta-item"><span>Tanggal</span><strong>${escapeHtml(String(getRecordFieldValue(head, "tanggal") || "-"))}</strong></div>
      <div class="meta-item"><span>Jenis Transaksi</span><strong><span class="pill-type ${isIn ? "pill-in" : "pill-out"}">${escapeHtml(inputTypeVal)}</span></strong></div>
      <div class="meta-item"><span>Pengirim</span><strong>${escapeHtml(String(getRecordFieldValue(head, "pengirim") || "-"))}</strong></div>
      <div class="meta-item"><span>Tujuan</span><strong>${escapeHtml(String(getRecordFieldValue(head, "tujuan") || "-"))}</strong></div>
      <div class="meta-item"><span>Total Item / Qty</span><strong>${lines.length} Item (${totalQty} Qty)</strong></div>
    </div>

    <table class="sj-table">
      <thead>
        <tr>
          <th style="width:40px;">No</th>
          ${hasItemNoCol ? `<th style="width:130px;">Item No</th>` : ""}
          <th style="min-width:250px;">Nama Item / Barang</th>
          <th style="width:80px;">Qty</th>
          ${hasSatuanCol ? `<th style="width:85px;">Satuan</th>` : ""}
          <th>Keterangan</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map((ln, idx) => `
          <tr class="clickable-row" tabindex="0" title="Klik untuk melihat atau mengedit data"
            onclick="openEditRowModal(${ln.rowIndex})"
            onkeydown="handleRecordRowKeydown(event, ${ln.rowIndex})">
            <td class="text-center">${idx + 1}</td>
            ${hasItemNoCol ? `<td class="text-center">${escapeHtml(String(getRecordFieldValue(ln, "itemNo") || ""))}</td>` : ""}
            <td class="fw-bold td-item">${escapeHtml(String(getRecordFieldValue(ln, "item") || ""))}</td>
            <td class="text-center fw-bold">${Number(getRecordFieldValue(ln, "qty")) || 0}</td>
            ${hasSatuanCol ? `<td class="text-center">${escapeHtml(String(getRecordFieldValue(ln, "satuan") || ""))}</td>` : ""}
            <td>${escapeHtml(String(getRecordFieldValue(ln, "keterangan") || ""))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ============================================================
// MODAL CREATE SURAT JALAN
// ============================================================
function openCreateDocModal() {
  document.getElementById("docTanggal").value = new Date().toISOString().split("T")[0];
  document.getElementById("docNo").value = "";
  document.getElementById("docInputType").value = "Barang Masuk";
  document.getElementById("docPengirim").value = "";
  document.getElementById("docTujuan").value = "";

  const hasItemNoCol = sheetColumns.some(c => c.key === "itemNo");
  const hasSatuanCol = sheetColumns.some(c => c.key === "satuan");
  const headTr = document.querySelector("#createDocModal .line-items-box thead tr");

  headTr.innerHTML =
    `<th style="width:40px;">No</th>` +
    (hasItemNoCol ? `<th style="width:130px;">Item No</th>` : "") +
    `<th style="min-width:260px;">Nama Item / Material *</th>` +
    `<th style="width:80px;">Qty *</th>` +
    (hasSatuanCol ? `<th style="width:85px;">Satuan</th>` : "") +
    `<th>Keterangan Item</th>` +
    `<th style="width:45px;">Hapus</th>`;

  const tbody = document.getElementById("modalItemsBody");
  tbody.innerHTML = "";
  addModalItemRow();
  document.getElementById("createDocModal").classList.add("active");
}

function closeCreateDocModal() {
  document.getElementById("createDocModal").classList.remove("active");
}

function addModalItemRow() {
  const tbody = document.getElementById("modalItemsBody");
  const idx = tbody.children.length + 1;
  const hasItemNoCol = sheetColumns.some(c => c.key === "itemNo");
  const hasSatuanCol = sheetColumns.some(c => c.key === "satuan");

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="text-center row-num">${idx}</td>
    ${hasItemNoCol ? `
      <td>
        <input type="text" list="materialCodeDatalist" class="modal-input inp-itemno text-center" placeholder="Pilih / ketik Item No..."
          oninput="handleItemNoInput(this, false)" onchange="handleItemNoInput(this, false)" />
      </td>` : ""}
    <td>
      <textarea class="modal-input inp-item" rows="1" placeholder="Nama barang (s/d 69+ karakter)..."></textarea>
    </td>
    <td><input type="number" class="modal-input inp-qty text-center" value="1" min="0" step="any" /></td>
    ${hasSatuanCol ? `<td><input type="text" class="modal-input inp-satuan text-center" placeholder="PCS..." /></td>` : ""}
    <td><input type="text" class="modal-input inp-ket" placeholder="Keterangan..." /></td>
    <td class="text-center"><button type="button" class="btn-icon del" onclick="removeModalItemRow(this)"><i class="bi bi-x-lg"></i></button></td>
  `;
  tbody.appendChild(tr);
}

function removeModalItemRow(btn) {
  const tbody = document.getElementById("modalItemsBody");
  if (tbody.children.length <= 1) return;
  btn.closest("tr").remove();
  Array.from(tbody.children).forEach((tr, i) => {
    tr.querySelector(".row-num").textContent = i + 1;
  });
}

async function submitCreateDocument() {
  const tanggal = document.getElementById("docTanggal").value;
  const noDoc = document.getElementById("docNo").value.trim();
  const inputType = document.getElementById("docInputType").value;
  const pengirim = document.getElementById("docPengirim").value.trim();
  const tujuan = document.getElementById("docTujuan").value.trim();

  if (!tanggal || !noDoc) return showToast("Tanggal dan No Document wajib diisi.", "error");

  const items = [];
  document.querySelectorAll("#modalItemsBody tr").forEach(tr => {
    const itemNoEl = tr.querySelector(".inp-itemno");
    const itemNo = itemNoEl ? itemNoEl.value.trim() : "";
    const item = tr.querySelector(".inp-item").value.trim();
    const qty = Number(tr.querySelector(".inp-qty").value) || 0;
    const satuanEl = tr.querySelector(".inp-satuan");
    const satuan = satuanEl ? satuanEl.value.trim() : "";
    const ket = tr.querySelector(".inp-ket").value.trim();

    if (item || itemNo) {
      items.push({ item, itemNo, qty, satuan, keterangan: ket, fields: { itemNo, satuan } });
    }
  });

  if (items.length === 0) return showToast("Isi minimal 1 item barang.", "error");

  closeCreateDocModal();
  Swal.fire({ title: "Menyimpan Surat Jalan...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const res = await callGasApi({
      action: "createDocument",
      doc: { tanggal, noDoc, inputType, pengirim, tujuan, items }
    });
    Swal.close();
    sheetColumns = Array.isArray(res.columns) && res.columns.length > 0 ? res.columns : sheetColumns;
    allRecords = res.records || [];
    if (Array.isArray(res.materials) && res.materials.length > 0) {
      materialCatalog = res.materials;
      renderMaterialDatalist();
    }
    selectedNoDoc = noDoc;
    applyFilters();
    saveLocalSnapshot();
    showToast(`Surat Jalan ${noDoc} (${items.length} item) berhasil disimpan.`, "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: err.message });
  }
}

// ============================================================
// EDIT & DELETE BARIS / DOKUMEN
// ============================================================
function openEditRowModal(rowIndex) {
  const row = allRecords.find(r => r.rowIndex === rowIndex);
  if (!row) return;

  document.getElementById("editRowIndex").value = row.rowIndex;
  document.getElementById("editTanggal").value = getRecordFieldValue(row, "tanggal");
  document.getElementById("editNoDoc").value = getRecordFieldValue(row, "noDoc");

  const itemNoEl = document.getElementById("editItemNo");
  const hasItemNoCol = sheetColumns.some(c => c.key === "itemNo");
  if (itemNoEl) {
    document.getElementById("editItemNoWrap").style.display = hasItemNoCol ? "" : "none";
    itemNoEl.value = getRecordFieldValue(row, "itemNo") || "";
  }

  document.getElementById("editItem").value = getRecordFieldValue(row, "item");
  document.getElementById("editQty").value = getRecordFieldValue(row, "qty");
  document.getElementById("editSatuan").value = getRecordFieldValue(row, "satuan") || "";
  document.getElementById("editInputType").value = getRecordFieldValue(row, "inputType") || getRecordFieldValue(row, "input") || "Barang Masuk";
  document.getElementById("editPengirim").value = getRecordFieldValue(row, "pengirim");
  document.getElementById("editTujuan").value = getRecordFieldValue(row, "tujuan");
  document.getElementById("editKeterangan").value = getRecordFieldValue(row, "keterangan");
  document.getElementById("editRowModal").classList.add("active");
}

function closeEditRowModal() {
  document.getElementById("editRowModal").classList.remove("active");
}

async function submitEditRow() {
  const itemNoEl = document.getElementById("editItemNo");
  const itemNoVal = itemNoEl ? itemNoEl.value.trim() : "";
  const satuanVal = document.getElementById("editSatuan").value.trim();

  const row = {
    rowIndex: Number(document.getElementById("editRowIndex").value),
    tanggal: document.getElementById("editTanggal").value,
    noDoc: document.getElementById("editNoDoc").value.trim(),
    itemNo: itemNoVal,
    item: document.getElementById("editItem").value.trim(),
    qty: Number(document.getElementById("editQty").value) || 0,
    satuan: satuanVal,
    inputType: document.getElementById("editInputType").value,
    pengirim: document.getElementById("editPengirim").value.trim(),
    tujuan: document.getElementById("editTujuan").value.trim(),
    keterangan: document.getElementById("editKeterangan").value.trim(),
    fields: { itemNo: itemNoVal, satuan: satuanVal }
  };

  closeEditRowModal();
  Swal.fire({ title: "Memperbarui Data...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const res = await callGasApi({ action: "updateRow", row });
    Swal.close();
    sheetColumns = Array.isArray(res.columns) && res.columns.length > 0 ? res.columns : sheetColumns;
    allRecords = res.records || [];
    applyFilters();
    saveLocalSnapshot();
    showToast("Baris Surat Jalan berhasil diperbarui.", "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal Update", text: err.message });
  }
}

function confirmDeleteRow(rowIndex, closeModalOnSuccess = false) {
  Swal.fire({
    title: "Hapus Baris?",
    text: "Data baris ini akan dihapus permanen dari sheet Data.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#ef4444",
    confirmButtonText: "Ya, Hapus"
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    Swal.fire({ title: "Menghapus...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await callGasApi({ action: "deleteRow", rowIndex });
      Swal.close();
      if (closeModalOnSuccess) closeEditRowModal();
      allRecords = res.records || [];
      applyFilters();
      saveLocalSnapshot();
      showToast("Baris berhasil dihapus.", "success");
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err.message });
    }
  });
}

function confirmDeleteDocument(noDoc) {
  Swal.fire({
    title: "Hapus Seluruh Dokumen?",
    text: `Semua baris item dengan No Document "${noDoc}" akan dihapus.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#ef4444",
    confirmButtonText: "Ya, Hapus Dokumen"
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    Swal.fire({ title: "Menghapus Dokumen...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await callGasApi({ action: "deleteDocument", noDoc });
      Swal.close();
      allRecords = res.records || [];
      selectedNoDoc = null;
      applyFilters();
      saveLocalSnapshot();
      switchView("all");
      showToast(`Dokumen ${noDoc} telah dihapus.`, "success");
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err.message });
    }
  });
}

function exportToExcel() {
  if (!filteredRecords.length) return showToast("Tidak ada data untuk diexport.", "info");
  const cols = sheetColumns.length > 0 ? sheetColumns : getFallbackColumns();
  const wsData = [
    ["Rekapitulasi Surat Jalan Barang Masuk/Keluar"],
    cols.map(c => c.title),
    ...filteredRecords.map(r => cols.map(c => getRecordFieldValue(r, c.key)))
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `Rekap_Surat_Jalan_${new Date().toISOString().slice(0, 10)}.xlsx`);
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