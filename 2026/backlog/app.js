const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbyx6AJxSK14IgU0tPyC25--L7QnJmvc-Xvse_waTG7JcmM9Z_o2tIPosHzHGlm_c5SF/exec";
const STORAGE_KEY_API = "MTC_BACKLOG_GAS_URL";
const STORAGE_KEY_SNAPSHOT = "MTC_BACKLOG_DATA_SNAPSHOT_V1";
const INITIAL_RENDER_ROW_LIMIT = 250;

const BACKLOG_FIELDS = [
  "Date Found",
  "Event",
  "Equipment No",
  "Equipment Name",
  "Type",
  "HM",
  "Anomaly/WO Description",
  "Critical/Priorities",
  "Action Required",
  "Execution Plan",
  "Est.Duration (Hours)",
  "Sparepart Need",
  "Material Status",
  "Document No",
  "Status",
  "Date Closed",
  "Remarks",
  "Link_Code"
];
const BACKLOG_EDITABLE_FIELDS = BACKLOG_FIELDS.filter(field => field !== "Link_Code");

const BACKLOG_FIELD_KEYS = {
  "Date Found": "dateFound",
  "Equipment No": "equipmentNo",
  "Equipment Name": "equipmentName",
  "Anomaly/WO Description": "anomaly",
  "Critical/Priorities": "criticalPriorities",
  "Action Required": "actionRequired",
  "Execution Plan": "executionPlan",
  "Est.Duration (Hours)": "estimatedDuration",
  "Sparepart Need": "sparepartNeed",
  "Material Status": "materialStatus",
  "Document No": "documentNo",
  "Date Closed": "dateClosed",
  "Link_Code": "linkCode"
};

const FALLBACK_OPTIONS = {
  "Event": ["Repair", "Service", "Overhaul", "Predictive", "Backlog", "Idle Asset"],
  "Critical/Priorities": ["P1-Low", "P2-Medium", "P3-Urgent"],
  "Material Status": ["MR Released", "PR to PO", "PO Release Waiting SCM", "On Stock"],
  "Status": ["Open", "Scheduled", "Finish"]
};

let backlogColumns = BACKLOG_FIELDS.slice();
let allRecords = [];
let filteredRecords = [];
let dropdownLists = {};
let fixedAssetCatalog = [];
let selectedRowIndex = null;
let currentView = "all";
let isInlineEditingBacklog = false;
let activeBacklogAssetInput = null;
let showAllRowsOverride = false;
let printRestoreState = null;
let filterDebounceTimer = null;
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

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  const icon = type === "success" ? "✓" : (type === "error" ? "✕" : "i");
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-title">${escapeHtml(title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi"))}</div>
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

function showSaveLoading(title) {
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
    throw new Error("URL Web App GAS Backlog belum diatur.");
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
  } catch (_) {
    throw new Error("Gagal terhubung ke GAS Backlog. Periksa deployment Web App dan akses Anyone.");
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("Respons GAS Backlog bukan JSON valid.");
  }
  if (!response.ok) throw new Error(`Permintaan GAS gagal (${response.status}).`);
  if (data.status === "error" || data.success === false) {
    throw new Error(data.message || "GAS Backlog melaporkan kegagalan.");
  }
  return data;
}

async function loadFixedAssetCatalog(forceRefresh = false) {
  const snapshot = await MTCFixedAssetCatalogCache.loadCatalog({
    forceRefresh,
    fallbackRecords: fixedAssetCatalog,
    fallbackUpdatedAt: legacyFixedAssetCatalogTimestamp
  });
  fixedAssetCatalog = snapshot.records.map(asset => ({
    equipmentNo: String(asset.equipmentNo || "").trim(),
    equipmentName: String(asset.equipmentName || "").trim(),
    type: String(asset.type || "").trim(),
    serialNo: String(asset.serialNo || "").trim()
  })).filter(asset => asset.equipmentNo);
  legacyFixedAssetCatalogTimestamp = 0;
  saveLocalSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
}

function saveLocalSnapshot() {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify({
      ts: Date.now(),
      columns: backlogColumns,
      records: allRecords,
      dropdowns: dropdownLists
    }));
  } catch (error) {
    console.warn("Gagal menyimpan cache Backlog ke localStorage.", error);
  }
}

function restoreLocalSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.records)) return false;

    backlogColumns = Array.isArray(snapshot.columns) && snapshot.columns.length
      ? snapshot.columns
      : BACKLOG_FIELDS.slice();
    allRecords = snapshot.records;
    dropdownLists = snapshot.dropdowns && typeof snapshot.dropdowns === "object" ? snapshot.dropdowns : {};
    fixedAssetCatalog = Array.isArray(snapshot.assets) ? snapshot.assets : [];
    legacyFixedAssetCatalogTimestamp = Number(snapshot.ts) || 0;
    populateFilterOptions();
    applyFilters();
    return true;
  } catch (error) {
    console.warn("Gagal membaca cache Backlog dari localStorage.", error);
    return false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyDeveloperAccess();
  window.addEventListener("beforeprint", prepareBacklogPrint);
  window.addEventListener("afterprint", restoreBacklogAfterPrint);
  bindBacklogAssetPicker(document.getElementById("backlogForm"));
  document.addEventListener("click", event => {
    const popup = document.getElementById("backlogAssetSuggestPopup");
    if (popup && popup.style.display !== "none" &&
        !popup.contains(event.target) && event.target !== activeBacklogAssetInput) {
      hideBacklogAssetPopup();
    }
  });
  const hasCachedData = restoreLocalSnapshot();
  loadData(false, hasCachedData);

  const search = document.getElementById("filterSearch");
  search.addEventListener("input", () => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
      showAllRowsOverride = false;
      applyFilters();
    }, 200);
  });
});

async function loadData(forceRefresh = false, silentBackground = false) {
  if (!silentBackground) {
    document.getElementById("backlogListContainer").innerHTML = `<div class="empty-box">Memuat data Backlog...</div>`;
    document.getElementById("backlogTableBody").innerHTML = `<tr><td colspan="15" class="empty-box">Memuat data Backlog...</td></tr>`;
  } else {
    document.getElementById("backlogSummaryMeta").textContent = "• Menyinkronkan data terbaru...";
  }

  try {
    const response = await callGasApi({ action: "getData", forceRefresh: Boolean(forceRefresh) });
    applyServerData(response);
    saveLocalSnapshot();
    if (!silentBackground || forceRefresh) showToast("Data Backlog berhasil diperbarui.", "success");
  } catch (error) {
    if (silentBackground) {
      document.getElementById("backlogSummaryMeta").textContent = `• ${filteredRecords.length} Backlog`;
      showToast(`Cache ditampilkan, tetapi sinkronisasi gagal: ${error.message}`, "error", "Sinkronisasi Gagal");
    } else {
      const message = escapeHtml(error.message);
      document.getElementById("backlogListContainer").innerHTML = `<div class="empty-box backlog-error">${message}</div>`;
      document.getElementById("backlogTableBody").innerHTML = `<tr><td colspan="15" class="empty-box backlog-error">${message}</td></tr>`;
      showToast(error.message, "error", "Koneksi Gagal");
    }
  }

  try {
    await loadFixedAssetCatalog(forceRefresh);
  } catch (error) {
    const usingCache = fixedAssetCatalog.length > 0;
    showToast(
      usingCache
        ? `Katalog Fixed Asset belum tersinkron; memakai cache. ${error.message}`
        : error.message,
      "error",
      usingCache ? "Cache Fixed Asset" : "Katalog Fixed Asset"
    );
  }
}

function applyServerData(response) {
  if (Array.isArray(response.columns) && response.columns.length) backlogColumns = response.columns;
  allRecords = Array.isArray(response.records)
    ? response.records
    : Array.isArray(response.rows)
      ? response.rows
      : [];
  if (response.dropdowns && typeof response.dropdowns === "object") dropdownLists = response.dropdowns;
  populateFilterOptions();
  applyFilters();
}

function getOptionList(key) {
  const options = dropdownLists[key];
  if (Array.isArray(options) && options.length) return options.map(value => String(value)).filter(Boolean);
  return FALLBACK_OPTIONS[key] || [];
}

