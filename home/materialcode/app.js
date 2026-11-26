const DEFAULT_MATERIALCODE_GAS_URL = "https://script.google.com/macros/s/AKfycbzGRpQ3sA_9Wpga7u2HwNI6rMU7VhlsFSVoE1V3Ppz0hB6I9-puoMi0MByy9m7e3xcjSg/exec";
const MATERIALCODE_API_KEY = "MTC_MATERIALCODE_GAS_URL";
const INITIAL_RENDER_LIMIT = 250;

let allRecords = [];
let filteredRecords = [];
let visibleLimit = INITIAL_RENDER_LIMIT;
let editingRowId = null;
let searchTimer = null;

function getGasUrl() {
  const saved = (localStorage.getItem(MATERIALCODE_API_KEY) || "").trim();
  if (saved) return saved;
  return DEFAULT_MATERIALCODE_GAS_URL.includes("PASTE_") ? "" : DEFAULT_MATERIALCODE_GAS_URL;
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  const content = document.createElement("div");
  const titleEl = document.createElement("div");
  const messageEl = document.createElement("div");
  const iconEl = document.createElement("div");
  titleEl.className = "toast-title";
  titleEl.textContent = title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi");
  messageEl.className = "toast-message";
  messageEl.textContent = message;
  iconEl.className = "toast-icon";
  iconEl.textContent = icon;
  content.append(titleEl, messageEl);
  toast.append(iconEl, content);
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3400);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeSearchText(value) {
  const fractions = {
    "¼": "1/4",
    "½": "1/2",
    "¾": "3/4",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
    "⅓": "1/3",
    "⅔": "2/3"
  };
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[¼½¾⅛⅜⅝⅞⅓⅔]/g, fraction => fractions[fraction])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[⁄∕]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/[^\p{L}\p{N}/.]+/gu, " ")
    .trim();
}

function prepareRecord(record) {
  return {
    ...record,
    _searchText: normalizeSearchText([
      record.bmc,
      record.partNo,
      record.itemName,
      record.itemSize,
      record.unit,
      record.price
    ].join(" "))
  };
}

function prepareRecords(records) {
  return records.map(prepareRecord);
}

async function restoreCache() {
  try {
    const snapshot = await MTCMaterialCatalogCache.getSnapshot();
    if (!snapshot || snapshot.source !== "materialcode" || !Array.isArray(snapshot.records)) return false;
    if (!snapshot.records.length || snapshot.records.some(record =>
      !Number.isInteger(Number(record.rowId)) || Number(record.rowId) < 2
    )) return false;
    allRecords = prepareRecords(snapshot.records.map(record => ({
      ...record,
      bmc: record.bmc || record.code
    })));
    updateUnitFilter();
    applyFilters();
    document.getElementById("syncStatus").textContent = "• Cache lokal ditampilkan";
    return true;
  } catch (error) {
    console.warn("Cache bersama MaterialCode tidak dapat dibaca.", error);
    return false;
  }
}

async function saveCache() {
  try {
    const cleanRecords = allRecords.map(({ _searchText, ...record }) => record);
    await MTCMaterialCatalogCache.saveMaterialCodeCatalog(cleanRecords);
  } catch (error) {
    console.warn("Cache bersama MaterialCode tidak dapat disimpan.", error);
    showToast("Data terbaru tampil, tetapi cache bersama browser tidak dapat disimpan.", "info");
  }
}

async function callGasApi(payload) {
  const url = getGasUrl();
  if (!url) {
    throw new Error("URL Web App GAS MaterialCode belum diatur.");
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
    throw new Error("Gagal terhubung ke GAS. Periksa URL Web App dan pastikan akses deployment disetel ke Anyone.");
  }

  if (!response.ok) throw new Error(`GAS mengembalikan HTTP ${response.status}.`);
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Respons GAS bukan JSON yang valid. Pastikan deployment sudah diperbarui dengan doPost.");
  }
  if (data.status !== "success") throw new Error(data.message || "GAS gagal memproses MaterialCode.");
  return data;
}

