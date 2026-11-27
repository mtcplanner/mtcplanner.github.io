let initialData = null;
let transactionRows = [];
let defaultDateValue = "";
const initialRowCount = 5;
const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatNumber(value) {
  return numberFormat.format(Number(value) || 0);
}

function localDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function moduleHref(path) {
  const url = new URL(path, window.location.href);
  url.search = window.location.search;
  return url.href;
}

function showNotice(type, message) {
  const error = document.getElementById("errorNotice");
  const success = document.getElementById("successNotice");
  error.hidden = type !== "error";
  success.hidden = type !== "success";
  error.textContent = type === "error" ? message : "";
  success.textContent = type === "success" ? message : "";
}

function makeTransactionRow(overrides = {}) {
  return {
    mr: "",
    tanggal: document.getElementById("defaultDate").value || defaultDateValue || localDateString(),
    kodeLokasi: document.getElementById("defaultLocation").value || "",
    kodeOli: "",
    tipeTransaksi: "Terpakai",
    qtyInput: "",
    noRef: document.getElementById("defaultReference").value.trim(),
    keterangan: "",
    ...overrides
  };
}

function populateLocations() {
  const select = document.getElementById("defaultLocation");
  const previous = select.value;
  const locations = initialData ? initialData.lokasiList || [] : [];
  select.innerHTML = '<option value="">– Pilih Lokasi Default –</option>' + locations.map(location => `
    <option value="${escapeHtml(location.kode)}">${escapeHtml(location.nama)} (${escapeHtml(location.kode)})</option>
  `).join("");
  if (locations.some(location => location.kode === previous)) select.value = previous;
}

function getStockInfo(row) {
  if (!initialData || !row.kodeLokasi || !row.kodeOli) return null;
  const location = (initialData.locationMonitoring || []).find(item => item.kodeLokasi === row.kodeLokasi);
  return location ? location.items.find(item => item.kodeOli === row.kodeOli) || null : null;
}

function renderRows() {
  const tbody = document.getElementById("entryRows");
  const locations = initialData ? initialData.lokasiList || [] : [];
  const oils = initialData ? initialData.oliList || [] : [];

  tbody.innerHTML = transactionRows.map((row, index) => {
    const stockInfo = getStockInfo(row);
    const locationOptions = locations.map(location => `
      <option value="${escapeHtml(location.kode)}" ${location.kode === row.kodeLokasi ? "selected" : ""}>
        ${escapeHtml(location.nama)} (${escapeHtml(location.kode)})
      </option>
    `).join("");
    const oilOptions = oils.map(oil => `
      <option value="${escapeHtml(oil.kode)}" ${oil.kode === row.kodeOli ? "selected" : ""}>
        ${escapeHtml(oil.nama)} (${escapeHtml(oil.kode)})
      </option>
    `).join("");
    const lowStock = stockInfo && stockInfo.saldoAkhir <= stockInfo.minAlert;

    return `
      <tr>
        <td>${index + 1}</td>
        <td><input data-row="${index}" data-field="mr" type="text" value="${escapeHtml(row.mr)}" placeholder="No. MR"></td>
        <td><input data-row="${index}" data-field="tanggal" type="date" value="${escapeHtml(row.tanggal)}" required></td>
        <td>
          <select data-row="${index}" data-field="kodeLokasi" required>
            <option value="">– Lokasi –</option>${locationOptions}
          </select>
        </td>
        <td>
          <select data-row="${index}" data-field="kodeOli" required>
            <option value="">– Nama Oli –</option>${oilOptions}
          </select>
        </td>
        <td class="stock-cell"><span class="stock-badge${lowStock ? " low" : ""}">${stockInfo ? formatNumber(stockInfo.saldoAkhir) : "-"}</span></td>
        <td>
          <select data-row="${index}" data-field="tipeTransaksi" required>
            <option value="Masuk" ${row.tipeTransaksi === "Masuk" ? "selected" : ""}>Masuk</option>
            <option value="Terpakai" ${row.tipeTransaksi === "Terpakai" ? "selected" : ""}>Keluar / Terpakai</option>
          </select>
        </td>
        <td><input data-row="${index}" data-field="qtyInput" type="number" min="0" step="any" value="${escapeHtml(row.qtyInput)}" placeholder="0" required></td>
        <td><input data-row="${index}" data-field="noRef" type="text" value="${escapeHtml(row.noRef)}" placeholder="SJ / WO"></td>
        <td><input data-row="${index}" data-field="keterangan" type="text" value="${escapeHtml(row.keterangan)}" placeholder="Unit / Catatan"></td>
        <td><button class="remove-row" data-remove="${index}" type="button" aria-label="Hapus baris ${index + 1}">×</button></td>
      </tr>
    `;
  }).join("");
}

