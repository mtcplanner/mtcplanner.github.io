// ============================================================
// KONFIGURASI ENDPOINT GOOGLE APPS SCRIPT
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbybA4vjnZb-79VAHSO0Gb7fQCS6JSxjdQN8SF-fJhOeVIe2IFMbb2OxeP7rAc67T20tww/exec";
const STORAGE_KEY_API = "MTC_INPUT_RH_GAS_URL";
const STORAGE_KEY_SNAPSHOT = "MTC_INPUT_RH_DATA_SNAPSHOT_V1";
const STORAGE_KEY_FIXED_ASSET_CATALOG = "MTC_INPUT_RH_FIXED_ASSET_CATALOG_V1";

let sheetColumns = [];
let sheetRows = [];
let sheetDate = "";
let inputRhAssetCatalog = [];
let legacyInputRhAssetCatalogTimestamp = 0;
let selectedNewEquipmentAsset = null;
let pendingUpdates = new Map(); // "rowIndex_colIndex" -> { rowIndex, colIndex, value }
let pendingNewRows = [];
let selectedRowKey = null;    // rowIndex angka atau "NEW_0"
let currentViewMode = "matrix"; // "matrix" | "form"
let isEditingUnit = false;
let activeCellCoords = { visibleRowIdx: 0, colIndex: 1 };

function getGasUrl() {
  return localStorage.getItem(STORAGE_KEY_API) || DEFAULT_GAS_URL;
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${escapeHtml(title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Info"))}</div>
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

async function callGasApi(payload) {
  const url = getGasUrl();
  if (!url || url.includes("GANTI_DENGAN_ID_DEPLOYMENT_ANDA")) {
    openApiConfigModal();
    throw new Error("URL Web App GAS belum diatur.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message);
  return data;
}

function normalizeInputRhAssetCatalog(records) {
  return records.map(asset => ({
    equipmentNo: String(asset.equipmentNo || "").trim(),
    serialNo: String(asset.serialNo || "").trim(),
    equipmentName: String(asset.equipmentName || "").trim(),
    type: String(asset.type || "").trim()
  })).filter(asset => asset.equipmentNo);
}

async function restoreInputRhAssetCatalog() {
  try {
    const snapshot = await MTCFixedAssetCatalogCache.getSnapshot();
    if (snapshot && Array.isArray(snapshot.records)) {
      inputRhAssetCatalog = normalizeInputRhAssetCatalog(snapshot.records);
      try {
        localStorage.removeItem(STORAGE_KEY_FIXED_ASSET_CATALOG);
      } catch (error) {
        console.warn("Cache lama Fixed Asset di localStorage tidak dapat dihapus.", error);
      }
      return inputRhAssetCatalog.length > 0;
    }
  } catch (error) {
    console.warn("Cache bersama Fixed Asset tidak dapat dibaca untuk Input RH.", error);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_FIXED_ASSET_CATALOG);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.assets)) return false;
    inputRhAssetCatalog = normalizeInputRhAssetCatalog(snapshot.assets);
    legacyInputRhAssetCatalogTimestamp = Number(snapshot.savedAt) || 0;
    return inputRhAssetCatalog.length > 0;
  } catch (err) {
    console.warn("Gagal membaca cache Fixed Asset untuk Input RH.", err);
    return false;
  }
}

async function loadInputRhAssetCatalog(showSuccess = false, forceRefresh = showSuccess) {
  try {
    const snapshot = await MTCFixedAssetCatalogCache.loadCatalog({
      forceRefresh,
      fallbackRecords: inputRhAssetCatalog,
      fallbackUpdatedAt: legacyInputRhAssetCatalogTimestamp
    });
    inputRhAssetCatalog = normalizeInputRhAssetCatalog(snapshot.records);
    legacyInputRhAssetCatalogTimestamp = 0;
    try {
      localStorage.removeItem(STORAGE_KEY_FIXED_ASSET_CATALOG);
    } catch (error) {
      console.warn("Cache lama Fixed Asset di localStorage tidak dapat dihapus.", error);
    }
    if (snapshot.error) {
      showToast(`Cache Fixed Asset tetap digunakan, tetapi sinkronisasi gagal: ${snapshot.error}`, "error", "Katalog Fixed Asset");
    } else if (showSuccess) {
      showToast(`Katalog Fixed Asset diperbarui (${inputRhAssetCatalog.length} aset).`, "success");
    }
  } catch (error) {
    const message = inputRhAssetCatalog.length
      ? `Gagal menyinkronkan katalog Fixed Asset. Data cache tetap digunakan. ${error.message}`
      : error.message;
    showToast(message, "error", "Katalog Fixed Asset");
  }
}

function refreshInputRhData() {
  loadSheetData();
  loadInputRhAssetCatalog(true);
}

document.addEventListener("DOMContentLoaded", async () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  window._preferredMonth = months[new Date().getMonth()];
  const hasCachedData = restoreLocalSnapshot();
  await restoreInputRhAssetCatalog();
  bindNewEquipmentAssetAutocomplete();
  loadSheetData(hasCachedData);
  loadInputRhAssetCatalog(false);
  setupClipboardPaste();
});

function saveLocalSnapshot() {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify({
      ts: Date.now(),
      columns: sheetColumns,
      rows: sheetRows,
      sheetDate
    }));
  } catch (err) {
    console.warn("Gagal menyimpan cache Input RH ke localStorage.", err);
  }
}

function restoreLocalSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.columns) || !Array.isArray(snapshot.rows)) return false;

    applyServerData({
      columns: snapshot.columns,
      rows: snapshot.rows,
      sheetDate: snapshot.sheetDate
    }, true, false);
    return true;
  } catch (err) {
    console.warn("Gagal membaca cache Input RH dari localStorage.", err);
    return false;
  }
}

async function loadSheetData(silentBackground = false) {
  try {
    if (!silentBackground) {
      document.getElementById("rhGridBody").innerHTML =
        `<tr><td style="padding:24px; text-align:center; color:var(--text-muted);">Memuat data server...</td></tr>`;
    }
    const res = await callGasApi({ action: "getData" });
    applyServerData(res, true);
    if (!silentBackground) showToast("Data Server tersinkronisasi.", "success");
  } catch (err) {
    if (silentBackground) {
      showToast(`Cache ditampilkan, tetapi sinkronisasi gagal: ${err.message}`, "error", "Sinkronisasi Gagal");
    } else {
      document.getElementById("rhGridBody").innerHTML =
        `<tr><td style="padding:24px; text-align:center; color:#dc2626; font-weight:700;">${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function applyServerData(res, isInitial = false, persistSnapshot = true) {
  sheetColumns = res.columns || [];
  sheetRows = res.rows || [];
  if (res.sheetDate) sheetDate = res.sheetDate;
  isEditingUnit = false;
  pendingUpdates.clear();
  pendingNewRows = [];
  updateDirtyCounter();

  if (sheetDate) {
    document.getElementById("sheetInfoText").textContent = `• ${sheetDate} • ${sheetRows.length} Unit`;
  }

  populateFilters(isInitial);
  populateQuickDateDropdown();

  if (sheetRows.length > 0 && !selectedRowKey) {
    selectedRowKey = sheetRows[0].rowIndex;
  }

  renderAll();
  if (persistSnapshot) saveLocalSnapshot();
}

function populateFilters(isInitial) {
  const monthSel = document.getElementById("monthFilter");
  const prevMonth = monthSel.value;
  const months = [...new Set(sheetColumns.filter(c => c.group !== "MASTER").map(c => c.group))];

  monthSel.innerHTML = `<option value="ALL">Semua Bulan</option>`;
  months.forEach(m => { monthSel.innerHTML += `<option value="${m}">${m}</option>`; });

  if (isInitial && months.includes(window._preferredMonth)) {
    monthSel.value = window._preferredMonth;
  } else if (months.includes(prevMonth)) {
    monthSel.value = prevMonth;
  }

  const rigSel = document.getElementById("rigFilter");
  const prevRig = rigSel.value;
  const rigs = [...new Set(sheetRows.map(r => String(r.cells[4] || "").trim()).filter(Boolean))].sort();

  rigSel.innerHTML = `<option value="ALL">Semua RIG</option>`;
  rigs.forEach(rg => { rigSel.innerHTML += `<option value="${rg}">${rg}</option>`; });
  if (rigs.includes(prevRig)) rigSel.value = prevRig;
}

function populateQuickDateDropdown() {
  const sel = document.getElementById("quickDateColSelect");
  const prev = sel.value;
  const editableDateCols = sheetColumns.filter(c => c.colIndex >= 10 && !c.isFormula);

  sel.innerHTML = "";
  editableDateCols.forEach(col => {
    sel.innerHTML += `<option value="${col.colIndex}">${col.title}</option>`;
  });
  if (prev) sel.value = prev;
}

function onFilterChange() {
  populateQuickDateDropdown();
  renderAll();
}

function getVisibleColumns() {
  const m = document.getElementById("monthFilter").value;
  return sheetColumns.filter(col => col.group === "MASTER" || m === "ALL" || col.group.toLowerCase() === m.toLowerCase());
}

function getFilteredRows() {
  const rig = document.getElementById("rigFilter").value;
  const q = document.getElementById("searchUnit").value.trim().toLowerCase();

  const combined = [
    ...sheetRows.map(r => ({ ...r, isNew: false })),
    ...pendingNewRows.map((cells, idx) => ({ rowIndex: "NEW_" + idx, cells, isNew: true }))
  ];

  return combined.filter(r => {
    const name = String(r.cells[0] || "").toLowerCase();
    const cn = String(r.cells[1] || "").toLowerCase();
    const sn = String(r.cells[2] || "").toLowerCase();
    const rRig = String(r.cells[4] || "").trim();

    if (rig !== "ALL" && rRig !== rig) return false;
    if (q && !name.includes(q) && !cn.includes(q) && !sn.includes(q) && !rRig.toLowerCase().includes(q)) return false;
    return true;
  });
}

function switchViewMode(mode) {
  currentViewMode = mode;
  document.getElementById("btnModeMatrix").classList.toggle("active", mode === "matrix");
  document.getElementById("btnModeForm").classList.toggle("active", mode === "form");
  document.getElementById("viewMatrix").classList.toggle("active", mode === "matrix");
  document.getElementById("viewForm").classList.toggle("active", mode === "form");
  renderDetailForm();
}

function selectUnitRow(rowKey) {
  selectedRowKey = rowKey;
  isEditingUnit = false;
  currentViewMode = "form";
  renderAssetList();
  updateSelectedBanner();
  document.getElementById("btnModeMatrix").classList.remove("active");
  document.getElementById("btnModeForm").classList.add("active");
  document.getElementById("viewMatrix").classList.remove("active");
  document.getElementById("viewForm").classList.add("active");
  syncUnitEditControls();
  renderDetailForm();

  // Highlight baris di matrix jika ada
  document.querySelectorAll("#rhGridBody tr").forEach(tr => {
    tr.classList.toggle("selected-row", String(tr.dataset.rowkey) === String(rowKey));
  });
}

function syncUnitEditControls() {
  const all = getAllRowsRaw();
  const selected = all.find(row => String(row.rowIndex) === String(selectedRowKey));
  const editButton = document.getElementById("btnEditUnit");
  const deleteButton = document.getElementById("btnDeleteUnit");
  if (!editButton || !deleteButton) return;

  editButton.disabled = !selected;
  editButton.innerHTML = isEditingUnit
    ? '<i class="bi bi-cloud-check"></i> Simpan Perubahan'
    : '<i class="bi bi-pencil-square"></i> Edit';
  editButton.classList.toggle("btn-primary", isEditingUnit);
  editButton.classList.toggle("btn-ghost", !isEditingUnit);
  deleteButton.disabled = !selected || selected.isNew;
  ["quickDateColSelect", "quickDateValue", "btnQuickDateSelected", "btnQuickDateAll", "excelUploadInput", "btnUploadRhExcel"]
    .forEach(id => {
      const control = document.getElementById(id);
      if (control) control.disabled = !isEditingUnit;
    });
}

function toggleUnitEdit() {
  if (isEditingUnit) {
    saveAllChanges();
    return;
  }
  if (!getAllRowsRaw().some(row => String(row.rowIndex) === String(selectedRowKey))) {
    showToast("Pilih unit terlebih dahulu.", "info");
    return;
  }
  isEditingUnit = !isEditingUnit;
  syncUnitEditControls();
  renderMatrixGrid();
  renderDetailForm();
}

function deleteSelectedUnit() {
  const selected = getAllRowsRaw().find(row => String(row.rowIndex) === String(selectedRowKey));
  if (!selected || selected.isNew) return;
  confirmDeleteRow(Number(selected.rowIndex), String(selected.cells[0] || ""));
}

function updateSelectedBanner() {
  const all = getAllRowsRaw();
  const found = all.find(r => String(r.rowIndex) === String(selectedRowKey));
  const banner = document.getElementById("selectedUnitBanner");
  if (!found) {
    banner.innerHTML = `Unit Aktif: <strong>-</strong>`;
    return;
  }
  banner.innerHTML = `Unit Aktif: <strong>${escapeHtml(String(found.cells[0] || "Tanpa Nama"))}</strong> <span style="color:var(--text-muted);">(${escapeHtml(String(found.cells[1] || "-"))})</span>`;
}

function getAllRowsRaw() {
  return [
    ...sheetRows.map(r => ({ ...r, isNew: false })),
    ...pendingNewRows.map((cells, idx) => ({ rowIndex: "NEW_" + idx, cells, isNew: true }))
  ];
}

function renderAll() {
  renderAssetList();
  renderMatrixGrid();
  updateSelectedBanner();
  syncUnitEditControls();
  renderDetailForm();
}

function renderAssetList() {
  const container = document.getElementById("assetListContainer");
  const rows = getFilteredRows();
  document.getElementById("unitCountBadge").textContent = rows.length;

  if (rows.length === 0) {
    selectedRowKey = null;
    isEditingUnit = false;
    container.innerHTML = `<div class="empty-state">Tidak ada unit.</div>`;
    return;
  }

  if (!rows.some(r => String(r.rowIndex) === String(selectedRowKey))) {
    selectedRowKey = rows[0].rowIndex;
    isEditingUnit = false;
  }

  container.innerHTML = rows.map(r => {
    const isActive = String(r.rowIndex) === String(selectedRowKey);
    const eqName = String(r.cells[0] || "(Tanpa Nama)");
    const cn = String(r.cells[1] || "-");
    const type = String(r.cells[3] || "-");
    const rig = String(r.cells[4] || "-");
    return `
      <div class="asset-item ${isActive ? "active" : ""}" onclick="selectUnitRow('${r.rowIndex}')">
        <div>
          <div class="asset-name">${escapeHtml(eqName)}</div>
          <div class="asset-sub">Equipment No: ${escapeHtml(cn)} • ${escapeHtml(type)}</div>
        </div>
        <span class="asset-rig-tag">${escapeHtml(rig)}</span>
      </div>
    `;
  }).join("");
}

function renderMatrixGrid() {
  const thead = document.getElementById("rhGridHead");
  const tbody = document.getElementById("rhGridBody");
  const cols = getVisibleColumns();
  const rows = getFilteredRows();

  let thHtml = "<tr>";
  cols.forEach(col => {
    const u = col.title.toUpperCase();
    let cls = "";
    if (u.startsWith("TOTAL")) cls += " th-total";
    else if (u.startsWith("AVG")) cls += " th-avg";
    else if (u === "AWAL") cls += " th-awal";

    if (col.colIndex === 1) cls += " col-freeze-1";
    else if (col.colIndex === 2) cls += " col-freeze-2";
    else if (col.colIndex === 5) cls += " col-freeze-5";

    const w = col.colIndex === 1 ? "150px" : (col.colIndex === 2 ? "80px" : (col.colIndex <= 5 ? "78px" : "66px"));
    thHtml += `<th class="${cls}" style="min-width:${w};">${escapeHtml(col.title)}</th>`;
  });
  thHtml += `<th style="min-width:44px;">Hapus</th></tr>`;
  thead.innerHTML = thHtml;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" style="padding:24px; text-align:center; color:var(--text-muted);">Data kosong.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((rowObj, vRowIdx) => {
    const isSelected = String(rowObj.rowIndex) === String(selectedRowKey);
    let tr = `<tr data-rowkey="${rowObj.rowIndex}" class="${isSelected ? "selected-row" : ""}" onclick="selectUnitRow('${rowObj.rowIndex}')">`;

    cols.forEach(col => {
      const cIdx = col.colIndex - 1;
      const val = rowObj.cells[cIdx] !== undefined && rowObj.cells[cIdx] !== null ? rowObj.cells[cIdx] : "";
      const u = col.title.toUpperCase();

      let freezeCls = "";
      if (col.colIndex === 1) freezeCls = " col-freeze-1";
      else if (col.colIndex === 2) freezeCls = " col-freeze-2";
      else if (col.colIndex === 5) freezeCls = " col-freeze-5";

      const isDirty = pendingUpdates.has(`${rowObj.rowIndex}_${col.colIndex}`) || rowObj.isNew;

      if (col.isFormula) {
        const fCls = u.startsWith("TOTAL") ? "td-total" : "td-avg";
        tr += `<td class="${fCls}${freezeCls}">${val === "" ? 0 : escapeHtml(String(val))}</td>`;
      } else {
        const awalCls = u === "AWAL" ? " td-awal" : "";
        const alignCls = col.colIndex <= 5 ? "left" : "center";
        const dirtyCls = isDirty ? " cell-dirty" : "";
        const fw = col.colIndex === 1 ? "font-weight:700;" : "";

        tr += `
          <td class="${freezeCls}${awalCls}">
            <input
              type="text"
              class="cell-input ${alignCls}${dirtyCls}"
              style="${fw}"
              value="${escapeHtml(String(val))}"
              ${isEditingUnit && isSelected ? "" : "readonly"}
              onclick="${isEditingUnit && isSelected ? "event.stopPropagation()" : ""}"
              data-vrow="${vRowIdx}"
              data-rowindex="${rowObj.rowIndex}"
              data-colindex="${col.colIndex}"
              onfocus="activeCellCoords={visibleRowIdx:${vRowIdx},colIndex:${col.colIndex}};"
              onchange="applyCellChange('${rowObj.rowIndex}', ${col.colIndex}, this.value, this)"
              onkeydown="handleGridNav(event, this)"
            />
          </td>`;
      }
    });

    if (!rowObj.isNew) {
      tr += `<td style="text-align:center;"><button type="button" class="btn-danger-icon" onclick="event.stopPropagation(); confirmDeleteRow(${rowObj.rowIndex}, '${escapeHtml(String(rowObj.cells[0] || ''))}')"><i class="bi bi-trash3"></i></button></td>`;
    } else {
      tr += `<td style="text-align:center; font-size:9px; font-weight:800; color:#15803d;">BARU</td>`;
    }

    tr += "</tr>";
    return tr;
  }).join("");
}

function renderDetailForm() {
  const container = document.getElementById("selectedUnitFormBody");
  if (!container) return;

  const all = getAllRowsRaw();
  const unit = all.find(r => String(r.rowIndex) === String(selectedRowKey));
  if (!unit) {
    container.innerHTML = `<div class="empty-state">Tidak ada unit terpilih.</div>`;
    return;
  }

  const visibleCols = getVisibleColumns();
  const masterCols = sheetColumns.filter(c => c.colIndex <= 9 && !c.isFormula);
  const formulaCols = sheetColumns.filter(c => c.isFormula);
  const dateCols = visibleCols.filter(c => c.colIndex >= 10 && !c.isFormula);

  const masterHtml = masterCols.map(col => {
    const val = unit.cells[col.colIndex - 1] ?? "";
    return `
      <div class="mini-field">
        <label>${escapeHtml(col.title)}</label>
        <input type="text" value="${escapeHtml(String(val))}" ${isEditingUnit ? "" : "disabled"} onchange="applyCellChange('${unit.rowIndex}', ${col.colIndex}, this.value, this)" />
      </div>
    `;
  }).join("");

  const selectedMonth = document.getElementById("monthFilter").value;
  const runningTotalCol = selectedMonth === "ALL"
    ? formulaCols.find(col => col.title.toUpperCase().startsWith("TOTAL") && col.title.toUpperCase().includes("AKHIR"))
    : formulaCols.find(col =>
      col.title.toUpperCase().startsWith("TOTAL") &&
      String(col.group).toLowerCase() === selectedMonth.toLowerCase()
    );
  const runningTotal = runningTotalCol ? unit.cells[runningTotalCol.colIndex - 1] : "";
  const runningTotalText = Number.isFinite(Number(runningTotal))
    ? Number(runningTotal).toLocaleString("id-ID", { maximumFractionDigits: 2 })
    : escapeHtml(String(runningTotal || "-"));
  const runningTotalCard = `
    <div class="kpi-box kpi-running-total">
      <div class="k-label">Total Jam Running (${escapeHtml(selectedMonth === "ALL" ? "Semua Bulan" : selectedMonth)})</div>
      <div class="k-val">${runningTotalText} <span>jam</span></div>
    </div>
  `;
  const avgMtdCol = selectedMonth === "ALL"
    ? formulaCols.find(col => col.title.toUpperCase() === "AVG MTD")
    : formulaCols.find(col =>
      col.title.toUpperCase().startsWith("AVG") &&
      String(col.group).toLowerCase() === selectedMonth.toLowerCase()
    );
  const totalAkhirCol = formulaCols.find(col =>
    col.title.toUpperCase().startsWith("TOTAL") &&
    col.title.toUpperCase().includes("AKHIR")
  );
  const formulaKpis = [
    { title: "AVG MTD", value: avgMtdCol ? unit.cells[avgMtdCol.colIndex - 1] : "" },
    { title: totalAkhirCol ? totalAkhirCol.title : "TOTAL (AKHIR)", value: totalAkhirCol ? unit.cells[totalAkhirCol.colIndex - 1] : "" }
  ].map(kpi => {
    const val = kpi.value;
    return `
      <div class="kpi-box">
        <div class="k-label">${escapeHtml(kpi.title)}</div>
        <div class="k-val">${val === "" || val === undefined ? 0 : escapeHtml(String(val))}</div>
      </div>
    `;
  }).join("");
  const kpiHtml = runningTotalCard + formulaKpis;

  const daysHtml = dateCols.map(col => {
    const val = unit.cells[col.colIndex - 1] ?? "";
    const isDirty = pendingUpdates.has(`${unit.rowIndex}_${col.colIndex}`) || unit.isNew;
    return `
      <div class="day-card">
        <label>${escapeHtml(col.title)}</label>
        <input
          type="number"
          step="any"
          class="${isDirty ? "cell-dirty" : ""}"
          value="${escapeHtml(String(val))}"
          ${isEditingUnit ? "" : "disabled"}
          onchange="applyCellChange('${unit.rowIndex}', ${col.colIndex}, this.value, this)"
        />
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="master-strip">${masterHtml}</div>
    <div class="kpi-strip">${kpiHtml}</div>
    <div style="font-size:11px; font-weight:800; color:var(--text-secondary);">
      Input Jam Harian (${document.getElementById("monthFilter").value})
    </div>
    <div class="days-grid">${daysHtml || `<div class="empty-state">Tidak ada kolom tanggal.</div>`}</div>
  `;
}

function applyCellChange(rowIndexRaw, colIndex, rawValue, el) {
  if (!isEditingUnit) return;
  const trimmed = String(rawValue ?? "").trim();
  let parsed = trimmed;
  if (colIndex >= 9 && trimmed !== "" && !isNaN(Number(trimmed))) {
    parsed = Number(trimmed);
  }

  if (String(rowIndexRaw).startsWith("NEW_")) {
    const idx = Number(String(rowIndexRaw).replace("NEW_", ""));
    if (pendingNewRows[idx]) pendingNewRows[idx][colIndex - 1] = parsed;
  } else {
    const rIdx = Number(rowIndexRaw);
    const rowObj = sheetRows.find(r => r.rowIndex === rIdx);
    if (rowObj) rowObj.cells[colIndex - 1] = parsed;
    pendingUpdates.set(`${rIdx}_${colIndex}`, { rowIndex: rIdx, colIndex, value: parsed });
  }

  if (el) el.classList.add("cell-dirty");
  updateDirtyCounter();
}

function updateDirtyCounter() {
  document.getElementById("dirtyCount").textContent = pendingUpdates.size + pendingNewRows.length;
}

// ============================================================
// QUICK INPUT TANGGAL TERTENTU
// ============================================================
function applyQuickDateToSelected() {
  if (!isEditingUnit) return showToast("Klik Edit pada unit terpilih sebelum mengubah data.", "info");
  const colIndex = Number(document.getElementById("quickDateColSelect").value);
  const valRaw = document.getElementById("quickDateValue").value.trim();
  if (!colIndex || valRaw === "") return showToast("Pilih tanggal dan isi nilai jam.", "error");

  const all = getAllRowsRaw();
  const unit = all.find(r => String(r.rowIndex) === String(selectedRowKey));
  if (!unit) return showToast("Pilih unit terlebih dahulu.", "error");

  applyCellChange(unit.rowIndex, colIndex, valRaw, null);
  renderAll();
  showToast(`Jam diupdate untuk ${unit.cells[0] || "Unit"}.`, "success");
}

function applyQuickDateToAllFiltered() {
  if (!isEditingUnit) return showToast("Klik Edit pada unit terpilih sebelum mengubah data.", "info");
  const colIndex = Number(document.getElementById("quickDateColSelect").value);
  const valRaw = document.getElementById("quickDateValue").value.trim();
  if (!colIndex || valRaw === "") return showToast("Pilih tanggal dan isi nilai jam.", "error");

  const rows = getFilteredRows();
  rows.forEach(r => applyCellChange(r.rowIndex, colIndex, valRaw, null));
  renderAll();
  showToast(`Jam diterapkan ke ${rows.length} unit tampil.`, "success");
}

// ============================================================
// PASTE EXCEL (CTRL + V) & UPLOAD .XLSX
// ============================================================
function setupClipboardPaste() {
  document.addEventListener("paste", function(e) {
    if (!document.activeElement || !document.activeElement.classList.contains("cell-input")) return;
    if (!isEditingUnit) {
      e.preventDefault();
      showToast("Klik Edit pada unit terpilih sebelum menempelkan data.", "info");
      return;
    }
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text) return;

    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      .filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    if (lines.length === 1 && !lines[0].includes("\t")) return;

    e.preventDefault();
    const cols = getVisibleColumns();
    const rows = getFilteredRows();
    const startVRow = activeCellCoords.visibleRowIdx;
    const startVisPos = cols.findIndex(c => c.colIndex === activeCellCoords.colIndex);
    if (startVisPos === -1) return;

    let cellsDone = 0;
    let newAdded = 0;

    lines.forEach((line, rOff) => {
      const parts = line.split("\t");
      const targetVRow = startVRow + rOff;

      if (targetVRow < rows.length) {
        const rObj = rows[targetVRow];
        parts.forEach((v, cOff) => {
          const targetCol = cols[startVisPos + cOff];
          if (!targetCol || targetCol.isFormula) return;
          applyCellChange(rObj.rowIndex, targetCol.colIndex, v, null);
          cellsDone++;
        });
      } else {
        const newArr = new Array(sheetColumns.length).fill("");
        parts.forEach((v, cOff) => {
          const targetCol = cols[startVisPos + cOff];
          if (!targetCol || targetCol.isFormula) return;
          const t = String(v || "").trim();
          newArr[targetCol.colIndex - 1] = (targetCol.colIndex >= 9 && t !== "" && !isNaN(Number(t))) ? Number(t) : t;
          cellsDone++;
        });
        pendingNewRows.push(newArr);
        newAdded++;
      }
    });

    renderAll();
    updateDirtyCounter();
    showToast(`${cellsDone} sel dipaste${newAdded ? ` (${newAdded} baris baru)` : ""}. Klik Simpan.`, "info", "Paste Excel");
  });
}

function handleExcelFileUpload(event) {
  if (!isEditingUnit) {
    showToast("Klik Edit pada unit terpilih sebelum mengimpor data Excel.", "info");
    event.target.value = "";
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sName = wb.SheetNames.find(n => n.toLowerCase().includes("entry")) || wb.SheetNames[0];
      const rows2D = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: "" });
      if (rows2D.length < 3) return showToast("Format Excel tidak valid.", "error");

      let matched = 0, added = 0;
      for (let r = 2; r < rows2D.length; r++) {
        const exRow = rows2D[r];
        const eqName = String(exRow[0] || "").trim();
        const cn = String(exRow[1] || "").trim();
        if (!eqName && !cn) continue;

        const existing = sheetRows.find(sr =>
          String(sr.cells[0] || "").trim().toLowerCase() === eqName.toLowerCase() &&
          String(sr.cells[1] || "").trim().toLowerCase() === cn.toLowerCase()
        );

        if (existing) {
          sheetColumns.forEach((col, cIdx) => {
            if (!col.isFormula && exRow[cIdx] !== undefined && exRow[cIdx] !== "") {
              applyCellChange(existing.rowIndex, col.colIndex, exRow[cIdx], null);
            }
          });
          matched++;
        } else {
          const arr = new Array(sheetColumns.length).fill("");
          sheetColumns.forEach((col, cIdx) => {
            if (!col.isFormula && exRow[cIdx] !== undefined && exRow[cIdx] !== "") {
              const t = String(exRow[cIdx]).trim();
              arr[cIdx] = (col.colIndex >= 9 && t !== "" && !isNaN(Number(t))) ? Number(t) : t;
            }
          });
          pendingNewRows.push(arr);
          added++;
        }
      }

      renderAll();
      updateDirtyCounter();
      showToast(`${matched} unit cocok, ${added} unit baru. Klik Simpan.`, "success");
    } catch (err) {
      showToast("Gagal baca Excel: " + err.message, "error");
    }
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}

function handleGridNav(e, inputEl) {
  const vRow = Number(inputEl.dataset.vrow);
  const colIdx = Number(inputEl.dataset.colindex);
  const cols = getVisibleColumns();
  let visPos = cols.findIndex(c => c.colIndex === colIdx);
  let nextRow = vRow;

  if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); nextRow = vRow + 1; }
  else if (e.key === "ArrowUp") { e.preventDefault(); nextRow = Math.max(0, vRow - 1); }
  else if (e.key === "ArrowRight" && inputEl.selectionStart === inputEl.value.length) visPos = Math.min(cols.length - 1, visPos + 1);
  else if (e.key === "ArrowLeft" && inputEl.selectionStart === 0) visPos = Math.max(0, visPos - 1);
  else return;

  while (visPos >= 0 && visPos < cols.length && cols[visPos].isFormula) {
    visPos += (e.key === "ArrowLeft" ? -1 : 1);
  }

  if (cols[visPos]) {
    const nextEl = document.querySelector(`input.cell-input[data-vrow="${nextRow}"][data-colindex="${cols[visPos].colIndex}"]`);
    if (nextEl) { nextEl.focus(); nextEl.select(); }
  }
}

// ============================================================
// SAVE, ADD, DELETE & API MODAL
// ============================================================
function showInputRhLoading(title) {
  Swal.fire({
    title,
    html: `
      <div class="save-loading-content" role="status" aria-live="polite">
        <span class="save-loading-spinner" aria-hidden="true"></span>
        <div class="save-loading-details">
          <span class="save-loading-caption">Sinkronisasi data ke server.</span>
          <span class="save-loading-progress" aria-hidden="true"></span>
        </div>
      </div>
    `,
    customClass: { popup: "save-loading-popup" },
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false
  });
}

async function saveAllChanges() {
  const updates = Array.from(pendingUpdates.values());
  if (!updates.length && !pendingNewRows.length) {
    if (isEditingUnit) {
      isEditingUnit = false;
      syncUnitEditControls();
      renderMatrixGrid();
      renderDetailForm();
    }
    return showToast("Tidak ada perubahan untuk disimpan.", "info");
  }

  showInputRhLoading("Menyimpan perubahan");
  try {
    const res = await callGasApi({ action: "saveBulk", updates, newRows: pendingNewRows });
    Swal.close();
    isEditingUnit = false;
    applyServerData(res, false);
    showToast("Perubahan berhasil disimpan.", "success");
  } catch (err) {
    Swal.close();
    showToast(err.message, "error", "Gagal Simpan");
  }
}

function openAddEqModal() { document.getElementById("addEqModal").classList.add("active"); }
function closeAddEqModal() {
  hideNewEquipmentAssetSuggestions();
  document.getElementById("addEqModal").classList.remove("active");
}

function bindNewEquipmentAssetAutocomplete() {
  const fieldConfig = [
    ["newEqEquipmentNo", "equipmentNo"],
    ["newEqSerialNo", "serialNo"],
    ["newEqName", "equipmentName"]
  ];

  fieldConfig.forEach(([elementId, field]) => {
    const input = document.getElementById(elementId);
    if (!input || input.dataset.assetPickerBound === "1") return;
    input.dataset.assetPickerBound = "1";
    input.addEventListener("focus", () => showNewEquipmentAssetSuggestions(input));
    input.addEventListener("input", () => {
      const exact = findExactNewEquipmentAsset(field, input.value);
      if (exact) {
        applyNewEquipmentAsset(exact);
      } else {
        clearNewEquipmentAssetMatch(input);
        showNewEquipmentAssetSuggestions(input);
      }
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") hideNewEquipmentAssetSuggestions();
      if (event.key === "Enter") {
        const popup = document.getElementById("newEqAssetSuggestPopup");
        const firstOption = popup && popup.querySelector("button");
        if (firstOption && popup.style.display !== "none") {
          event.preventDefault();
          firstOption.click();
        }
      }
    });
  });

  document.addEventListener("mousedown", event => {
    if (!event.target.closest(".new-equipment-asset-suggest") &&
        !event.target.closest(".new-equipment-asset-input")) {
      hideNewEquipmentAssetSuggestions();
    }
  });
}

function findExactNewEquipmentAsset(field, value) {
  const query = String(value || "").trim();
  if (!query) return null;
  const lowerQuery = query.toLocaleLowerCase();
  const matches = inputRhAssetCatalog.filter(asset => {
    const assetValue = String(asset[field] || "").trim();
    return field === "equipmentNo"
      ? assetValue === query
      : assetValue.toLocaleLowerCase() === lowerQuery;
  });
  return matches.length === 1 ? matches[0] : null;
}

function searchInputRhAssets(query) {
  const q = String(query || "").trim().toLocaleLowerCase();
  const matches = q
    ? inputRhAssetCatalog.filter(asset =>
      [asset.equipmentNo, asset.serialNo, asset.equipmentName, asset.type]
        .some(value => String(value || "").toLocaleLowerCase().includes(q))
    )
    : inputRhAssetCatalog;
  return matches.slice(0, 40);
}

function showNewEquipmentAssetSuggestions(input) {
  const popup = getNewEquipmentAssetPopup();
  const matches = searchInputRhAssets(input.value);
  popup._matches = matches;

  if (!inputRhAssetCatalog.length) {
    popup.innerHTML = '<div class="new-equipment-asset-empty">Katalog Fixed Asset belum tersedia.</div>';
  } else if (!matches.length) {
    popup.innerHTML = '<div class="new-equipment-asset-empty">Fixed Asset tidak ditemukan.</div>';
  } else {
    popup.innerHTML = matches.map((asset, index) => `
      <button type="button" class="new-equipment-asset-option" onmousedown="event.preventDefault()" onclick="selectNewEquipmentAsset(${index})">
        <span class="new-equipment-asset-option-head">
          <strong>${escapeHtml(asset.equipmentNo || "-")}</strong>
          <small>${escapeHtml(asset.serialNo || "Tanpa Serial No")}</small>
        </span>
        <span>${escapeHtml(asset.equipmentName || "-")}</span>
        <small>${escapeHtml(asset.type || "-")}</small>
      </button>
    `).join("");
  }

  const rect = input.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 380))}px`;
  popup.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 250)}px`;
  popup.style.width = `${Math.max(280, Math.min(rect.width, window.innerWidth - 16))}px`;
  popup.style.display = "block";
}

function getNewEquipmentAssetPopup() {
  let popup = document.getElementById("newEqAssetSuggestPopup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "newEqAssetSuggestPopup";
    popup.className = "new-equipment-asset-suggest";
    popup.style.display = "none";
    document.body.appendChild(popup);
  }
  return popup;
}

function applyNewEquipmentAsset(asset) {
  selectedNewEquipmentAsset = asset;
  document.getElementById("newEqEquipmentNo").value = asset.equipmentNo;
  document.getElementById("newEqSerialNo").value = asset.serialNo;
  document.getElementById("newEqName").value = asset.equipmentName;
  document.getElementById("newEqType").value = asset.type;
  ["newEqEquipmentNo", "newEqSerialNo", "newEqName", "newEqType"].forEach(id => {
    const input = document.getElementById(id);
    input.classList.remove("invalid-match");
    input.classList.add("valid-match");
  });
  hideNewEquipmentAssetSuggestions();
}

function clearNewEquipmentAssetMatch(activeInput) {
  selectedNewEquipmentAsset = null;
  ["newEqEquipmentNo", "newEqSerialNo", "newEqName", "newEqType"].forEach(id => {
    const input = document.getElementById(id);
    input.classList.remove("valid-match", "invalid-match");
    if (input !== activeInput) input.value = "";
  });
}

function selectNewEquipmentAsset(index) {
  const popup = document.getElementById("newEqAssetSuggestPopup");
  const asset = popup && popup._matches ? popup._matches[index] : null;
  if (asset) applyNewEquipmentAsset(asset);
}

function hideNewEquipmentAssetSuggestions() {
  const popup = document.getElementById("newEqAssetSuggestPopup");
  if (popup) popup.style.display = "none";
}

function resetNewEquipmentForm() {
  ["newEqEquipmentNo", "newEqSerialNo", "newEqName", "newEqType", "newEqRig"].forEach(id => {
    const input = document.getElementById(id);
    input.value = "";
    input.classList.remove("valid-match", "invalid-match");
  });
  document.getElementById("newEqSatuan").value = "Jam";
  document.getElementById("newEqAwal").value = "0";
  selectedNewEquipmentAsset = null;
}

async function submitNewEquipment() {
  const equipmentNo = document.getElementById("newEqEquipmentNo").value.trim();
  const serialNo = document.getElementById("newEqSerialNo").value.trim();
  const name = document.getElementById("newEqName").value.trim();
  const selected = selectedNewEquipmentAsset;
  const selectedAsset = selected && inputRhAssetCatalog.find(asset =>
    asset.equipmentNo === selected.equipmentNo &&
    asset.serialNo === selected.serialNo &&
    asset.equipmentName === selected.equipmentName &&
    asset.type === selected.type
  );
  if (!selectedAsset ||
      selectedAsset.equipmentNo !== equipmentNo ||
      selectedAsset.serialNo !== serialNo ||
      selectedAsset.equipmentName !== name) {
    return showToast("Pilih Equipment No, Serial No, atau Equipment Name dari daftar Fixed Asset.", "error", "Pilih Fixed Asset");
  }
  if (!name) return showToast("Equipment Name wajib diisi.", "error");

  closeAddEqModal();
  showInputRhLoading("Menambah Unit");
  try {
    const res = await callGasApi({
      action: "addEquipment",
      equipment: {
        name: selectedAsset.equipmentName,
        equipmentNo: selectedAsset.equipmentNo,
        serialNo: selectedAsset.serialNo,
        type: selectedAsset.type,
        rig: document.getElementById("newEqRig").value.trim(),
        satuan: document.getElementById("newEqSatuan").value.trim() || "Jam",
        awal: Number(document.getElementById("newEqAwal").value) || 0
      }
    });
    Swal.close();
    applyServerData(res, false);
    resetNewEquipmentForm();
    showToast(`Unit "${selectedAsset.equipmentName}" ditambahkan.`, "success");
  } catch (err) {
    Swal.close();
    openAddEqModal();
    showToast(err.message, "error", "Gagal Menambahkan Unit");
  }
}

async function confirmDeleteRow(rowIndex, eqName) {
  const result = await Swal.fire({
    title: "Hapus Unit?",
    text: `Hapus baris "${eqName}" dari server?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus",
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

  showInputRhLoading("Menghapus Unit");
  try {
    const res = await callGasApi({ action: "deleteEquipment", rowIndex });
    Swal.close();
    if (String(selectedRowKey) === String(rowIndex)) selectedRowKey = null;
    applyServerData(res, false);
    showToast("Unit dihapus.", "success");
  } catch (err) {
    Swal.close();
    showToast(err.message, "error", "Gagal Menghapus Unit");
  }
}

function openApiConfigModal() {
  document.getElementById("gasApiUrlInput").value = localStorage.getItem(STORAGE_KEY_API) || "";
  document.getElementById("apiConfigModal").classList.add("active");
}
function closeApiConfigModal() { document.getElementById("apiConfigModal").classList.remove("active"); }
function saveApiConfig() {
  const val = document.getElementById("gasApiUrlInput").value.trim();
  if (!val.startsWith("https://script.google.com/")) return showToast("URL harus diawali https://script.google.com/", "error");
  localStorage.setItem(STORAGE_KEY_API, val);
  closeApiConfigModal();
  loadSheetData();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
