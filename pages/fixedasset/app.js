const FIXED_ASSET_API_KEY = "MTC_FIXED_ASSET_GAS_URL";
const DEFAULT_FIXED_ASSET_API_URL = "https://script.google.com/macros/s/AKfycbwtezzQFRiqUdN6FrzJ1KF-3uN-AR8kNAG_vl3KnI5zcwm8ZXa7hgtEhEc-sJ8nNsf90w/exec";
const FIXED_ASSET_CACHE_KEY = "MTC_FIXED_ASSET_DATA_SNAPSHOT_V1";
const INITIAL_ASSET_RENDER_LIMIT = 250;
const FIXED_ASSET_FIELDS = [
  "equipmentNo",
  "equipmentName",
  "type",
  "serialNo",
  "hm",
  "lastServiceDate",
  "lastOverhaulDate"
];

let fixedAssetRecords = [];
let filteredAssetRecords = [];
let editingAssetRowIndex = null;
let showAllAssetRows = false;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveUserRole() {
  const params = new URLSearchParams(window.location.search);
  const urlRole = params.get("role");
  if (urlRole) sessionStorage.setItem("MTC_USER_ROLE", urlRole.trim());
  const portalUser = window.parent && (window.parent.currentUser || window.parent._currentUser);
  if (portalUser && (portalUser.role || portalUser.level)) {
    return String(portalUser.role || portalUser.level).trim();
  }
  return (sessionStorage.getItem("MTC_USER_ROLE") || localStorage.getItem("MTC_USER_ROLE") || "").trim();
}

function applyDeveloperAccess() {
  const button = document.getElementById("btnApiConfig");
  if (button) button.style.display = resolveUserRole().toLowerCase() === "developer" ? "inline-flex" : "none";
}

function getFixedAssetApiUrl() {
  return (localStorage.getItem(FIXED_ASSET_API_KEY) || DEFAULT_FIXED_ASSET_API_URL).trim();
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  const defaultTitle = type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi";
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${escapeHtml(title || defaultTitle)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3400);
}

async function callFixedAssetApi(payload) {
  const url = getFixedAssetApiUrl();
  if (!url) {
    if (resolveUserRole().toLowerCase() === "developer") openApiConfigModal();
    throw new Error("URL Web App GAS Fixed Asset belum diatur.");
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      mode: "cors",
      redirect: "follow",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error("Gagal terhubung ke GAS Fixed Asset. Periksa deployment Web App dan aksesnya.");
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Respons GAS Fixed Asset bukan JSON valid.");
  }
  if (!response.ok) throw new Error(`Permintaan GAS gagal (${response.status}).`);
  if (data.status === "error" || data.success === false) {
    throw new Error(data.message || "GAS Fixed Asset melaporkan kegagalan.");
  }
  return data;
}

function saveFixedAssetSnapshot() {
  try {
    localStorage.setItem(FIXED_ASSET_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      records: fixedAssetRecords
    }));
  } catch (error) {
    console.warn("Gagal menyimpan cache Fixed Asset ke localStorage.", error);
  }
}

function restoreFixedAssetSnapshot() {
  try {
    const raw = localStorage.getItem(FIXED_ASSET_CACHE_KEY);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.records)) return false;
    fixedAssetRecords = snapshot.records;
    updateTypeFilter();
    applyAssetFilters();
    return true;
  } catch (error) {
    console.warn("Gagal membaca cache Fixed Asset dari localStorage.", error);
    return false;
  }
}

function setSyncStatus(text) {
  const meta = document.getElementById("fixedAssetSummaryMeta");
  if (meta) meta.textContent = `• ${text}`;
}