function populateSelect(select, options, firstLabel, selectedValue = "") {
  if (!select) return;
  const values = [...new Set(options)];
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>` +
    values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(selectedValue)) select.value = selectedValue;
}

function populateFilterOptions() {
  const definitions = [
    ["filterEvent", "Event", "Semua Event"],
    ["filterPriority", "Critical/Priorities", "Semua Priority"],
    ["filterMaterialStatus", "Material Status", "Semua Material Status"],
    ["filterStatus", "Status", "Semua Status"]
  ];
  definitions.forEach(([elementId, field, label]) => {
    const select = document.getElementById(elementId);
    const previousValue = select.value;
    const options = getOptionList(field);
    select.innerHTML = `<option value="ALL">${escapeHtml(label)}</option>` +
      options.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (options.includes(previousValue)) select.value = previousValue;
  });
  populateSelect(document.getElementById("fieldEvent"), getOptionList("Event"), "Pilih Event");
  populateSelect(document.getElementById("fieldPriority"), getOptionList("Critical/Priorities"), "Pilih Priority");
  populateSelect(document.getElementById("fieldMaterialStatus"), getOptionList("Material Status"), "Pilih Material Status");
  populateSelect(document.getElementById("fieldStatus"), getOptionList("Status"), "Pilih Status");
}

function getRecordValue(record, field) {
  const aliases = [field, BACKLOG_FIELD_KEYS[field]].filter(Boolean);
  for (const source of [record.fields, record]) {
    if (!source) continue;
    for (const key of aliases) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return source[key] ?? "";
    }
  }
  return "";
}

function getRecordRowIndex(record, fallbackIndex) {
  return record.rowIndex ?? record._rowIndex ?? fallbackIndex;
}

function getDateText(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return `${String(match[1]).padStart(2, "0")}/${String(match[2]).padStart(2, "0")}/${match[3]}`;
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${String(match[3]).padStart(2, "0")}/${String(match[2]).padStart(2, "0")}/${match[1]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function getDateInputValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  return "";
}

function applyFilters() {
  const eventValue = document.getElementById("filterEvent").value;
  const priorityValue = document.getElementById("filterPriority").value;
  const materialValue = document.getElementById("filterMaterialStatus").value;
  const statusValue = document.getElementById("filterStatus").value;
  const query = document.getElementById("filterSearch").value.trim().toLowerCase();

  filteredRecords = allRecords.filter(record => {
    if (eventValue !== "ALL" && String(getRecordValue(record, "Event")) !== eventValue) return false;
    if (priorityValue !== "ALL" && String(getRecordValue(record, "Critical/Priorities")) !== priorityValue) return false;
    if (materialValue !== "ALL" && String(getRecordValue(record, "Material Status")) !== materialValue) return false;
    if (statusValue !== "ALL" && String(getRecordValue(record, "Status")) !== statusValue) return false;
    if (query) {
      const allValues = BACKLOG_EDITABLE_FIELDS.map(field => getRecordValue(record, field)).join(" ").toLowerCase();
      if (!allValues.includes(query)) return false;
    }
    return true;
  });

  updateKpis();
  renderBacklogList();
  renderBacklogTable();
  renderBacklogDetail();
}

function updateKpis() {
  let open = 0;
  let scheduled = 0;
  let finish = 0;
  let urgent = 0;
  filteredRecords.forEach(record => {
    const status = String(getRecordValue(record, "Status")).trim().toLowerCase();
    const priority = String(getRecordValue(record, "Critical/Priorities")).toLowerCase();
    if (status === "open") open++;
    if (status === "scheduled") scheduled++;
    if (["finish", "finished"].includes(status)) finish++;
    if (priority.includes("p3") || priority.includes("urgent")) urgent++;
  });
  document.getElementById("kpiTotal").textContent = filteredRecords.length;
  document.getElementById("kpiOpen").textContent = open;
  document.getElementById("kpiScheduled").textContent = scheduled;
  document.getElementById("kpiFinish").textContent = finish;
  document.getElementById("kpiUrgent").textContent = urgent;
  document.getElementById("backlogListCount").textContent = filteredRecords.length;
  document.getElementById("backlogSummaryMeta").textContent = `• ${filteredRecords.length} Backlog`;
}

function statusClass(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["finish", "finished"].includes(status)) return "backlog-pill-finish";
  if (status.includes("schedule")) return "backlog-pill-scheduled";
  return "backlog-pill-open";
}

function statusRowClass(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["finish", "finished"].includes(status)) return "backlog-row-finish";
  if (status === "scheduled" || status === "schedule") return "backlog-row-scheduled";
  return "";
}

function statusChecklistClass(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["finish", "finished"].includes(status)) return "backlog-check-finish";
  if (status === "scheduled" || status === "schedule") return "backlog-check-scheduled";
  return "backlog-check-open";
}

function executionPlanRowClass(value, status) {
  if (["finish", "finished"].includes(String(status || "").trim().toLowerCase())) return "";
  const dateValue = getDateInputValue(value);
  if (!dateValue) return "";

  const parts = dateValue.split("-").map(Number);
  const executionDate = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(executionDate.getTime()) ||
      executionDate.getFullYear() !== parts[0] ||
      executionDate.getMonth() !== parts[1] - 1 ||
      executionDate.getDate() !== parts[2]) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilExecution = Math.round((executionDate.getTime() - today.getTime()) / 86400000);
  if (daysUntilExecution < 0) return "backlog-row-execution-overdue";
  if (daysUntilExecution <= 3) return "backlog-row-execution-soon";
  return "";
}

function priorityClass(value) {
  const priority = String(value || "").toLowerCase();
  return priority.includes("p3") || priority.includes("urgent") ? "backlog-pill-priority" : "pill-info";
}

function renderBacklogList() {
  const container = document.getElementById("backlogListContainer");
  if (!filteredRecords.length) {
    container.innerHTML = `<div class="empty-box">Tidak ada Backlog ditemukan.</div>`;
    return;
  }
  container.innerHTML = filteredRecords.map((record, index) => {
    const rowIndex = getRecordRowIndex(record, index);
    const equipment = getRecordValue(record, "Equipment Name") || "(Tanpa Equipment Name)";
    const equipmentNo = getRecordValue(record, "Equipment No");
    const event = getRecordValue(record, "Event");
    const priority = getRecordValue(record, "Critical/Priorities");
    const status = getRecordValue(record, "Status");
    const active = String(rowIndex) === String(selectedRowIndex) ? " active" : "";
    return `
      <div class="backlog-card${active}" data-row-index="${escapeHtml(String(rowIndex))}" onclick="selectBacklog(this.dataset.rowIndex)">
        <div class="backlog-card-head">
          <span class="backlog-card-title">${escapeHtml(equipment)}</span>
          <span class="backlog-pill ${statusClass(status)}">${escapeHtml(status || "Open")}</span>
        </div>
        <div class="backlog-card-sub">${escapeHtml(equipmentNo || "-")} · ${escapeHtml(event || "-")}</div>
        <div class="backlog-card-meta">
          <span>${escapeHtml(getDateText(getRecordValue(record, "Date Found")) || "-")}</span>
          <span class="backlog-pill ${priorityClass(priority)}">${escapeHtml(priority || "No Priority")}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderBacklogTable() {
  const tbody = document.getElementById("backlogTableBody");
  if (!filteredRecords.length) {
    tbody.innerHTML = `<tr><td colspan="15" class="empty-box">Belum ada data Backlog.</td></tr>`;
    document.getElementById("btnShowAllRows").style.display = "none";
    return;
  }

  const truncated = !showAllRowsOverride && filteredRecords.length > INITIAL_RENDER_ROW_LIMIT;
  const rows = truncated ? filteredRecords.slice(0, INITIAL_RENDER_ROW_LIMIT) : filteredRecords;
  document.getElementById("btnShowAllRows").style.display = truncated ? "inline-flex" : "none";
  tbody.innerHTML = rows.map((record, index) => {
    const rowIndex = getRecordRowIndex(record, index);
    const values = [
      index + 1,
      getDateText(getRecordValue(record, "Date Found")),
      getRecordValue(record, "Event"),
      getRecordValue(record, "Equipment No"),
      getRecordValue(record, "Equipment Name"),
      getRecordValue(record, "Type"),
      getRecordValue(record, "HM"),
      getRecordValue(record, "Anomaly/WO Description"),
      getRecordValue(record, "Action Required"),
      getRecordValue(record, "Sparepart Need"),
      getRecordValue(record, "Critical/Priorities"),
      getRecordValue(record, "Material Status"),
      getRecordValue(record, "Document No"),
      getRecordValue(record, "Status"),
      getDateText(getRecordValue(record, "Date Closed"))
    ];
    const cells = values.map((value, cellIndex) => {
      const isNarrative = [7, 8, 9].includes(cellIndex);
      const text = cellIndex === 13
        ? `<span class="backlog-pill ${statusClass(value)}">${escapeHtml(value || "Open")}</span>`
        : cellIndex === 10 && value
          ? `<span class="backlog-pill ${priorityClass(value)}">${escapeHtml(value)}</span>`
          : escapeHtml(isNarrative ? formatBacklogNarrative(value) : String(value ?? ""));
      const wrapClass = cellIndex === 7
        ? " class=\"backlog-wrap-cell\""
        : cellIndex === 8
          ? " class=\"backlog-action-cell\""
          : cellIndex === 9
            ? " class=\"backlog-sparepart-cell\""
            : "";
      return `<td${wrapClass}>${text}</td>`;
    }).join("");
    const status = getRecordValue(record, "Status");
    const rowClasses = [
      "clickable-row",
      statusRowClass(status),
      executionPlanRowClass(getRecordValue(record, "Execution Plan"), status)
    ].filter(Boolean).join(" ");
    return `<tr class="${rowClasses}" onclick="selectBacklog('${escapeJs(String(rowIndex))}')">${cells}</tr>`;
  }).join("");
}

function showAllRows() {
  showAllRowsOverride = true;
  renderBacklogTable();
}

function prepareBacklogPrint() {
  if (printRestoreState) return;
  printRestoreState = { showAllRowsOverride: showAllRowsOverride };
  if (currentView === "all") {
    document.body.classList.add("backlog-print-all");
    showAllRowsOverride = true;
    renderBacklogTable();
  } else {
    document.body.classList.add("backlog-print-detail");
  }
}

function restoreBacklogAfterPrint() {
  if (!printRestoreState) return;
  document.body.classList.remove("backlog-print-all", "backlog-print-detail");
  showAllRowsOverride = printRestoreState.showAllRowsOverride;
  printRestoreState = null;
  renderBacklogTable();
}

function selectBacklog(rowIndex) {
  isInlineEditingBacklog = false;
  hideBacklogAssetPopup();
  selectedRowIndex = String(rowIndex);
  switchView("detail");
}

function switchView(mode) {
  currentView = mode;
  if (mode === "all") isInlineEditingBacklog = false;
  document.getElementById("viewAll").classList.toggle("active", mode === "all");
  document.getElementById("viewDetail").classList.toggle("active", mode === "detail");
  document.getElementById("tabBtnAll").classList.toggle("active", mode === "all");
  document.getElementById("tabBtnDetail").classList.toggle("active", mode === "detail");
  if (mode === "all") {
    document.getElementById("activeBacklogInfo").textContent = "Semua Backlog";
  } else if (selectedRowIndex === null && filteredRecords.length) {
    selectedRowIndex = String(getRecordRowIndex(filteredRecords[0], 0));
  }
  renderBacklogList();
  renderBacklogDetail();
}

function renderBacklogDetail() {
  const container = document.getElementById("backlogDetailBody");
  if (!selectedRowIndex) {
    container.innerHTML = `<div class="empty-box">Pilih Backlog di panel kiri untuk melihat detail.</div>`;
    return;
  }
  const record = allRecords.find((item, index) => String(getRecordRowIndex(item, index)) === String(selectedRowIndex));
  if (!record) {
    container.innerHTML = `<div class="empty-box">Backlog tidak ditemukan.</div>`;
    return;
  }

  const equipment = getRecordValue(record, "Equipment Name") || "(Tanpa Equipment Name)";
  if (isInlineEditingBacklog) {
    container.innerHTML = renderBacklogInlineEdit(record);
    bindBacklogAssetPicker(document.getElementById("backlogInlineForm"));
    document.getElementById("activeBacklogInfo").textContent = `Edit Backlog: ${equipment}`;
    return;
  }

  const fields = BACKLOG_EDITABLE_FIELDS.map(field => {
    const raw = getRecordValue(record, field);
    const value = field.includes("Date") || field === "Execution Plan" ? getDateText(raw) : String(raw ?? "");
    const isWide = ["Anomaly/WO Description", "Action Required", "Execution Plan", "Sparepart Need", "Remarks"].includes(field);
    const isNarrative = ["Anomaly/WO Description", "Action Required", "Sparepart Need"].includes(field);
    const displayValue = field === "Status"
      ? `${escapeHtml(value || "-")} <i class="bi bi-list-check backlog-status-check ${statusChecklistClass(value)}" aria-label="${escapeHtml(value || "Open")}"></i>`
      : escapeHtml(isNarrative ? formatBacklogNarrative(value) || "-" : value || "-");
    return `
      <div class="backlog-detail-field${isWide ? " wide" : ""}">
        <div class="backlog-detail-label">${escapeHtml(field)}</div>
        <div class="backlog-detail-value${isNarrative ? " backlog-narrative-value" : ""}">${displayValue}</div>
      </div>
    `;
  }).join("");
  container.innerHTML = `
    <div class="doc-summary-box">
      <div>
        <div class="backlog-detail-heading">${escapeHtml(equipment)}</div>
        <div class="backlog-card-sub">${escapeHtml(getRecordValue(record, "Equipment No") || "-")} · ${escapeHtml(getRecordValue(record, "Event") || "-")}</div>
      </div>
      <div class="backlog-detail-actions no-print">
        <button type="button" class="btn btn-ghost btn-sm" onclick="startInlineEditBacklog()"><i class="bi bi-pencil"></i> Edit</button>
        <button type="button" class="btn btn-ghost btn-sm backlog-delete" onclick="confirmDeleteBacklog('${escapeJs(String(selectedRowIndex))}')"><i class="bi bi-trash3"></i> Hapus</button>
      </div>
    </div>
    <div class="backlog-detail-grid">${fields}</div>
  `;
  document.getElementById("activeBacklogInfo").textContent = `Backlog: ${equipment}`;
}

function formatBacklogNarrative(value) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t]*/g, "\n");
  text = text.replace(/[ \t]+-[ \t]+/g, "\n- ");
  text = text.replace(/(^|[ \t]+)(\d{1,2}[.)])(?!\d)([ \t]*)/g, (match, separator, marker, spacing, offset) =>
    `${offset === 0 ? "" : "\n"}${marker}${spacing || " "}`
  );

  const hasBareNumberedList = /(?:^|[ \t])1[ \t]+\S[\s\S]*[ \t]2[ \t]+\S/.test(text);
  if (hasBareNumberedList) {
    text = text.replace(/(^|[ \t]+)(\d{1,2})([ \t]+)/g, (match, separator, marker, spacing, offset) =>
      `${offset === 0 ? "" : "\n"}${marker} `
    );
  }
  return text;
}