async function loadData(forceRefresh = false) {
  const status = document.getElementById("syncStatus");
  if (!allRecords.length) {
    document.getElementById("materialTableBody").innerHTML =
      '<tr><td colspan="8" class="empty-box">Memuat katalog Material Code...</td></tr>';
  }
  status.textContent = "• Menyinkronkan katalog...";

  try {
    const response = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    allRecords = prepareRecords(Array.isArray(response.records) ? response.records : []);
    editingRowId = null;
    updateUnitFilter();
    applyFilters();
    await saveCache();
    status.textContent = `• Sinkronisasi selesai ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
    if (forceRefresh) showToast("Katalog MaterialCode berhasil diperbarui.");
  } catch (error) {
    status.textContent = allRecords.length ? "• Menampilkan cache lokal — sinkronisasi gagal" : "• Gagal memuat katalog";
    if (!allRecords.length) {
      document.getElementById("materialTableBody").innerHTML =
        `<tr><td colspan="8" class="empty-box material-error">${escapeHtml(error.message)}</td></tr>`;
    }
    showToast(error.message, "error", "Koneksi Gagal");
  }
}

function updateUnitFilter() {
  const select = document.getElementById("filterUnit");
  const previous = select.value;
  const units = [...new Set(allRecords.map(record => String(record.unit || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id"));
  select.innerHTML = '<option value="ALL">Semua Unit</option>' +
    units.map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join("");
  if (units.includes(previous)) select.value = previous;
}

function applyFilters(resetLimit = true) {
  const terms = normalizeSearchText(document.getElementById("filterSearch").value)
    .split(" ")
    .filter(Boolean);
  const unit = document.getElementById("filterUnit").value;
  filteredRecords = allRecords.filter(record => {
    if (unit !== "ALL" && String(record.unit || "") !== unit) return false;
    return terms.every(term => record._searchText.includes(term));
  });
  if (resetLimit) visibleLimit = INITIAL_RENDER_LIMIT;
  renderTable();
}

function formatPrice(value) {
  if (value === "" || value == null) return "-";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "-";
  return Number(digits).toLocaleString("id-ID");
}

function renderTable() {
  const body = document.getElementById("materialTableBody");
  const rows = filteredRecords.slice(0, visibleLimit);
  document.getElementById("totalCount").textContent = allRecords.length.toLocaleString("id-ID");
  document.getElementById("filteredCount").textContent = filteredRecords.length.toLocaleString("id-ID");
  document.getElementById("resultMeta").textContent = `${filteredRecords.length.toLocaleString("id-ID")} data`;
  document.getElementById("showingMeta").textContent =
    `Menampilkan ${rows.length.toLocaleString("id-ID")} dari ${filteredRecords.length.toLocaleString("id-ID")} data`;
  document.getElementById("btnLoadMore").hidden = rows.length >= filteredRecords.length;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-box">Tidak ada data yang sesuai dengan pencarian.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((record, index) => {
    if (Number(record.rowId) === Number(editingRowId)) return renderEditRow(record, index);
    return `<tr>
      <td>${(index + 1).toLocaleString("id-ID")}</td>
      <td><strong>${escapeHtml(record.bmc || "-")}</strong></td>
      <td>${escapeHtml(record.partNo || "-")}</td>
      <td>${escapeHtml(record.itemName || "-")}</td>
      <td>${escapeHtml(record.itemSize || "-")}</td>
      <td>${escapeHtml(record.unit || "-")}</td>
      <td class="price-cell">${escapeHtml(formatPrice(record.price))}</td>
      <td class="material-actions">
        <button type="button" class="btn btn-ghost btn-sm" title="Edit langsung" onclick="startEdit(${Number(record.rowId)})">
          <i class="bi bi-pencil-square"></i>
        </button>
        <button type="button" class="btn btn-danger btn-sm" title="Hapus" onclick="deleteRecord(${Number(record.rowId)})">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`;
  }).join("");
}

function renderEditRow(record, index) {
  const fields = [
    { key: "bmc", label: "Material Code / BMC" },
    { key: "partNo", label: "Part No" },
    { key: "itemName", label: "Item Name" },
    { key: "itemSize", label: "Item Size" },
    { key: "unit", label: "Unit" },
    { key: "price", label: "Price" }
  ];
  const cells = fields.map(field =>
    `<td><input class="inline-material-input" data-field="${field.key}" aria-label="${field.label}" value="${escapeHtml(record[field.key] || "")}" /></td>`
  ).join("");
  return `<tr class="material-row-edit" data-edit-row="${Number(record.rowId)}">
    <td>${(index + 1).toLocaleString("id-ID")}</td>
    ${cells}
    <td class="material-actions">
      <button type="button" class="btn btn-primary btn-sm" title="Simpan" onclick="saveEdit(${Number(record.rowId)})">
        <i class="bi bi-check2"></i>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" title="Batal" onclick="cancelEdit()">
        <i class="bi bi-x-lg"></i>
      </button>
    </td>
  </tr>`;
}

function showMore() {
  visibleLimit += INITIAL_RENDER_LIMIT;
  renderTable();
}

function toggleCreateForm(forceOpen) {
  const panel = document.getElementById("createPanel");
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  if (shouldOpen) {
    document.getElementById("createForm").elements.namedItem("bmc").focus();
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    document.getElementById("createForm").reset();
  }
}

function readForm(form) {
  const fields = ["bmc", "partNo", "itemName", "itemSize", "unit", "price"];
  return fields.reduce((item, field) => {
    item[field] = String(form.elements.namedItem(field).value || "").trim();
    return item;
  }, {});
}

async function withLoading(title, task) {
  Swal.fire({
    title,
    html: '<div class="mr-save-caption"><span class="mr-save-live-dot"></span><span>Mohon tunggu, data sedang diproses</span></div>',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: { popup: "mr-save-popup", title: "mr-save-title", htmlContainer: "mr-save-html" },
    didOpen: () => Swal.showLoading()
  });
  try {
    return await task();
  } finally {
    Swal.close();
  }
}

async function createRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const item = readForm(form);
  if (!item.bmc || !item.itemName) {
    showToast("Material Code dan Item Name wajib diisi.", "error", "Data Belum Lengkap");
    return;
  }

  try {
    const response = await withLoading("Menyimpan Material Code...", () =>
      callGasApi({ action: "addItem", item })
    );
    if (!response.record) throw new Error("GAS tidak mengembalikan data item yang baru disimpan.");
    allRecords.push(prepareRecord(response.record));
    await saveCache();
    updateUnitFilter();
    document.getElementById("filterSearch").value = item.bmc;
    document.getElementById("filterUnit").value = "ALL";
    toggleCreateForm(false);
    applyFilters();
    showToast("Material Code berhasil ditambahkan.");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menyimpan");
  }
}

function startEdit(rowId) {
  editingRowId = Number(rowId);
  const index = filteredRecords.findIndex(record => Number(record.rowId) === editingRowId);
  if (index >= visibleLimit) visibleLimit = Math.ceil((index + 1) / INITIAL_RENDER_LIMIT) * INITIAL_RENDER_LIMIT;
  renderTable();
  const row = document.querySelector(`[data-edit-row="${editingRowId}"]`);
  if (row) row.querySelector("input").focus();
}

function cancelEdit() {
  editingRowId = null;
  renderTable();
}

async function saveEdit(rowId) {
  const row = document.querySelector(`[data-edit-row="${Number(rowId)}"]`);
  if (!row) return;
  const item = { rowId: Number(rowId) };
  row.querySelectorAll("[data-field]").forEach(input => {
    item[input.dataset.field] = input.value.trim();
  });
  if (!item.bmc) {
    showToast("Material Code / BMC wajib diisi.", "error", "Data Belum Lengkap");
    return;
  }

  try {
    const response = await withLoading("Menyimpan perubahan...", () =>
      callGasApi({ action: "updateItem", item })
    );
    if (!response.record) throw new Error("GAS tidak mengembalikan data item yang diperbarui.");
    allRecords = allRecords.map(record =>
      Number(record.rowId) === Number(rowId) ? prepareRecord(response.record) : record
    );
    editingRowId = null;
    await saveCache();
    updateUnitFilter();
    applyFilters(false);
    showToast("Perubahan Material Code berhasil disimpan.");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menyimpan");
  }
}

async function deleteRecord(rowId) {
  const answer = await Swal.fire({
    title: "Hapus Material Code?",
    text: "Masukkan password penghapusan untuk melanjutkan. Data yang dihapus tidak dapat dipulihkan.",
    input: "password",
    inputPlaceholder: "Password penghapusan",
    inputAttributes: { autocomplete: "current-password" },
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Hapus",
    cancelButtonText: "Batal",
    confirmButtonColor: "#dc2626",
    reverseButtons: true
  });
  if (!answer.isConfirmed) return;
  if (!answer.value) {
    showToast("Password wajib diisi.", "error", "Penghapusan Dibatalkan");
    return;
  }

  try {
    const response = await withLoading("Menghapus Material Code...", () =>
      callGasApi({ action: "deleteItem", rowId: Number(rowId), password: answer.value })
    );
    const deletedRowId = Number(response.deletedRowId);
    if (!deletedRowId) throw new Error("GAS tidak mengonfirmasi baris yang dihapus.");
    allRecords = allRecords
      .filter(record => Number(record.rowId) !== deletedRowId)
      .map(record => Number(record.rowId) > deletedRowId
        ? { ...record, rowId: Number(record.rowId) - 1 }
        : record);
    editingRowId = null;
    await saveCache();
    updateUnitFilter();
    applyFilters(false);
    showToast("Material Code berhasil dihapus.");
  } catch (error) {
    showToast(error.message, "error", "Gagal Menghapus");
  }
}

function exportToExcel() {
  if (!window.XLSX) {
    showToast("Library export Excel belum tersedia. Muat ulang halaman dan coba lagi.", "error");
    return;
  }
  const data = filteredRecords.map(record => ({
    "Material Code": record.bmc || "",
    "PART NO": record.partNo || "",
    "ITEM NAME": record.itemName || "",
    "ITEM SIZE": record.itemSize || "",
    UNIT: record.unit || "",
    PRICE: record.price || ""
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Database");
  XLSX.writeFile(workbook, "Material-Code.xlsx");
}

function openApiConfig() {
  document.getElementById("apiUrlInput").value = getGasUrl();
  document.getElementById("apiConfigBackdrop").hidden = false;
  document.getElementById("apiUrlInput").focus();
}

function closeApiConfig() {
  document.getElementById("apiConfigBackdrop").hidden = true;
}

function saveApiConfig() {
  const input = document.getElementById("apiUrlInput");
  const value = input.value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(value)) {
    showToast("Masukkan URL Web App GAS yang valid dan berakhiran /exec.", "error", "URL Tidak Valid");
    input.focus();
    return;
  }
  localStorage.setItem(MATERIALCODE_API_KEY, value);
  closeApiConfig();
  loadData(true);
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("filterUnit").addEventListener("change", () => applyFilters());
  document.getElementById("filterSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters(), 150);
  });
  document.getElementById("createForm").addEventListener("submit", createRecord);
  document.getElementById("apiConfigBackdrop").addEventListener("click", event => {
    if (event.target.id === "apiConfigBackdrop") closeApiConfig();
  });
  await restoreCache();
  await loadData();
});