async function loadData() {
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  button.textContent = "Memuat...";
  try {
    initialData = await MonitoringOliApi.request("getInitialData");
    populateLocations();

    const serverDate = initialData.serverDate || localDateString();
    const dateInput = document.getElementById("defaultDate");
    if (!dateInput.value || !defaultDateValue) dateInput.value = serverDate;
    defaultDateValue = dateInput.value;

    if (!transactionRows.length) {
      transactionRows = Array.from({ length: initialRowCount }, () => makeTransactionRow());
    }

    renderRows();
    showNotice("", "");
    return true;
  } catch (error) {
    showNotice("error", error.message);
    return false;
  } finally {
    button.disabled = false;
    button.textContent = "↻ Refresh Data";
  }
}

function addRow() {
  transactionRows.push(makeTransactionRow());
  renderRows();
  const newInput = document.querySelector(`[data-row="${transactionRows.length - 1}"][data-field="mr"]`);
  if (newInput) newInput.focus();
}

function hasTransactionContent(row) {
  return [row.mr, row.kodeOli, row.qtyInput, row.keterangan]
    .some(value => String(value ?? "").trim() !== "");
}

async function postTransactions() {
  const saveButton = document.getElementById("saveButton");
  const inputUser = document.getElementById("inputBy").value.trim();
  const filledRows = transactionRows.filter(hasTransactionContent);

  showNotice("", "");
  if (!filledRows.length) {
    showNotice("error", "Isi minimal satu transaksi sebelum diposting.");
    return;
  }

  const invalidIndex = filledRows.findIndex(row =>
    !row.tanggal || !row.kodeLokasi || !row.kodeOli ||
    !row.tipeTransaksi || !Number.isFinite(Number(row.qtyInput)) || Number(row.qtyInput) <= 0
  );
  if (invalidIndex !== -1) {
    showNotice("error", `Lengkapi tanggal, lokasi, nama oli, tipe transaksi, dan qty lebih dari 0 pada baris transaksi ke-${invalidIndex + 1}.`);
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Menyimpan...";
  try {
    const rows = filledRows.map(row => ({
      mr: row.mr.trim(),
      tanggal: row.tanggal,
      kodeLokasi: row.kodeLokasi,
      kodeOli: row.kodeOli,
      tipeTransaksi: row.tipeTransaksi,
      qtyInput: Number(row.qtyInput),
      noRef: row.noRef.trim(),
      keterangan: row.keterangan.trim()
    }));
    const result = await MonitoringOliApi.request("saveBatchTransactions", { rows, inputUser });
    transactionRows = [];
    const refreshed = await loadData();
    if (refreshed) {
      showNotice("success", result.message || `${rows.length} transaksi berhasil disimpan.`);
    } else {
      showNotice("error", "Transaksi sudah tersimpan, tetapi data terbaru gagal dimuat. Klik Refresh Data.");
    }
  } catch (error) {
    showNotice("error", error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "▣ Posting Transaksi";
  }
}

document.getElementById("dashboardLink").href = moduleHref("../../home/dashboardoli/");
document.getElementById("inputBy").value = new URLSearchParams(window.location.search).get("user") || "Planner";
document.getElementById("refreshButton").addEventListener("click", loadData);
document.getElementById("addRowButton").addEventListener("click", addRow);
document.getElementById("saveButton").addEventListener("click", postTransactions);

document.getElementById("defaultDate").addEventListener("change", event => {
  const nextDate = event.target.value;
  transactionRows.forEach(row => {
    if (!row.tanggal || row.tanggal === defaultDateValue) row.tanggal = nextDate;
  });
  defaultDateValue = nextDate;
  renderRows();
});

document.getElementById("defaultLocation").addEventListener("change", event => {
  transactionRows.forEach(row => {
    if (!row.kodeLokasi) row.kodeLokasi = event.target.value;
  });
  renderRows();
});

document.getElementById("defaultReference").addEventListener("change", event => {
  transactionRows.forEach(row => {
    if (!row.noRef) row.noRef = event.target.value.trim();
  });
  renderRows();
});

document.getElementById("entryRows").addEventListener("input", event => {
  const target = event.target;
  const rowIndex = Number(target.dataset.row);
  const field = target.dataset.field;
  if (Number.isInteger(rowIndex) && field && transactionRows[rowIndex]) {
    transactionRows[rowIndex][field] = target.value;
  }
});

document.getElementById("entryRows").addEventListener("change", event => {
  const target = event.target;
  const rowIndex = Number(target.dataset.row);
  const field = target.dataset.field;
  if (!Number.isInteger(rowIndex) || !field || !transactionRows[rowIndex]) return;

  transactionRows[rowIndex][field] = target.value;
  if (field === "kodeLokasi" || field === "kodeOli") renderRows();
});

document.getElementById("entryRows").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove]");
  if (!removeButton) return;
  transactionRows.splice(Number(removeButton.dataset.remove), 1);
  renderRows();
});

document.getElementById("entryRows").addEventListener("keydown", event => {
  const target = event.target;
  const rowIndex = Number(target.dataset.row);
  if (target.dataset.field !== "keterangan" ||
      rowIndex !== transactionRows.length - 1 ||
      !["Enter", "Tab"].includes(event.key)) return;

  event.preventDefault();
  transactionRows[rowIndex].keterangan = target.value;
  addRow();
});

loadData();