function renderBacklogInlineEdit(record) {
  const bottomDateFields = ["Date Closed", "Execution Plan"];
  const fields = BACKLOG_EDITABLE_FIELDS.filter(field => !bottomDateFields.includes(field)).map(field =>
    renderBacklogFormField(field, getRecordValue(record, field), "backlog-inline")
  ).join("");
  const dates = bottomDateFields.map(field =>
    renderBacklogFormField(field, getRecordValue(record, field), "backlog-inline")
  ).join("");
  return `
    <form id="backlogInlineForm" class="backlog-inline-form" onsubmit="submitBacklog(event)">
      <input type="hidden" name="rowIndex" value="${escapeHtml(String(selectedRowIndex))}" />
      <div class="doc-summary-box">
        <div>
          <div class="backlog-detail-heading">Mode Edit — ${escapeHtml(getRecordValue(record, "Equipment Name") || "Backlog")}</div>
          <div class="backlog-card-sub">Ubah field langsung di tab Detail Backlog.</div>
        </div>
        <div class="backlog-detail-actions no-print">
          <button type="button" class="btn btn-ghost btn-sm" onclick="cancelInlineEditBacklog()">Batal</button>
          <button type="submit" class="btn btn-primary btn-sm"><i class="bi bi-check2-circle"></i> Simpan Perubahan</button>
        </div>
      </div>
      <div class="backlog-inline-grid">${fields}</div>
      <div class="backlog-inline-date-grid">${dates}</div>
    </form>
  `;
}