async function loadFixedAssets(forceRefresh = false, silentBackground = false) {
  const body = document.getElementById("fixedAssetTableBody");
  if (!silentBackground && !fixedAssetRecords.length) {
    body.innerHTML = '<tr><td colspan="9" class="fixedasset-loading-cell">Memuat data Fixed Asset...</td></tr>';
  }
  if (silentBackground) setSyncStatus("Menyinkronkan data terbaru...");

  try {
    const response = await callFixedAssetApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    if (!Array.isArray(response.records)) {
      throw new Error("Respons GAS tidak menyertakan daftar aset.");
    }
    fixedAssetRecords = response.records;
    updateTypeFilter();
    applyAssetFilters();
    saveFixedAssetSnapshot();
    setSyncStatus(`${fixedAssetRecords.length} aset • data tersinkron`);
    if (!silentBackground || forceRefresh) showToast("Data Fixed Asset berhasil diperbarui.", "success");
  } catch (error) {
    if (silentBackground) {
      setSyncStatus(`${fixedAssetRecords.length} aset • cache lokal`);
      showToast(`Cache tetap ditampilkan, tetapi sinkronisasi gagal: ${error.message}`, "error", "Sinkronisasi Gagal");
    } else {
      const message = escapeHtml(error.message);
      body.innerHTML = `<tr><td colspan="9" class="fixedasset-empty-cell">${message}</td></tr>`;
      setSyncStatus("Belum tersambung");
      showToast(error.message, "error", "Koneksi Gagal");
    }
  }
}

