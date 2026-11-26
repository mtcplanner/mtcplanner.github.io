const DEFAULT_FILTER_CROSSREF_GAS_URL = "https://script.google.com/macros/s/AKfycbxHO54w2DtEjgZWmpzNlErHxEUO1s6AMQT9fkOUYLBvbqz7h7mYa9HvnOCg8k0cBACr/exec";
const FILTER_CROSSREF_API_KEY = "MTC_FILTER_CROSSREF_GAS_URL";
const FILTER_CROSSREF_CACHE_KEY = "MTC_FILTER_CROSSREF_CACHE_V1";
const INITIAL_RENDER_LIMIT = 250;
const BRANDS = [
  { key: "eom", label: "OEM" },
  { key: "cross", label: "Cross-Reference" },
  { key: "donaldson", label: "Donaldson" },
  { key: "baldwin", label: "Baldwin" },
  { key: "wechai", label: "Wechai" },
  { key: "sakura", label: "Sakura" },
  { key: "detroit", label: "Detroit Filter" },
  { key: "fleetguard", label: "Fleet Guard" }
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
    document.getElementById("crossrefResults").innerHTML =
      '<div class="empty-box">Memuat daftar referensi...</div>';
  }
  status.textContent = "• Menyinkronkan data terbaru...";

  try {
    const response = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    allRecords = Array.isArray(response.records) ? response.records : [];
    applyFilters();
    saveCache(allRecords);
    status.textContent = `• Sinkronisasi selesai ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
    if (forceRefresh) showToast("Data FilterCrossRef berhasil diperbarui.");
  } catch (error) {
    status.textContent = allRecords.length ? "• Menampilkan cache lokal — sinkronisasi gagal" : "• Gagal memuat data";
    if (!allRecords.length) {
      document.getElementById("crossrefResults").innerHTML =
        `<div class="empty-box crossref-error">${escapeHtml(error.message)}</div>`;
    }
    showToast(error.message, "error", "Koneksi Gagal");
  }
}

function applyFilters(resetLimit = true) {
  const type = document.getElementById("filterType").value.trim().toLowerCase();
  const name = document.getElementById("filterName").value.trim().toLowerCase();
  const partNo = document.getElementById("filterPartNo").value.trim().toLowerCase();
  filteredRecords = allRecords.filter(record => {
    const recordType = String(record.type || "").toLowerCase();
    const recordName = String(record.namaItem || "").toLowerCase();
    const matchesPartNo = BRANDS.some(brand => {
      const item = record[brand.key] || {};
      return String(item.pn || "").toLowerCase().includes(partNo);
    });
    return (!type || recordType.includes(type)) &&
      (!name || recordName.includes(name)) &&
      (!partNo || matchesPartNo);
  });
  if (resetLimit) visibleLimit = INITIAL_RENDER_LIMIT;
  renderResults();
}

function renderResults() {
  const container = document.getElementById("crossrefResults");
  const records = filteredRecords.slice(0, visibleLimit);
  document.getElementById("resultMeta").textContent = `${filteredRecords.length.toLocaleString("id-ID")} data`;
  document.getElementById("showingMeta").textContent =
    `Menampilkan ${records.length.toLocaleString("id-ID")} dari ${filteredRecords.length.toLocaleString("id-ID")} filter`;
  document.getElementById("btnLoadMore").hidden = records.length >= filteredRecords.length;

  if (!records.length) {
    container.innerHTML = '<div class="empty-box">Tidak ada filter yang sesuai dengan pencarian.</div>';
    return;
  }

  container.innerHTML = records.map(record => {
    const brandRows = BRANDS.map((brand, index) => {
      const item = record[brand.key] || {};
      return `<tr>
        <td class="crossref-number">${(index + 1).toLocaleString("id-ID")}</td>
        <td><span class="crossref-brand">${escapeHtml(brand.label)}</span></td>
        <td>${escapeHtml(item.bmc || "-")}</td>
        <td class="crossref-part-number">${escapeHtml(item.pn || "-")}</td>
      </tr>`;
    }).join("");

    return `<article class="crossref-card">
      <div class="crossref-card-heading">
        <div class="crossref-engine">
          <span class="crossref-engine-badge">MODEL ENGINE</span>
          <strong>${escapeHtml(record.type || "-")}</strong>
        </div>
        <h2>${escapeHtml(record.namaItem || "-")}</h2>
        <p>${escapeHtml(record.desc || "-")}</p>
      </div>
      <div class="crossref-card-table-wrap">
        <table class="mr-table crossref-card-table">
          <thead><tr><th>No</th><th>Brand / Merek</th><th>BMC</th><th>Part Number</th></tr></thead>
          <tbody>${brandRows}</tbody>
        </table>
      </div>
    </article>`;
  }).join("");
}

function showMore() {
  visibleLimit += INITIAL_RENDER_LIMIT;
  renderResults();
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
  document.getElementById("filterForm").addEventListener("submit", event => {
    event.preventDefault();
    applyFilters();
  });
  ["filterType", "filterName", "filterPartNo"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyFilters(), 150);
    });
  });
  document.getElementById("apiConfigBackdrop").addEventListener("click", event => {
    if (event.target.id === "apiConfigBackdrop") closeApiConfig();
  });
  loadData();
});
