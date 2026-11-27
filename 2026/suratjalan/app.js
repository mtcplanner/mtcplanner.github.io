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
let isInlineEditingDocument = false;
let pendingDeletedRowIndices = [];
let currentView = "all"; // "all" | "detail"
let hasCachedMaterialCatalog = false;
let materialCatalogIsStale = true;
let materialCatalogSyncPromise = null;
let legacyMaterialCatalog = [];
let legacyMaterialCatalogTimestamp = 0;

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
  loadMaterialCatalog();
});

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

function applyMaterialCatalog(materials, snapshotTime = Date.now()) {
  materialCatalog = materials;
  hasCachedMaterialCatalog = true;
  materialCatalogIsStale = Date.now() - snapshotTime > MATERIAL_CACHE_MAX_AGE;
  const activeInput = document.activeElement;
  const query = activeInput && activeInput.classList &&
    (activeInput.id === "editItemNo" || activeInput.classList.contains("inp-itemno"))
    ? activeInput.value
    : "";
  renderMaterialDatalist(query);
}

function restoreLocalSnapshot() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    const isLegacySnapshot = !currentRaw;
    const raw = currentRaw || localStorage.getItem(STORAGE_KEY_LEGACY_SNAPSHOT);
    const snapshot = raw ? JSON.parse(raw) : null;
    const hasSnapshot = Boolean(snapshot && Array.isArray(snapshot.records));
    if (hasSnapshot) {
      sheetColumns = Array.isArray(snapshot.columns) && snapshot.columns.length > 0
        ? snapshot.columns
        : getFallbackColumns();
      allRecords = snapshot.records;
      applyFilters();
    }

    let legacySnapshot = hasSnapshot && Array.isArray(snapshot.materials)
      ? { ts: snapshot.ts, materials: snapshot.materials }
      : null;
    if (!legacySnapshot) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_MATERIALS);
        legacySnapshot = stored ? JSON.parse(stored) : null;
      } catch (err) {
        console.warn("Gagal membaca cache lama Material Code.", err);
      }
    }
    if (legacySnapshot && Array.isArray(legacySnapshot.materials)) {
      legacyMaterialCatalog = legacySnapshot.materials;
      legacyMaterialCatalogTimestamp = Number(legacySnapshot.ts) || 0;
      applyMaterialCatalog(legacyMaterialCatalog, legacyMaterialCatalogTimestamp);
    } else {
      const metaRaw = localStorage.getItem(STORAGE_KEY_MATERIALS_META);
      try {
        const meta = metaRaw ? JSON.parse(metaRaw) : null;
        legacyMaterialCatalogTimestamp = Number(meta && meta.ts) || 0;
      } catch (err) {
        console.warn("Metadata cache lama Material Code tidak dapat dibaca.", err);
      }
      hasCachedMaterialCatalog = false;
      materialCatalogIsStale = true;
    }

    if (hasSnapshot && isLegacySnapshot) saveLocalSnapshot();
    return hasSnapshot;
  } catch (err) {
    console.warn("Gagal membaca cache Surat Jalan dari localStorage.", err);
    return false;
  }
}