function updateTypeFilter() {
  const select = document.getElementById("filterType");
  const previous = select.value;
  const types = [...new Set(fixedAssetRecords.map(record => String(record.type || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id"));
  select.innerHTML = '<option value="ALL">Semua Tipe</option>' +
    types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  if (types.includes(previous)) select.value = previous;
}

function applyAssetFilters() {
  const query = document.getElementById("filterSearch").value.trim().toLocaleLowerCase("id");
  const type = document.getElementById("filterType").value;
  filteredAssetRecords = fixedAssetRecords.filter(record => {
    if (type !== "ALL" && String(record.type || "") !== type) return false;
    if (!query) return true;
    return FIXED_ASSET_FIELDS.some(field =>
      String(record[field] == null ? "" : record[field]).toLocaleLowerCase("id").includes(query)
    );
  });
  showAllAssetRows = false;
  renderFixedAssetTable();
  updateAssetSummary();
}

function updateAssetSummary() {
  const types = new Set(fixedAssetRecords.map(record => String(record.type || "").trim()).filter(Boolean));
  const missingSerial = fixedAssetRecords.filter(record => !String(record.serialNo || "").trim()).length;
  document.getElementById("assetCount").textContent = String(fixedAssetRecords.length);
  document.getElementById("assetTypeCount").textContent = String(types.size);
  document.getElementById("assetMissingSerialCount").textContent = String(missingSerial);
  document.getElementById("visibleAssetCount").textContent = String(filteredAssetRecords.length);
}

function renderFixedAssetTable() {
  const body = document.getElementById("fixedAssetTableBody");
  const limit = showAllAssetRows ? filteredAssetRecords.length : INITIAL_ASSET_RENDER_LIMIT;
  const records = filteredAssetRecords.slice(0, limit);
  document.getElementById("btnShowAllAssets").hidden = filteredAssetRecords.length <= limit;

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="9" class="fixedasset-empty-cell">Tidak ada data aset yang cocok.</td></tr>';
    return;
  }
  body.innerHTML = records.map((record, index) => {
    const rowIndex = Number(record.rowIndex);
    return editingAssetRowIndex === rowIndex
      ? renderEditingAssetRow(record, index)
      : renderAssetRow(record, index);
  }).join("");
}

function renderAssetRow(record, index) {
  const rowIndex = Number(record.rowIndex);
  return `
    <tr data-row-index="${rowIndex}">
      <td>${index + 1}</td>
      <td>${escapeHtml(record.equipmentNo)}</td>
      <td>${escapeHtml(record.equipmentName)}</td>
      <td>${escapeHtml(record.type)}</td>
      <td>${escapeHtml(record.serialNo)}</td>
      <td>${escapeHtml(record.hm)}</td>
      <td>${escapeHtml(formatDisplayDate(record.lastServiceDate))}</td>
      <td>${escapeHtml(formatDisplayDate(record.lastOverhaulDate))}</td>
      <td class="fixedasset-actions-cell">
        <div class="fixedasset-row-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="startEditAsset(${rowIndex})" title="Edit langsung di tabel">
            <i class="bi bi-pencil-square"></i> Edit
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="deleteFixedAsset(${rowIndex})" title="Hapus aset">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
}

function renderEditingAssetRow(record, index) {
  const rowIndex = Number(record.rowIndex);
  const textInput = (field, value) =>
    `<input class="ctrl-input" type="text" data-field="${field}" value="${escapeHtml(value)}" aria-label="${field}" />`;
  const numberInput = `<input class="ctrl-input" type="number" min="0" step="any" data-field="hm" value="${escapeHtml(record.hm)}" aria-label="HM" />`;
  const dateInput = field =>
    `<input class="ctrl-input" type="date" data-field="${field}" value="${escapeHtml(toIsoDate(record[field]))}" aria-label="${field}" />`;
  return `
    <tr data-row-index="${rowIndex}" class="fixedasset-editing-row">
      <td>${index + 1}</td>
      <td>${textInput("equipmentNo", record.equipmentNo)}</td>
      <td>${textInput("equipmentName", record.equipmentName)}</td>
      <td>${textInput("type", record.type)}</td>
      <td>${textInput("serialNo", record.serialNo)}</td>
      <td>${numberInput}</td>
      <td>${dateInput("lastServiceDate")}</td>
      <td>${dateInput("lastOverhaulDate")}</td>
      <td class="fixedasset-actions-cell">
        <div class="fixedasset-row-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineAssetEdit(${rowIndex})">
            <i class="bi bi-check2"></i> Simpan
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="cancelInlineAssetEdit()">
            Batal
          </button>
        </div>
      </td>
    </tr>`;
}

function showAllAssets() {
  showAllAssetRows = true;
  renderFixedAssetTable();
}

function startEditAsset(rowIndex) {
  editingAssetRowIndex = Number(rowIndex);
  renderFixedAssetTable();
}

function cancelInlineAssetEdit() {
  editingAssetRowIndex = null;
  renderFixedAssetTable();
}

function collectRowFields(row) {
  const fields = {};
  row.querySelectorAll("[data-field]").forEach(input => {
    fields[input.dataset.field] = input.value.trim();
  });
  return fields;
}

function validateAssetFields(fields) {
  if (!fields.equipmentNo) throw new Error("Equipment No wajib diisi.");
  if (!fields.equipmentName) throw new Error("Equipment Name wajib diisi.");
  if (fields.hm !== "" && (!Number.isFinite(Number(fields.hm)) || Number(fields.hm) < 0)) {
    throw new Error("HM harus berupa angka nol atau lebih.");
  }
  ["lastServiceDate", "lastOverhaulDate"].forEach(field => {
    if (fields[field] && !isValidIsoDate(fields[field])) {
      throw new Error("Tanggal aset tidak valid.");
    }
  });
}

async function saveInlineAssetEdit(rowIndex) {
  const row = document.querySelector(`tr[data-row-index="${Number(rowIndex)}"]`);
  if (!row) {
    showToast("Baris aset yang akan diedit tidak ditemukan.", "error");
    return;
  }
  const fields = collectRowFields(row);
  try {
    validateAssetFields(fields);
    const response = await callFixedAssetApi({
      action: "updateRecord",
      rowIndex: Number(rowIndex),
      fields
    });
    if (!Array.isArray(response.records)) throw new Error("GAS tidak mengembalikan data aset terbaru.");
    fixedAssetRecords = response.records;
    editingAssetRowIndex = null;
    updateTypeFilter();
    applyAssetFilters();
    saveFixedAssetSnapshot();
    setSyncStatus(`${fixedAssetRecords.length} aset • data tersinkron`);
    showToast("Perubahan aset berhasil disimpan.", "success");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menyimpan");
  }
}

function toggleCreateAssetForm(forceOpen) {
  const panel = document.getElementById("createAssetPanel");
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  if (shouldOpen) document.getElementById("newEquipmentNo").focus();
}

function collectCreateFields() {
  const form = document.getElementById("createAssetForm");
  const fields = {};
  FIXED_ASSET_FIELDS.forEach(field => {
    const input = form.elements.namedItem(field);
    fields[field] = input ? input.value.trim() : "";
  });
  return fields;
}

async function submitCreateAsset(event) {
  event.preventDefault();
  const fields = collectCreateFields();
  try {
    validateAssetFields(fields);
    const response = await callFixedAssetApi({ action: "createRecord", fields });
    if (!Array.isArray(response.records)) throw new Error("GAS tidak mengembalikan data aset terbaru.");
    fixedAssetRecords = response.records;
    document.getElementById("createAssetForm").reset();
    toggleCreateAssetForm(false);
    document.getElementById("filterType").value = "ALL";
    document.getElementById("filterSearch").value = "";
    updateTypeFilter();
    applyAssetFilters();
    saveFixedAssetSnapshot();
    setSyncStatus(`${fixedAssetRecords.length} aset • data tersinkron`);
    showToast("Fixed Asset baru berhasil ditambahkan.", "success");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menambahkan");
  }
}

async function deleteFixedAsset(rowIndex) {
  const record = fixedAssetRecords.find(item => Number(item.rowIndex) === Number(rowIndex));
  if (!record) {
    showToast("Aset yang akan dihapus tidak ditemukan.", "error");
    return;
  }
  const result = await Swal.fire({
    title: "Hapus Fixed Asset?",
    html: `Equipment No <strong>${escapeHtml(record.equipmentNo)}</strong> akan dihapus.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, hapus",
    cancelButtonText: "Batal",
    confirmButtonColor: "#dc2626"
  });
  if (!result.isConfirmed) return;

  try {
    const response = await callFixedAssetApi({ action: "deleteRecord", rowIndex: Number(rowIndex) });
    if (!Array.isArray(response.records)) throw new Error("GAS tidak mengembalikan data aset terbaru.");
    fixedAssetRecords = response.records;
    editingAssetRowIndex = null;
    updateTypeFilter();
    applyAssetFilters();
    saveFixedAssetSnapshot();
    setSyncStatus(`${fixedAssetRecords.length} aset • data tersinkron`);
    showToast("Fixed Asset berhasil dihapus.", "success");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menghapus");
  }
}

function formatDisplayDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return String(value || "");
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function toIsoDate(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isValidIsoDate(text) ? text : "";
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : "";
  }
  return "";
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function exportFixedAssets() {
  if (!fixedAssetRecords.length) {
    showToast("Tidak ada data Fixed Asset untuk diekspor.", "info");
    return;
  }
  if (!window.XLSX) {
    showToast("Library export Excel tidak tersedia.", "error");
    return;
  }
  const rows = filteredAssetRecords.map(record => ({
    "Equipment No": String(record.equipmentNo || ""),
    "Equipment Name": String(record.equipmentName || ""),
    "Type": String(record.type || ""),
    "Serial No": String(record.serialNo || ""),
    "HM": record.hm,
    "Last Service Date": formatDisplayDate(record.lastServiceDate),
    "Last Overhaul Date": formatDisplayDate(record.lastOverhaulDate)
  }));
  const sheet = XLSX.utils.json_to_sheet(rows, { cellDates: false });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "List_Asset");
  XLSX.writeFile(workbook, "Fixed_Asset.xlsx");
}

function openApiConfigModal() {
  document.getElementById("gasApiUrlInput").value = getFixedAssetApiUrl();
  document.getElementById("apiConfigModal").classList.add("active", "show");
}

function closeApiConfigModal() {
  document.getElementById("apiConfigModal").classList.remove("active", "show");
}

function saveApiConfig() {
  const value = document.getElementById("gasApiUrlInput").value.trim();
  if (!value.startsWith("https://script.google.com/")) {
    showToast("URL harus diawali https://script.google.com/", "error");
    return;
  }
  localStorage.setItem(FIXED_ASSET_API_KEY, value);
  closeApiConfigModal();
  loadFixedAssets(true);
}

document.addEventListener("DOMContentLoaded", () => {
  applyDeveloperAccess();
  document.getElementById("filterType").addEventListener("change", applyAssetFilters);
  document.getElementById("filterSearch").addEventListener("input", applyAssetFilters);
  const hasCache = restoreFixedAssetSnapshot();
  loadFixedAssets(false, hasCache);
});
