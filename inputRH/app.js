// ============================================================
// KONFIGURASI ENDPOINT GOOGLE APPS SCRIPT
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT_ANDA/exec";
const STORAGE_KEY_API = "MTC_INPUT_RH_GAS_URL";

let sheetColumns = [];
let sheetRows = [];
let pendingUpdates = new Map(); // "rowIndex_colIndex" -> { rowIndex, colIndex, value }
let pendingNewRows = [];
let selectedRowKey = null;    // rowIndex angka atau "NEW_0"
let currentViewMode = "matrix"; // "matrix" | "form"
let activeCellCoords = { visibleRowIdx: 0, colIndex: 1 };

function getGasUrl() {
  return localStorage.getItem(STORAGE_KEY_API) || DEFAULT_GAS_URL;
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Info")}</div>
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

document.addEventListener("DOMContentLoaded", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  window._preferredMonth = months[new Date().getMonth()];
  loadSheetData();
  setupClipboardPaste();
});

async function loadSheetData() {
  try {
    document.getElementById("rhGridBody").innerHTML =
      `<tr><td style="padding:24px; text-align:center; color:var(--text-muted);">Memuat data server...</td></tr>`;
    const res = await callGasApi({ action: "getData" });
    applyServerData(res, true);
    showToast("Data Server tersinkronisasi.", "success");
  } catch (err) {
    document.getElementById("rhGridBody").innerHTML =
      `<tr><td style="padding:24px; text-align:center; color:#dc2626; font-weight:700;">${err.message}</td></tr>`;
  }
}

function applyServerData(res, isInitial = false) {
  sheetColumns = res.columns || [];
  sheetRows = res.rows || [];
  pendingUpdates.clear();
  pendingNewRows = [];
  updateDirtyCounter();

  if (res.sheetDate) {
    document.getElementById("sheetInfoText").textContent = `• ${res.sheetDate} • ${sheetRows.length} Unit`;
  }

  populateFilters(isInitial);
  populateQuickDateDropdown();

  if (sheetRows.length > 0 && !selectedRowKey) {
    selectedRowKey = sheetRows[0].rowIndex;
  }

  renderAll();
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
  renderAssetList();
  updateSelectedBanner();
  renderDetailForm();

  // Highlight baris di matrix jika ada
  document.querySelectorAll("#rhGridBody tr").forEach(tr => {
    tr.classList.toggle("selected-row", String(tr.dataset.rowkey) === String(rowKey));
  });
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
  renderDetailForm();
}

function renderAssetList() {
  const container = document.getElementById("assetListContainer");
  const rows = getFilteredRows();
  document.getElementById("unitCountBadge").textContent = rows.length;

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">Tidak ada unit.</div>`;
    return;
  }

  if (!rows.some(r => String(r.rowIndex) === String(selectedRowKey))) {
    selectedRowKey = rows[0].rowIndex;
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
          <div class="asset-sub">C/N: ${escapeHtml(cn)} • ${escapeHtml(type)}</div>
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
        <input type="text" value="${escapeHtml(String(val))}" onchange="applyCellChange('${unit.rowIndex}', ${col.colIndex}, this.value, this)" />
      </div>
    `;
  }).join("");

  const kpiHtml = formulaCols.slice(0, 6).map(col => {
    const val = unit.cells[col.colIndex - 1];
    return `
      <div class="kpi-box">
        <div class="k-label">${escapeHtml(col.title)}</div>
        <div class="k-val">${val === "" || val === undefined ? 0 : escapeHtml(String(val))}</div>
      </div>
    `;
  }).join("");

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
async function saveAllChanges() {
  const updates = Array.from(pendingUpdates.values());
  if (!updates.length && !pendingNewRows.length) return showToast("Tidak ada perubahan untuk disimpan.", "info");

  Swal.fire({ title: "Menyimpan ke Google Sheet...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const res = await callGasApi({ action: "saveBulk", updates, newRows: pendingNewRows });
    Swal.close();
    applyServerData(res, false);
    showToast("Perubahan berhasil disimpan.", "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: err.message });
  }
}

function openAddEqModal() { document.getElementById("addEqModal").classList.add("active"); }
function closeAddEqModal() { document.getElementById("addEqModal").classList.remove("active"); }

async function submitNewEquipment() {
  const name = document.getElementById("newEqName").value.trim();
  if (!name) return showToast("Equipment Name wajib diisi.", "error");
  closeAddEqModal();
  Swal.fire({ title: "Menambah Unit...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const res = await callGasApi({
      action: "addEquipment",
      equipment: {
        name,
        cn: document.getElementById("newEqCn").value.trim(),
        sn: document.getElementById("newEqSn").value.trim(),
        type: document.getElementById("newEqType").value.trim(),
        rig: document.getElementById("newEqRig").value.trim(),
        satuan: document.getElementById("newEqSatuan").value.trim() || "Jam",
        awal: Number(document.getElementById("newEqAwal").value) || 0
      }
    });
    Swal.close();
    applyServerData(res, false);
    showToast(`Unit "${name}" ditambahkan.`, "success");
  } catch (err) {
    Swal.fire({ icon: "error", title: "Gagal", text: err.message });
  }
}

function confirmDeleteRow(rowIndex, eqName) {
  Swal.fire({
    title: "Hapus Unit?",
    text: `Hapus baris "${eqName}" dari sheet Entry Data?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#ef4444",
    confirmButtonText: "Ya, Hapus"
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    Swal.fire({ title: "Menghapus...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await callGasApi({ action: "deleteEquipment", rowIndex });
      Swal.close();
      if (String(selectedRowKey) === String(rowIndex)) selectedRowKey = null;
      applyServerData(res, false);
      showToast("Unit dihapus.", "success");
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err.message });
    }
  });
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