function renderBacklogFormField(field, value, prefix) {
  const id = `${prefix}-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const label = field === "Critical/Priorities" ? "Critical / Priorities" : field;
  const common = `id="${id}" name="${escapeHtml(field)}" class="backlog-inline-input"`;
  let control;

  if (["Event", "Critical/Priorities", "Material Status", "Status"].includes(field)) {
    const options = [...new Set([...getOptionList(field), String(value || "")].filter(Boolean))];
    control = `<select ${common}><option value="">Pilih ${escapeHtml(label)}</option>${options.map(option =>
      `<option value="${escapeHtml(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`
    ).join("")}</select>`;
  } else if (["Date Found", "Date Closed", "Execution Plan"].includes(field)) {
    control = `<input ${common} type="date" value="${escapeHtml(getDateInputValue(value))}" />`;
  } else if (field === "HM" || field === "Est.Duration (Hours)") {
    control = `<input ${common} type="number" min="0" step="any" value="${escapeHtml(String(value ?? ""))}" />`;
  } else if (["Anomaly/WO Description", "Action Required", "Sparepart Need", "Remarks"].includes(field)) {
    control = `<textarea ${common} rows="3">${escapeHtml(String(value ?? ""))}</textarea>`;
  } else {
    const isReadOnly = field === "Type";
    const placeholder = field === "Equipment No"
      ? 'placeholder="Ketik atau pilih dari Fixed Asset..." autocomplete="off"'
      : field === "Equipment Name"
        ? 'placeholder="Ketik atau pilih dari Fixed Asset..." autocomplete="off"'
        : "";
    control = `<input ${common} type="text" value="${escapeHtml(String(value ?? ""))}" ${isReadOnly ? "readonly" : ""} ${placeholder} />`;
  }

  return `<div class="backlog-inline-field"><label for="${id}">${escapeHtml(label)}</label>${control}</div>`;
}

function bindBacklogAssetPicker(form) {
  if (!form || form.dataset.assetPickerBound === "1") return;
  const equipmentNoInput = form.elements.namedItem("Equipment No");
  const equipmentNameInput = form.elements.namedItem("Equipment Name");
  const typeInput = form.elements.namedItem("Type");
  if (!equipmentNoInput || !equipmentNameInput || !typeInput) return;

  form.dataset.assetPickerBound = "1";
  const applyAsset = asset => {
    equipmentNoInput.value = asset.equipmentNo;
    equipmentNameInput.value = asset.equipmentName;
    typeInput.value = asset.type;
  };
  [
    { input: equipmentNoInput, key: "equipmentNo" },
    { input: equipmentNameInput, key: "equipmentName" }
  ].forEach(({ input, key }) => {
    input.addEventListener("focus", () => showBacklogAssetPopup(input));
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      const exactMatches = query
        ? fixedAssetCatalog.filter(asset => String(asset[key] || "").trim().toLowerCase() === query)
        : [];
      if (exactMatches.length === 1) {
        applyAsset(exactMatches[0]);
        hideBacklogAssetPopup();
        return;
      }

      if (input === equipmentNoInput) {
        equipmentNameInput.value = "";
      } else {
        equipmentNoInput.value = "";
      }
      typeInput.value = "";
      showBacklogAssetPopup(input);
    });
  });
  form._applyBacklogAsset = applyAsset;
}

function showBacklogAssetPopup(input) {
  let popup = document.getElementById("backlogAssetSuggestPopup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "backlogAssetSuggestPopup";
    popup.className = "backlog-asset-suggest";
    document.body.appendChild(popup);
  }
  activeBacklogAssetInput = input;

  const query = input.value.trim().toLowerCase();
  const matches = fixedAssetCatalog.filter(asset =>
    [asset.equipmentNo, asset.equipmentName, asset.type, asset.serialNo]
      .some(value => String(value || "").toLowerCase().includes(query))
  ).slice(0, 40);
  popup._matches = matches;

  if (!fixedAssetCatalog.length) {
    popup.innerHTML = `<div class="backlog-asset-empty">Katalog Fixed Asset belum tersedia.</div>`;
  } else if (!matches.length) {
    popup.innerHTML = `<div class="backlog-asset-empty">Fixed Asset tidak ditemukan.</div>`;
  } else {
    popup.innerHTML = matches.map((asset, index) => `
      <button type="button" class="backlog-asset-option" onmousedown="selectBacklogAssetFromPopup(${index});return false">
        <strong>${escapeHtml(asset.equipmentNo)}</strong>
        <span>${escapeHtml(asset.equipmentName || "-")}</span>
        <small>${escapeHtml([asset.type, asset.serialNo].filter(Boolean).join(" • ") || "-")}</small>
      </button>
    `).join("");
  }

  const rect = input.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 360))}px`;
  popup.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 260)}px`;
  popup.style.display = "block";
}

function selectBacklogAssetFromPopup(index) {
  const popup = document.getElementById("backlogAssetSuggestPopup");
  const input = activeBacklogAssetInput;
  const asset = popup && popup._matches ? popup._matches[index] : null;
  const form = input && input.closest("form");
  if (!asset || !form || typeof form._applyBacklogAsset !== "function") return;
  form._applyBacklogAsset(asset);
  hideBacklogAssetPopup();
}

function hideBacklogAssetPopup() {
  const popup = document.getElementById("backlogAssetSuggestPopup");
  if (popup) popup.style.display = "none";
  activeBacklogAssetInput = null;
}

function startInlineEditBacklog() {
  isInlineEditingBacklog = true;
  switchView("detail");
}

function cancelInlineEditBacklog() {
  isInlineEditingBacklog = false;
  hideBacklogAssetPopup();
  renderBacklogDetail();
}

function openBacklogModal() {
  const form = document.getElementById("backlogForm");
  form.reset();
  populateFilterOptions();
  form.elements.namedItem("rowIndex").value = "";
  form.elements.namedItem("Date Found").value = new Date().toISOString().slice(0, 10);
  form.elements.namedItem("Status").value = "Open";
  isInlineEditingBacklog = false;
  document.getElementById("backlogModal").classList.add("active");
}

function closeBacklogModal() {
  document.getElementById("backlogModal").classList.remove("active");
}

async function submitBacklog(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const rowIndex = form.elements.namedItem("rowIndex").value;
  const fields = {};
  BACKLOG_EDITABLE_FIELDS.forEach(field => {
    const input = form.elements.namedItem(field);
    fields[field] = input ? input.value.trim() : "";
  });

  const selectedAsset = fixedAssetCatalog.find(asset =>
    asset.equipmentNo === fields["Equipment No"] &&
    asset.equipmentName === fields["Equipment Name"] &&
    asset.type === fields["Type"]
  );
  if (!selectedAsset) {
    return showToast("Pilih Equipment dari daftar Fixed Asset sebelum menyimpan.", "error", "Fixed Asset Wajib Dipilih");
  }
  fields["Equipment No"] = selectedAsset.equipmentNo;
  fields["Equipment Name"] = selectedAsset.equipmentName;
  fields["Type"] = selectedAsset.type;

  for (const field of ["HM", "Est.Duration (Hours)"]) {
    if (fields[field] !== "" && (!Number.isFinite(Number(fields[field])) || Number(fields[field]) < 0)) {
      return showToast(`${field} harus berupa angka nol atau lebih.`, "error", "Nilai Tidak Valid");
    }
  }

  const status = fields.Status.trim().toLowerCase();
  if (["finish", "finished"].includes(status) && !fields["Date Closed"]) {
    return showToast("Date Closed wajib diisi saat Status Finish.", "error", "Tanggal Penutupan Wajib");
  }
  if (status === "scheduled" && !fields["Execution Plan"]) {
    return showToast("Execution Plan wajib diisi saat Status Scheduled.", "error", "Execution Plan Wajib");
  }

  if (form.id === "backlogForm") closeBacklogModal();
  hideBacklogAssetPopup();
  showSaveLoading(rowIndex ? "Memperbarui Backlog" : "Menyimpan Backlog");
  try {
    const response = await callGasApi({
      action: rowIndex ? "updateRecord" : "createRecord",
      record: { rowIndex: rowIndex || undefined, fields }
    });
    if (Array.isArray(response.records)) {
      allRecords = response.records;
    } else {
      throw new Error("Respons simpan harus berisi daftar records terbaru.");
    }
    if (response.dropdowns && typeof response.dropdowns === "object") dropdownLists = response.dropdowns;
    saveLocalSnapshot();
    Swal.close();
    isInlineEditingBacklog = false;
    selectedRowIndex = rowIndex || String(getRecordRowIndex(allRecords[allRecords.length - 1] || {}, allRecords.length - 1));
    applyFilters();
    switchView("detail");
    showToast(rowIndex ? "Backlog berhasil diperbarui." : "Backlog berhasil ditambahkan.", "success");
  } catch (error) {
    Swal.fire({ icon: "error", title: "Gagal Simpan", text: error.message });
  }
}

function confirmDeleteBacklog(rowIndex) {
  const record = allRecords.find((item, index) => String(getRecordRowIndex(item, index)) === String(rowIndex));
  const equipment = record ? getRecordValue(record, "Equipment Name") : "";
  Swal.fire({
    title: "Hapus Backlog?",
    text: `Data ${equipment || "Backlog ini"} akan dihapus dari server.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc2626",
    confirmButtonText: "Ya, Hapus",
    cancelButtonText: "Batal"
  }).then(async result => {
    if (!result.isConfirmed) return;
    showSaveLoading("Menghapus Backlog");
    try {
      const response = await callGasApi({ action: "deleteRecord", rowIndex });
      if (!Array.isArray(response.records)) throw new Error("Respons hapus harus berisi daftar records terbaru.");
      allRecords = response.records;
      saveLocalSnapshot();
      selectedRowIndex = null;
      Swal.close();
      applyFilters();
      switchView("all");
      showToast("Backlog berhasil dihapus.", "success");
    } catch (error) {
      Swal.fire({ icon: "error", title: "Gagal Hapus", text: error.message });
    }
  });
}

function exportToExcel() {
  if (!filteredRecords.length) return showToast("Tidak ada data untuk diexport.", "info");
  if (!window.XLSX) return showToast("Library export Excel belum termuat.", "error");
  const data = [
    BACKLOG_EDITABLE_FIELDS,
    ...filteredRecords.map(record => BACKLOG_EDITABLE_FIELDS.map(field => getRecordValue(record, field)))
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Backlog");
  XLSX.writeFile(workbook, `Backlog_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  const value = document.getElementById("gasApiUrlInput").value.trim();
  if (!value.startsWith("https://script.google.com/")) {
    return showToast("URL harus diawali https://script.google.com/", "error");
  }
  localStorage.setItem(STORAGE_KEY_API, value);
  closeApiConfigModal();
  loadData(true);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\r\n]/g, " ");
}