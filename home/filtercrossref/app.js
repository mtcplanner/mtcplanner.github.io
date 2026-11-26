const DEFAULT_FILTER_CROSSREF_GAS_URL = "https://script.google.com/macros/s/AKfycbxHO54w2DtEjgZWmpzNlErHxEUO1s6AMQT9fkOUYLBvbqz7h7mYa9HvnOCg8k0cBACr/exec";
const FILTER_CROSSREF_API_KEY = "MTC_FILTER_CROSSREF_GAS_URL";
const FILTER_CROSSREF_CACHE_KEY = "MTC_FILTER_CROSSREF_CACHE_V1";
const INITIAL_RENDER_LIMIT = 250;
const BRANDS = [
  { key: "eom", label: "EOM" },
  { key: "donaldson", label: "Donaldson" },
  { key: "baldwin", label: "Baldwin" },
  { key: "wechai", label: "Wechai" },
  { key: "sakura", label: "Sakura" },
  { key: "detroit", label: "Detroit Filter" },
  { key: "fleetguard", label: "Fleet Guard" },
  { key: "cross", label: "Cross-Filter" }
];

let allRecords = [];
let filteredRecords = [];
let visibleLimit = INITIAL_RENDER_LIMIT;
let searchTimer = null;

function getGasUrl() {
  const saved = (localStorage.getItem(FILTER_CROSSREF_API_KEY) || "").trim();
  if (saved) return saved;
  return DEFAULT_FILTER_CROSSREF_GAS_URL.includes("PASTE_") ? "" : DEFAULT_FILTER_CROSSREF_GAS_URL;
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  const content = document.createElement("div");
  const titleEl = document.createElement("div");
  const messageEl = document.createElement("div");
  titleEl.className = "toast-title";
  titleEl.textContent = title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi");
  messageEl.className = "toast-message";
  messageEl.textContent = message;
  const iconEl = document.createElement("div");
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

function restoreCache() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(FILTER_CROSSREF_CACHE_KEY) || "null");
    if (!snapshot || !Array.isArray(snapshot.records)) return false;
    allRecords = snapshot.records;
    updateTypeFilter();
    applyFilters();
    document.getElementById("syncStatus").textContent = "• Data lokal ditampilkan";
    return true;
  } catch (error) {
    console.warn("Cache FilterCrossRef tidak dapat dibaca.", error);
    return false;
  }
}

function saveCache(records) {
  try {
    localStorage.setItem(FILTER_CROSSREF_CACHE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      records
    }));
  } catch (error) {
    console.warn("Cache FilterCrossRef tidak dapat disimpan.", error);
    showToast("Data terbaru tampil, tetapi cache browser tidak dapat disimpan.", "info");
  }
}