async function loadData(forceRefresh = false, silentBackground = false) {
  if (forceRefresh || !hasCachedMaterialCatalog || materialCatalogIsStale) {
    loadMaterialCatalog(forceRefresh);
  }
  try {
    if (!silentBackground) {
      const colSpan = Math.max(sheetColumns.length + 2, 11);
      document.getElementById("rekapTableBody").innerHTML =
        `<tr><td colspan="${colSpan}" class="empty-box">Memuat data silahkan tunggu...</td></tr>`;
    }

    const res = await callGasApi({
      action: "getData",
      forceRefresh: Boolean(forceRefresh)
    });
    sheetColumns = Array.isArray(res.columns) && res.columns.length > 0 ? res.columns : getFallbackColumns();
    allRecords = res.records || [];
    if (!hasCachedMaterialCatalog && Array.isArray(res.materials) && res.materials.length) {
      applyMaterialCatalog(res.materials);
      MTCMaterialCatalogCache.seedCatalog(res.materials).catch(err => {
        console.warn("Katalog fallback tidak dapat disimpan ke cache bersama.", err);
      });
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
  materialCatalogSyncPromise = MTCMaterialCatalogCache.loadCatalog({
    forceRefresh: Boolean(forceRefresh),
    fallbackRecords: legacyMaterialCatalog,
    fallbackUpdatedAt: legacyMaterialCatalogTimestamp
  }).then(snapshot => {
    applyMaterialCatalog(snapshot.records, Number(snapshot.updatedAt) || Date.now());
    if (snapshot.error) {
      showToast(
        `Cache Material Code ditampilkan, tetapi sinkronisasi gagal: ${snapshot.error}`,
        "error",
        "Sinkronisasi Material Code Gagal"
      );
    }
    try {
      localStorage.removeItem(STORAGE_KEY_MATERIALS);
      localStorage.removeItem(STORAGE_KEY_MATERIALS_META);
    } catch (err) {
      console.warn("Cache lama Material Code tidak dapat dihapus.", err);
    }
  }).catch(err => {
    showToast(
      hasCachedMaterialCatalog
        ? `Cache Material Code ditampilkan, tetapi sinkronisasi gagal: ${err.message}`
        : err.message,
      "error",
      "Sinkronisasi Material Code Gagal"
    );
  }).finally(() => {
    legacyMaterialCatalog = [];
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
    const row = inputEl.closest("tr");
    const form = inputEl.closest(".sj-inline-edit-panel");
    const itemEl = row
      ? row.querySelector(".inp-item")
      : form ? form.querySelector("#inlineEditItem") : document.getElementById("editItem");
    if (itemEl && matched.itemName) itemEl.value = matched.itemName;
    const satuanEl = row
      ? row.querySelector(".inp-satuan")
      : form ? form.querySelector("#inlineEditSatuan") : document.getElementById("editSatuan");
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
      <div class="doc-card-item ${isActive ? "active" : ""}" data-no-doc="${escapeHtml(d.noDoc)}" onclick="selectDocument(this.dataset.noDoc)">
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
  isInlineEditingDocument = false;
  pendingDeletedRowIndices = [];
  renderDocList();
  switchView("detail");
  renderDetailDocument();
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
    const rawNoDoc = String(getRecordFieldValue(r, "noDoc") || "").trim();
    const documentKey = rawNoDoc || "(Tanpa No Doc)";
    const noDocVal = rawNoDoc || "-";
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
          return `<div class="record-item-line">${escapeHtml(text)}</div>`;
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
      <tr class="clickable-row" tabindex="0" data-no-doc="${escapeHtml(documentKey)}" data-row-index="${escapeHtml(String(r.rowIndex))}"
        title="Klik untuk membuka detail dan edit dokumen"
        onclick="selectDocument(this.dataset.noDoc)"
        onkeydown="handleRecordRowKeydown(event, this.dataset.noDoc)">
        <td class="text-center">${idx + 1}</td>
        ${cellsHtml}
      </tr>
    `;
  }).join("");
}

function handleRecordRowKeydown(event, noDoc) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDocument(noDoc);
  }
}

function renderDetailDocument() {
  const container = document.getElementById("docDetailBody");
  if (!selectedNoDoc) {
    document.getElementById("activeDocInfo").textContent = "Semua Dokumen";
    container.innerHTML = `<div class="empty-box">Pilih nomor dokumen di panel kiri untuk melihat rincian Surat Jalan.</div>`;
    return;
  }

  const lines = allRecords.filter(r => {
    const noDoc = String(getRecordFieldValue(r, "noDoc") || "").trim() || "(Tanpa No Doc)";
    return noDoc === selectedNoDoc;
  });
  if (lines.length === 0) {
    document.getElementById("activeDocInfo").textContent = "Dokumen tidak ditemukan";
    container.innerHTML = `<div class="empty-box">Dokumen tidak ditemukan.</div>`;
    return;
  }

  const head = lines[0];
  document.getElementById("activeDocInfo").textContent = `Dokumen: ${selectedNoDoc}`;
  const inputTypeVal = String(getRecordFieldValue(head, "inputType") || getRecordFieldValue(head, "input") || "Barang Masuk");
  const isIn = inputTypeVal.toLowerCase().includes("masuk");
  const totalQty = lines.reduce((acc, cur) => acc + (Number(getRecordFieldValue(cur, "qty")) || 0), 0);
  const hasItemNoCol = sheetColumns.some(c => c.key === "itemNo");
  const hasSatuanCol = sheetColumns.some(c => c.key === "satuan");
  const firstItem = lines[0];
  const editForm = isInlineEditingDocument ? `
    <section class="sj-inline-edit-panel">
      <div class="sj-inline-edit-heading">
        <div>
          <strong>Edit Dokumen Surat Jalan</strong>
          <span>Ubah informasi transaksi dan daftar item. Total item dihitung otomatis.</span>
        </div>
        <div class="sj-inline-edit-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="cancelInlineEditDocument()">Batal</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineDocumentEdits()">
            <i class="bi bi-check2-circle"></i> Simpan Perubahan
          </button>
        </div>
      </div>
      <div class="sj-inline-edit-grid">
        <label class="sj-inline-edit-field">Tanggal *
          <input type="date" id="inlineDocTanggal" value="${escapeHtml(String(getRecordFieldValue(firstItem, "tanggal") || ""))}" />
        </label>
        <label class="sj-inline-edit-field">No Document *
          <input type="text" id="inlineDocNo" value="${escapeHtml(String(getRecordFieldValue(firstItem, "noDoc") || ""))}" />
        </label>
        <label class="sj-inline-edit-field">Jenis Transaksi
          <select id="inlineDocInputType">
            <option value="Barang Masuk" ${inputTypeVal.toLowerCase().includes("masuk") ? "selected" : ""}>Barang Masuk</option>
            <option value="Barang Keluar" ${inputTypeVal.toLowerCase().includes("keluar") ? "selected" : ""}>Barang Keluar</option>
          </select>
        </label>
        <label class="sj-inline-edit-field">Pengirim
          <input type="text" id="inlineDocPengirim" value="${escapeHtml(String(getRecordFieldValue(firstItem, "pengirim") || ""))}" />
        </label>
        <label class="sj-inline-edit-field">Tujuan
          <input type="text" id="inlineDocTujuan" value="${escapeHtml(String(getRecordFieldValue(firstItem, "tujuan") || ""))}" />
        </label>
        <div class="sj-inline-total"><span>Total Item / Qty</span><strong>${lines.length} Item (${totalQty} Qty)</strong></div>
      </div>
    </section>
    <div class="line-items-box">
      <div class="line-items-head">
        <span>Daftar Item Barang</span>
        <button type="button" class="btn btn-success btn-sm" onclick="addInlineDocumentItemRow()">
          <i class="bi bi-plus-lg"></i> Tambah Item
        </button>
      </div>
      <div class="line-items-scroll">
        <table class="sj-table">
          <thead><tr>
            <th style="width:40px;">No</th>
            ${hasItemNoCol ? `<th style="width:130px;">Item No</th>` : ""}
            <th style="min-width:250px;">Nama Item / Barang *</th>
            <th style="width:80px;">Qty *</th>
            ${hasSatuanCol ? `<th style="width:85px;">Satuan</th>` : ""}
            <th>Keterangan</th>
            <th style="width:45px;">Hapus</th>
          </tr></thead>
          <tbody id="inlineDocumentItemsBody">${lines.map((line, index) => renderInlineDocumentItemRow(line, index + 1)).join("")}</tbody>
        </table>
      </div>
    </div>
  ` : "";

  container.innerHTML = `
    <div class="doc-summary-box">
      <div>
        <div style="font-size:15px; font-weight:800; color:var(--text-primary);">${escapeHtml(selectedNoDoc)}</div>
        <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Rekapitulasi Surat Jalan Barang Masuk/Keluar</div>
      </div>
      <div class="no-print" style="display:flex; gap:6px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak</button>
        ${isInlineEditingDocument
          ? ""
          : `<button type="button" class="btn btn-primary btn-sm" onclick="startInlineEditDocument()"><i class="bi bi-pencil-square"></i> Edit</button>
             <button type="button" class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="confirmDeleteDocument('${escapeHtml(selectedNoDoc)}')">
               <i class="bi bi-trash3"></i> Hapus Dokumen
             </button>`}
      </div>
    </div>

    ${isInlineEditingDocument ? "" : `<div class="doc-meta-grid">
      <div class="meta-item"><span>Tanggal</span><strong>${escapeHtml(String(getRecordFieldValue(head, "tanggal") || "-"))}</strong></div>
      <div class="meta-item"><span>Jenis Transaksi</span><strong><span class="pill-type ${isIn ? "pill-in" : "pill-out"}">${escapeHtml(inputTypeVal)}</span></strong></div>
      <div class="meta-item"><span>Pengirim</span><strong>${escapeHtml(String(getRecordFieldValue(head, "pengirim") || "-"))}</strong></div>
      <div class="meta-item"><span>Tujuan</span><strong>${escapeHtml(String(getRecordFieldValue(head, "tujuan") || "-"))}</strong></div>
      <div class="meta-item"><span>Total Item / Qty</span><strong>${lines.length} Item (${totalQty} Qty)</strong></div>
    </div>`}

    ${editForm}

    ${isInlineEditingDocument ? "" : `<table class="sj-table">
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
          <tr>
            <td class="text-center">${idx + 1}</td>
            ${hasItemNoCol ? `<td class="text-center">${escapeHtml(String(getRecordFieldValue(ln, "itemNo") || ""))}</td>` : ""}
            <td class="fw-bold td-item">${escapeHtml(String(getRecordFieldValue(ln, "item") || ""))}</td>
            <td class="text-center fw-bold">${Number(getRecordFieldValue(ln, "qty")) || 0}</td>
            ${hasSatuanCol ? `<td class="text-center">${escapeHtml(String(getRecordFieldValue(ln, "satuan") || ""))}</td>` : ""}
            <td>${escapeHtml(String(getRecordFieldValue(ln, "keterangan") || ""))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`}
  `;
  if (isInlineEditingDocument) {
    const itemsBody = document.getElementById("inlineDocumentItemsBody");
    itemsBody.addEventListener("input", updateInlineDocumentTotals);
  }
}

function startInlineEditDocument() {
  isInlineEditingDocument = true;
  pendingDeletedRowIndices = [];
  renderDetailDocument();
}

function cancelInlineEditDocument() {
  isInlineEditingDocument = false;
  pendingDeletedRowIndices = [];
  renderDetailDocument();
}

function renderInlineDocumentItemRow(item, sequence, isNew = false) {
  const hasItemNoCol = sheetColumns.some(column => column.key === "itemNo");
  const hasSatuanCol = sheetColumns.some(column => column.key === "satuan");
  const rowAttrs = isNew
    ? 'data-is-new="1"'
    : `data-is-new="0" data-row-index="${escapeHtml(String(item.rowIndex))}"`;
  return `<tr ${rowAttrs}>
    <td class="text-center row-num">${sequence}</td>
    ${hasItemNoCol ? `<td><input type="text" list="materialCodeDatalist" class="modal-input inp-itemno text-center"
      value="${escapeHtml(String(getRecordFieldValue(item, "itemNo") || ""))}" placeholder="Item No..."
      oninput="handleItemNoInput(this, true)" onchange="handleItemNoInput(this, true)" /></td>` : ""}
    <td><textarea class="modal-input inp-item" rows="1" placeholder="Nama barang...">${escapeHtml(String(getRecordFieldValue(item, "item") || ""))}</textarea></td>
    <td><input type="number" class="modal-input inp-qty text-center" min="0" step="any"
      value="${escapeHtml(String(getRecordFieldValue(item, "qty") ?? 0))}" /></td>
    ${hasSatuanCol ? `<td><input type="text" class="modal-input inp-satuan text-center"
      value="${escapeHtml(String(getRecordFieldValue(item, "satuan") || ""))}" /></td>` : ""}
    <td><input type="text" class="modal-input inp-ket" value="${escapeHtml(String(getRecordFieldValue(item, "keterangan") || ""))}" placeholder="Keterangan..." /></td>
    <td class="text-center"><button type="button" class="btn-icon del" onclick="removeInlineDocumentItemRow(this)" title="Hapus item">
      <i class="bi bi-x-lg"></i>
    </button></td>
  </tr>`;
}

function addInlineDocumentItemRow() {
  const tbody = document.getElementById("inlineDocumentItemsBody");
  if (!tbody) return;
  const temp = document.createElement("tbody");
  temp.innerHTML = renderInlineDocumentItemRow({ item: "", itemNo: "", qty: 1, satuan: "", keterangan: "" }, tbody.children.length + 1, true);
  tbody.appendChild(temp.firstElementChild);
  updateInlineDocumentTotals();
}

function removeInlineDocumentItemRow(button) {
  const row = button.closest("tr");
  const tbody = document.getElementById("inlineDocumentItemsBody");
  if (!row || !tbody) return;
  if (tbody.children.length <= 1) return showToast("Minimal harus ada 1 item pada dokumen.", "error");
  if (row.dataset.isNew !== "1") {
    const rowIndex = Number(row.dataset.rowIndex);
    if (rowIndex) pendingDeletedRowIndices.push(rowIndex);
  }
  row.remove();
  Array.from(tbody.children).forEach((itemRow, index) => {
    itemRow.querySelector(".row-num").textContent = String(index + 1);
  });
  updateInlineDocumentTotals();
}

function updateInlineDocumentTotals() {
  const tbody = document.getElementById("inlineDocumentItemsBody");
  const total = document.querySelector(".sj-inline-total strong");
  if (!tbody || !total) return;
  const qty = Array.from(tbody.querySelectorAll(".inp-qty"))
    .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  total.textContent = `${tbody.children.length} Item (${qty} Qty)`;
}

async function saveInlineDocumentEdits() {
  const header = {
    tanggal: document.getElementById("inlineDocTanggal").value,
    noDoc: document.getElementById("inlineDocNo").value.trim(),
    inputType: document.getElementById("inlineDocInputType").value,
    pengirim: document.getElementById("inlineDocPengirim").value.trim(),
    tujuan: document.getElementById("inlineDocTujuan").value.trim()
  };
  if (!header.tanggal || !header.noDoc) {
    return showToast("Tanggal dan No Document wajib diisi.", "error");
  }

  const existingItems = [];
  const newItems = [];
  const itemRows = Array.from(document.querySelectorAll("#inlineDocumentItemsBody tr"));
  for (let index = 0; index < itemRows.length; index++) {
    const row = itemRows[index];
    const item = row.querySelector(".inp-item").value.trim();
    const itemNoInput = row.querySelector(".inp-itemno");
    const satuanInput = row.querySelector(".inp-satuan");
    const rawQty = row.querySelector(".inp-qty").value.trim();
    const qty = rawQty === "" ? NaN : Number(rawQty);
    if ((!item && !(itemNoInput && itemNoInput.value.trim())) ||
        !Number.isFinite(qty) || qty < 0) {
      return showToast(`Item #${index + 1}: isi Item/Nama Barang dan Qty yang valid.`, "error", "Data Item Tidak Valid");
    }

    const payloadItem = {
      item,
      itemNo: itemNoInput ? itemNoInput.value.trim() : "",
      qty,
      satuan: satuanInput ? satuanInput.value.trim() : "",
      keterangan: row.querySelector(".inp-ket").value.trim()
    };
    if (row.dataset.isNew === "1") newItems.push(payloadItem);
    else existingItems.push({ ...payloadItem, rowIndex: Number(row.dataset.rowIndex) });
  }
  if (!existingItems.length && !newItems.length) {
    return showToast("Dokumen harus memiliki minimal satu item.", "error");
  }

  showSuratJalanLoading("Menyimpan Perubahan Surat Jalan...");
  try {
    const response = await callGasApi({
      action: "saveDocumentEdits",
      docUpdate: {
        originalNoDoc: selectedNoDoc,
        header,
        existingItems,
        newItems,
        deletedRowIndices: pendingDeletedRowIndices
      }
    });
    Swal.close();
    sheetColumns = Array.isArray(response.columns) && response.columns.length ? response.columns : sheetColumns;
    allRecords = response.records || [];
    selectedNoDoc = header.noDoc;
    isInlineEditingDocument = false;
    pendingDeletedRowIndices = [];
    applyFilters();
    saveLocalSnapshot();
    showToast(`Perubahan dokumen ${header.noDoc} berhasil disimpan.`, "success");
  } catch (error) {
    Swal.close();
    Swal.fire({ icon: "error", title: "Gagal Menyimpan", text: error.message });
  }
}

function showSuratJalanLoading(title) {
  Swal.fire({
    title,
    html: `<div class="mr-save-caption" role="status" aria-live="polite">
      <span class="mr-save-live-dot"></span><span>Mohon tunggu, data sedang diproses</span>
    </div>`,
    customClass: { popup: "mr-save-popup", title: "mr-save-title", htmlContainer: "mr-save-html" },
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });
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
  showSuratJalanLoading("Menyimpan Surat Jalan...");

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
    isInlineEditingDocument = false;
    applyFilters();
    saveLocalSnapshot();
    showToast(`Surat Jalan ${noDoc} (${items.length} item) berhasil disimpan.`, "success");
  } catch (err) {
    Swal.close();
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: err.message });
  }
}

// ============================================================
// DELETE DOCUMENT
// ============================================================
async function confirmDeleteDocument(noDoc) {
  const result = await Swal.fire({
    title: "Hapus Seluruh Dokumen?",
    text: `Semua baris item dengan No Document "${noDoc}" akan dihapus.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus Dokumen",
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
  });
  if (!result.isConfirmed) return;

  showSuratJalanLoading("Menghapus Dokumen...");
  try {
    const response = await callGasApi({ action: "deleteDocument", noDoc });
    Swal.close();
    allRecords = response.records || [];
    selectedNoDoc = null;
    isInlineEditingDocument = false;
    applyFilters();
    saveLocalSnapshot();
    switchView("all");
    showToast(`Dokumen ${noDoc} telah dihapus.`, "success");
  } catch (error) {
    Swal.close();
    Swal.fire({ icon: "error", title: "Gagal", text: error.message });
  }
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