async function callGasApi(payload) {
  const url = getGasUrl();
  if (!url) {
    throw new Error("URL Web App GAS FilterCrossRef belum diatur.");
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
  if (data.status !== "success") throw new Error(data.message || "GAS gagal membaca data FilterCrossRef.");
  return data;
}

async function loadData(forceRefresh = false) {
  const status = document.getElementById("syncStatus");
  if (!allRecords.length) {
    document.getElementById("crossrefTableBody").innerHTML =
      '<tr><td colspan="20" class="empty-box">Memuat daftar referensi...</td></tr>';
  }
  status.textContent = "• Menyinkronkan data terbaru...";

  try {
    const response = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    allRecords = Array.isArray(response.records) ? response.records : [];
    updateTypeFilter();
    applyFilters();
    saveCache(allRecords);
    status.textContent = `• Sinkronisasi selesai ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
    if (forceRefresh) showToast("Data FilterCrossRef berhasil diperbarui.");
  } catch (error) {
    status.textContent = allRecords.length ? "• Menampilkan cache lokal — sinkronisasi gagal" : "• Gagal memuat data";
    if (!allRecords.length) {
      document.getElementById("crossrefTableBody").innerHTML =
        `<tr><td colspan="20" class="empty-box crossref-error">${escapeHtml(error.message)}</td></tr>`;
    }
    showToast(error.message, "error", "Koneksi Gagal");
  }
}

function updateTypeFilter() {
  const select = document.getElementById("filterType");
  const previous = select.value;
  const types = [...new Set(allRecords.map(record => String(record.type || "").trim()).filter(type => type && type !== "-"))]
    .sort((a, b) => a.localeCompare(b, "id"));
  select.innerHTML = '<option value="ALL">Semua Type</option>' +
    types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  if (types.includes(previous)) select.value = previous;
}

function applyFilters(resetLimit = true) {
  const term = document.getElementById("filterSearch").value.trim().toLowerCase();
  const type = document.getElementById("filterType").value;
  filteredRecords = allRecords.filter(record => {
    if (type !== "ALL" && String(record.type || "") !== type) return false;
    if (!term) return true;
    const values = [record.type, record.namaItem, record.desc];
    BRANDS.forEach(brand => {
      const item = record[brand.key] || {};
      values.push(item.bmc, item.pn);
    });
    return values.some(value => String(value || "").toLowerCase().includes(term));
  });
  if (resetLimit) visibleLimit = INITIAL_RENDER_LIMIT;
  renderTable();
}

function renderTable() {
  const body = document.getElementById("crossrefTableBody");
  const rows = filteredRecords.slice(0, visibleLimit);
  document.getElementById("totalCount").textContent = allRecords.length.toLocaleString("id-ID");
  document.getElementById("filteredCount").textContent = filteredRecords.length.toLocaleString("id-ID");
  document.getElementById("resultMeta").textContent = `${filteredRecords.length.toLocaleString("id-ID")} data`;
  document.getElementById("showingMeta").textContent =
    `Menampilkan ${rows.length.toLocaleString("id-ID")} dari ${filteredRecords.length.toLocaleString("id-ID")} data`;
  document.getElementById("btnLoadMore").hidden = rows.length >= filteredRecords.length;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="20" class="empty-box">Tidak ada data yang sesuai dengan pencarian.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((record, index) => {
    const brandCells = BRANDS.map(brand => {
      const item = record[brand.key] || {};
      return `<td>${escapeHtml(item.bmc || "-")}</td><td>${escapeHtml(item.pn || "-")}</td>`;
    }).join("");
    return `<tr>
      <td class="crossref-number">${(index + 1).toLocaleString("id-ID")}</td>
      <td>${escapeHtml(record.type || "-")}</td>
      <td>${escapeHtml(record.namaItem || "-")}</td>
      <td>${escapeHtml(record.desc || "-")}</td>
      ${brandCells}
    </tr>`;
  }).join("");
}

function showMore() {
  visibleLimit += INITIAL_RENDER_LIMIT;
  renderTable();
}

function exportToExcel() {
  if (!window.XLSX) {
    showToast("Library export Excel belum tersedia. Muat ulang halaman dan coba lagi.", "error");
    return;
  }
  const data = filteredRecords.map(record => {
    const row = {
      Type: record.type || "",
      "Nama Item": record.namaItem || "",
      "Description on System": record.desc || ""
    };
    BRANDS.forEach(brand => {
      const item = record[brand.key] || {};
      row[`${brand.label} BMC`] = item.bmc || "";
      row[`${brand.label} Part No`] = item.pn || "";
    });
    return row;
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Filter CrossRef");
  XLSX.writeFile(workbook, "Filter-CrossReference.xlsx");
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
  localStorage.setItem(FILTER_CROSSREF_API_KEY, value);
  closeApiConfig();
  loadData(true);
}

document.addEventListener("DOMContentLoaded", () => {
  restoreCache();
  document.getElementById("filterType").addEventListener("change", () => applyFilters());
  document.getElementById("filterSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters(), 150);
  });
  document.getElementById("apiConfigBackdrop").addEventListener("click", event => {
    if (event.target.id === "apiConfigBackdrop") closeApiConfig();
  });
  loadData();
});
