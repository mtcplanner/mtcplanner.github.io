const MONITORING_OLI_GAS_URL = "https://script.google.com/macros/s/AKfycbxDqN_3UoOxvyRGNo6iH795N9mxUtNB8mWpZfsMq-nrLekclAckAFBm3NTy9VCII736/exec";
let initialData = null;
let transactionRows = [];
let transactionRecords = [];
let summaryOilStocks = [];
let defaultDateValue = "";
let selectedDate = "";
let isDetailEditing = false;
const initialRowCount = 5;
const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const transactionFields = ["mr", "tanggal", "kodeLokasi", "kodeOli", "tipeTransaksi", "qtyInput", "noRef", "keterangan", "inputBy"];

async function requestMonitoringOli(action, payload = {}) {
  let response;
  try {
    response = await fetch(MONITORING_OLI_GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
  } catch (error) {
    throw new Error("Gagal terhubung ke server Monitoring Oli.");
  }

  if (!response.ok) {
    throw new Error(`Server Monitoring Oli merespons ${response.status}.`);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("Respons server Monitoring Oli tidak valid.");
  }

  if (!result || result.success === false) {
    throw new Error(result && result.message ? result.message : "Permintaan Monitoring Oli gagal.");
  }
  return result;
}

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

function formatDate(value) {
  const parts = String(value || "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value || "-");
}

function localDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = type === "success" ? "✓" : type === "error" ? "✕" : "i";

  const content = document.createElement("div");
  const heading = document.createElement("div");
  heading.className = "toast-title";
  heading.textContent = title || (type === "success" ? "Berhasil" : type === "error" ? "Gagal" : "Informasi");
  const text = document.createElement("div");
  text.className = "toast-message";
  text.textContent = message;
  content.append(heading, text);
  toast.append(icon, content);
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3400);
}

function confirmAction(title, text, confirmText, tone = "danger") {
  return Swal.fire({
    title,
    text,
    icon: tone === "danger" ? "warning" : "question",
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Batal",
    buttonsStyling: false,
    customClass: {
      popup: "mr-confirm-popup",
      title: "mr-confirm-title",
      htmlContainer: "mr-confirm-html",
      actions: "mr-confirm-actions",
      confirmButton: `mr-confirm-button${tone === "primary" ? " mr-save-confirm-button" : ""}`,
      cancelButton: "mr-cancel-button"
    }
  });
}

function showLoading(title) {
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

function renderEntryRows() {
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
        <td><select data-row="${index}" data-field="kodeLokasi" required><option value="">– Lokasi –</option>${locationOptions}</select></td>
        <td><select data-row="${index}" data-field="kodeOli" required><option value="">– Nama Oli –</option>${oilOptions}</select></td>
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

function groupTransactionsByDate() {
  const groups = new Map();
  transactionRecords.forEach(record => {
    if (!groups.has(record.tanggal)) {
      groups.set(record.tanggal, { tanggal: record.tanggal, records: [], masuk: 0, terpakai: 0, locations: new Set() });
    }
    const group = groups.get(record.tanggal);
    group.records.push(record);
    group.locations.add(record.kodeLokasi);
    if (String(record.tipeTransaksi || "").toLowerCase() === "masuk") group.masuk += Number(record.qtyInput) || 0;
    else group.terpakai += Number(record.qtyInput) || 0;
  });
  return Array.from(groups.values()).sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

function renderSummaryCards() {
  const totals = transactionRecords.reduce((summary, record) => {
    const qty = Number(record.qtyInput) || 0;
    if (String(record.tipeTransaksi || "").toLowerCase() === "masuk") summary.incoming += qty;
    else summary.usage += qty;
    if (record.tanggal) summary.days.add(record.tanggal);
    return summary;
  }, { incoming: 0, usage: 0, days: new Set() });

  document.getElementById("summaryTransactions").textContent = formatNumber(transactionRecords.length);
  document.getElementById("summaryIncoming").textContent = `${formatNumber(totals.incoming)} L`;
  document.getElementById("summaryUsage").textContent = `${formatNumber(totals.usage)} L`;
  document.getElementById("summaryDays").textContent = formatNumber(totals.days.size);
}

function renderHeaderStockCards() {
  const container = document.getElementById("headerStockCards");
  if (!summaryOilStocks.length) {
    container.innerHTML = '<span class="header-stock-message">Data saldo oli tidak tersedia.</span>';
    return;
  }

  container.innerHTML = summaryOilStocks.map(stock => {
    const name = stock.namaOli || stock.kodeOli;
    const status = String(stock.statusStok || "").toLowerCase();
    const statusClass = status.includes("kritis") ? "critical" : status.includes("menipis") ? "low" : "normal";
    const unit = String(stock.satuan || "Liter").toLowerCase().startsWith("liter") ? "L" : stock.satuan;
    const description = `${name} (${stock.kodeOli}) — ${formatNumber(stock.saldoAkhir)} ${unit}${stock.statusStok ? `, ${stock.statusStok}` : ""}`;
    return `
      <article class="header-stock-card stock-${statusClass}" role="listitem" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">
        <span class="header-stock-name">${escapeHtml(name)}</span>
        <strong class="header-stock-value">${formatNumber(stock.saldoAkhir)}<small>${escapeHtml(unit)}</small></strong>
      </article>
    `;
  }).join("");
}

function renderDailySummary() {
  const groups = groupTransactionsByDate();
  document.getElementById("dailyCount").textContent = `${groups.length} Hari`;
  const tbody = document.getElementById("dailySummaryBody");
  if (!groups.length) {
    tbody.innerHTML = '<tr><td class="empty-cell" colspan="6">Belum ada transaksi harian.</td></tr>';
    return;
  }

  tbody.innerHTML = groups.map(group => `
    <tr class="daily-row${group.tanggal === selectedDate ? " active" : ""}" data-open-date="${escapeHtml(group.tanggal)}" tabindex="0" role="button" aria-label="Buka transaksi ${formatDate(group.tanggal)}">
      <td>
        <strong>${formatDate(group.tanggal)}</strong>
        <small>${group.locations.size} lokasi · Masuk ${formatNumber(group.masuk)} L · Pakai ${formatNumber(group.terpakai)} L</small>
      </td>
      <td><span class="daily-transaction-count">${group.records.length}</span></td>
    </tr>
  `).join("");
}

function selectOptions(items, selectedValue, labelKey = "nama") {
  const selectedExists = items.some(item => item.kode === selectedValue);
  const options = items.map(item => `
    <option value="${escapeHtml(item.kode)}" ${item.kode === selectedValue ? "selected" : ""}>
      ${escapeHtml(item[labelKey])} (${escapeHtml(item.kode)})
    </option>
  `);
  if (selectedValue && !selectedExists) {
    options.unshift(`<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)} (tidak aktif)</option>`);
  }
  return options.join("");
}

function renderDetailRows() {
  const tbody = document.getElementById("detailRows");
  const dateLabel = document.getElementById("detailDateLabel");
  const editButton = document.getElementById("editButton");
  const cancelButton = document.getElementById("cancelEditButton");
  const records = transactionRecords
    .filter(record => record.tanggal === selectedDate)
    .sort((a, b) => a.rowNumber - b.rowNumber);

  dateLabel.textContent = selectedDate ? `Tanggal transaksi: ${formatDate(selectedDate)} · ${records.length} transaksi` : "Pilih tanggal pada tab Rekap Harian.";
  editButton.disabled = !records.length;
  editButton.textContent = isDetailEditing ? "✓ Simpan Perubahan" : "✎ Edit";
  cancelButton.hidden = !isDetailEditing;

  if (!selectedDate || !records.length) {
    tbody.innerHTML = `<tr><td class="empty-cell" colspan="11">${selectedDate ? "Tidak ada transaksi pada tanggal ini." : "Pilih tanggal untuk melihat detail transaksi."}</td></tr>`;
    return;
  }

  const locations = initialData ? initialData.lokasiList || [] : [];
  const oils = initialData ? initialData.oliList || [] : [];
  tbody.innerHTML = records.map((record, index) => {
    const fields = isDetailEditing ? `
      <td><input class="detail-input" type="text" data-field="mr" value="${escapeHtml(record.mr)}"></td>
      <td><input class="detail-input" type="date" data-field="tanggal" value="${escapeHtml(record.tanggal)}" required></td>
      <td><select class="detail-input" data-field="kodeLokasi" required><option value="">– Pilih –</option>${selectOptions(locations, record.kodeLokasi)}</select></td>
      <td><select class="detail-input" data-field="kodeOli" required><option value="">– Pilih –</option>${selectOptions(oils, record.kodeOli)}</select></td>
      <td>
        <select class="detail-input" data-field="tipeTransaksi" required>
          <option value="Masuk" ${record.tipeTransaksi.toLowerCase() === "masuk" ? "selected" : ""}>Masuk</option>
          <option value="Terpakai" ${record.tipeTransaksi.toLowerCase() !== "masuk" ? "selected" : ""}>Terpakai</option>
        </select>
      </td>
      <td><input class="detail-input number-input" type="number" min="0" step="any" data-field="qtyInput" value="${escapeHtml(record.qtyInput)}" required></td>
      <td><input class="detail-input" type="text" data-field="noRef" value="${escapeHtml(record.noRef)}"></td>
      <td><input class="detail-input" type="text" data-field="keterangan" value="${escapeHtml(record.keterangan)}"></td>
    ` : `
      <td>${escapeHtml(record.mr || "-")}</td>
      <td>${formatDate(record.tanggal)}</td>
      <td>${escapeHtml(record.namaLokasi || record.kodeLokasi)}</td>
      <td>${escapeHtml(record.namaOli || record.kodeOli)}</td>
      <td><span class="type-pill${record.tipeTransaksi.toLowerCase() === "masuk" ? " incoming" : " usage"}">${escapeHtml(record.tipeTransaksi)}</span></td>
      <td class="number-cell"><strong>${formatNumber(record.qtyInput)}</strong></td>
      <td>${escapeHtml(record.noRef || "-")}</td>
      <td>${escapeHtml(record.keterangan || "-")}</td>
    `;
    return `
      <tr data-row-number="${record.rowNumber}">
        <td>${index + 1}</td>
        ${fields}
        <td>${escapeHtml(record.inputBy || "-")}</td>
        <td>${isDetailEditing ? '<span class="row-action-placeholder">-</span>' : `<button class="remove-row" type="button" data-delete-row="${record.rowNumber}" aria-label="Hapus transaksi ${index + 1}">×</button>`}</td>
      </tr>
    `;
  }).join("");
}

function switchTab(tab) {
  const isRekap = tab === "rekap";
  document.getElementById("tabRekap").classList.toggle("active", isRekap);
  document.getElementById("tabDetail").classList.toggle("active", !isRekap);
  document.getElementById("tabRekap").setAttribute("aria-selected", String(isRekap));
  document.getElementById("tabDetail").setAttribute("aria-selected", String(!isRekap));
  document.getElementById("rekapView").classList.toggle("active", isRekap);
  document.getElementById("detailView").classList.toggle("active", !isRekap);
  if (!isRekap) renderDetailRows();
}

function addRow() {
  transactionRows.push(makeTransactionRow());
  renderEntryRows();
  const newInput = document.querySelector(`[data-row="${transactionRows.length - 1}"][data-field="mr"]`);
  if (newInput) newInput.focus();
}

function hasTransactionContent(row) {
  return [row.mr, row.kodeOli, row.qtyInput, row.keterangan]
    .some(value => String(value ?? "").trim() !== "");
}

async function refreshOliData() {
  const [data, transactionData] = await Promise.all([
    requestMonitoringOli("getInitialData"),
    requestMonitoringOli("getTransactionRecords")
  ]);
  initialData = data;
  transactionRecords = transactionData.records || [];
  populateLocations();

  const serverDate = initialData.serverDate || localDateString();
  const dateInput = document.getElementById("defaultDate");
  if (!dateInput.value || !defaultDateValue) dateInput.value = serverDate;
  defaultDateValue = dateInput.value;

  if (!transactionRows.length) {
    transactionRows = Array.from({ length: initialRowCount }, () => makeTransactionRow());
  }
  renderEntryRows();
  renderSummaryCards();
  renderDailySummary();
  renderDetailRows();

  try {
    const stockData = await requestMonitoringOli("getSummaryOilStocks");
    summaryOilStocks = stockData.stocks || [];
    renderHeaderStockCards();
  } catch (error) {
    document.getElementById("headerStockCards").innerHTML = '<span class="header-stock-message" role="alert">Gagal memuat saldo stok.</span>';
    showToast(error.message, "error", "Gagal Memuat Sisa Stok");
  }
}

async function loadData() {
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  button.textContent = "Memuat...";
  try {
    await refreshOliData();
    showToast("Data transaksi berhasil diperbarui.", "info");
  } catch (error) {
    showToast(error.message, "error", "Gagal Memuat Data");
  } finally {
    button.disabled = false;
    button.textContent = "↻ Refresh Data";
  }
}

async function postTransactions() {
  const inputUser = document.getElementById("inputBy").value.trim();
  const filledRows = transactionRows.filter(hasTransactionContent);
  if (!filledRows.length) {
    showToast("Isi minimal satu transaksi sebelum diposting.", "error", "Validasi Transaksi");
    return;
  }

  const invalidIndex = filledRows.findIndex(row =>
    !row.tanggal || !row.kodeLokasi || !row.kodeOli ||
    !row.tipeTransaksi || !Number.isFinite(Number(row.qtyInput)) || Number(row.qtyInput) <= 0
  );
  if (invalidIndex !== -1) {
    showToast(`Lengkapi data wajib dan qty lebih dari 0 pada baris transaksi ke-${invalidIndex + 1}.`, "error", "Validasi Transaksi");
    return;
  }

  const confirmation = await confirmAction(
    "Simpan Transaksi?",
    `${filledRows.length} transaksi akan diposting ke data Monitoring Oli.`,
    "Ya, Simpan",
    "primary"
  );
  if (!confirmation.isConfirmed) return;

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
  const saveButton = document.getElementById("saveButton");
  saveButton.disabled = true;
  showLoading("Menyimpan Transaksi");
  let saved = false;
  try {
    const result = await requestMonitoringOli("saveBatchTransactions", { rows, inputUser });
    saved = true;
    transactionRows = [];
    await refreshOliData();
    Swal.close();
    showToast(result.message || `${rows.length} transaksi berhasil disimpan.`);
  } catch (error) {
    Swal.close();
    showToast(saved
      ? "Transaksi sudah tersimpan, tetapi data terbaru gagal dimuat. Klik Refresh Data."
      : error.message, "error", saved ? "Data Tersimpan" : "Gagal Menyimpan");
  } finally {
    saveButton.disabled = false;
  }
}

function expectedRecord(record) {
  return transactionFields.reduce((expected, field) => {
    expected[field] = record[field];
    return expected;
  }, {});
}

function collectUpdatedRecord(row) {
  const updated = {};
  row.querySelectorAll("[data-field]").forEach(input => {
    updated[input.dataset.field] = input.value;
  });
  updated.qtyInput = Number(updated.qtyInput);
  const record = transactionRecords.find(item => item.rowNumber === Number(row.dataset.rowNumber));
  updated.inputBy = record ? record.inputBy : "";
  return updated;
}

function hasRecordChanged(previous, updated) {
  return transactionFields.some(field => {
    if (field === "qtyInput") return Number(previous[field]) !== Number(updated[field]);
    return String(previous[field] ?? "") !== String(updated[field] ?? "");
  });
}

async function saveDetailChanges() {
  const rows = Array.from(document.querySelectorAll("#detailRows tr[data-row-number]"));
  const changes = [];
  for (const row of rows) {
    const existing = transactionRecords.find(item => item.rowNumber === Number(row.dataset.rowNumber));
    if (!existing) continue;
    const updated = collectUpdatedRecord(row);
    if (!updated.tanggal || !updated.kodeLokasi || !updated.kodeOli ||
        !["Masuk", "Terpakai"].includes(updated.tipeTransaksi) ||
        !Number.isFinite(updated.qtyInput) || updated.qtyInput <= 0) {
      showToast("Tanggal, lokasi, oli, tipe transaksi, dan qty lebih dari 0 wajib diisi.", "error", "Validasi Perubahan");
      return;
    }
    if (hasRecordChanged(existing, updated)) {
      changes.push({ rowNumber: existing.rowNumber, expected: expectedRecord(existing), updated });
    }
  }

  if (!changes.length) {
    isDetailEditing = false;
    renderDetailRows();
    showToast("Tidak ada perubahan untuk disimpan.", "info");
    return;
  }

  const confirmation = await confirmAction(
    "Simpan Perubahan?",
    `${changes.length} transaksi akan diperbarui.`,
    "Ya, Simpan",
    "primary"
  );
  if (!confirmation.isConfirmed) return;

  const saveButton = document.getElementById("editButton");
  saveButton.disabled = true;
  showLoading("Menyimpan Perubahan");
  let saved = false;
  try {
    const result = await requestMonitoringOli("updateTransactions", { changes });
    saved = true;
    isDetailEditing = false;
    await refreshOliData();
    Swal.close();
    showToast(result.message || `${changes.length} transaksi berhasil diperbarui.`);
  } catch (error) {
    Swal.close();
    showToast(saved
      ? "Perubahan tersimpan, tetapi data terbaru gagal dimuat. Klik Refresh Data."
      : error.message, "error", saved ? "Data Tersimpan" : "Gagal Menyimpan");
  } finally {
    saveButton.disabled = false;
  }
}

async function confirmDeleteTransaction(rowNumber) {
  const record = transactionRecords.find(item => item.rowNumber === Number(rowNumber));
  if (!record) {
    showToast("Transaksi tidak ditemukan. Muat ulang data.", "error");
    return;
  }
  const confirmation = await confirmAction(
    "Hapus Transaksi?",
    `Transaksi ${formatDate(record.tanggal)} · ${record.namaOli || record.kodeOli} · ${formatNumber(record.qtyInput)} L akan dihapus.`,
    "Ya, Hapus"
  );
  if (!confirmation.isConfirmed) return;

  showLoading("Menghapus Transaksi");
  let deleted = false;
  try {
    const result = await requestMonitoringOli("deleteTransaction", {
      rowNumber: record.rowNumber,
      expected: expectedRecord(record)
    });
    deleted = true;
    await refreshOliData();
    Swal.close();
    showToast(result.message || "Transaksi berhasil dihapus.");
  } catch (error) {
    Swal.close();
    showToast(deleted
      ? "Transaksi sudah dihapus, tetapi data terbaru gagal dimuat. Klik Refresh Data."
      : error.message, "error", deleted ? "Data Dihapus" : "Gagal Menghapus");
  }
}

async function removeEntryRow(index) {
  const confirmation = await confirmAction(
    "Hapus Baris Input?",
    "Baris ini belum diposting dan akan dihapus dari form.",
    "Ya, Hapus"
  );
  if (!confirmation.isConfirmed) return;
  transactionRows.splice(index, 1);
  renderEntryRows();
  showToast("Baris input dihapus.", "success");
}

async function cancelDetailEditing() {
  const confirmation = await confirmAction(
    "Batalkan Edit?",
    "Perubahan yang belum disimpan akan dibuang.",
    "Ya, Batalkan",
    "primary"
  );
  if (!confirmation.isConfirmed) return;
  isDetailEditing = false;
  renderDetailRows();
}

function openDailyDate(date) {
  selectedDate = date;
  isDetailEditing = false;
  renderDailySummary();
  renderDetailRows();
  switchTab("detail");
}

document.getElementById("inputBy").value = new URLSearchParams(window.location.search).get("user") || "Planner";
document.getElementById("refreshButton").addEventListener("click", loadData);
document.getElementById("addRowButton").addEventListener("click", addRow);
document.getElementById("saveButton").addEventListener("click", postTransactions);
document.getElementById("tabRekap").addEventListener("click", () => switchTab("rekap"));
document.getElementById("tabDetail").addEventListener("click", () => switchTab("detail"));
document.getElementById("editButton").addEventListener("click", () => {
  if (isDetailEditing) {
    saveDetailChanges();
  } else {
    isDetailEditing = true;
    renderDetailRows();
  }
});
document.getElementById("cancelEditButton").addEventListener("click", cancelDetailEditing);

document.getElementById("defaultDate").addEventListener("change", event => {
  const nextDate = event.target.value;
  transactionRows.forEach(row => {
    if (!row.tanggal || row.tanggal === defaultDateValue) row.tanggal = nextDate;
  });
  defaultDateValue = nextDate;
  renderEntryRows();
});

document.getElementById("defaultLocation").addEventListener("change", event => {
  transactionRows.forEach(row => {
    if (!row.kodeLokasi) row.kodeLokasi = event.target.value;
  });
  renderEntryRows();
});

document.getElementById("defaultReference").addEventListener("change", event => {
  transactionRows.forEach(row => {
    if (!row.noRef) row.noRef = event.target.value.trim();
  });
  renderEntryRows();
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
  if (field === "kodeLokasi" || field === "kodeOli") renderEntryRows();
});

document.getElementById("entryRows").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) removeEntryRow(Number(removeButton.dataset.remove));
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

document.getElementById("dailySummaryBody").addEventListener("click", event => {
  const row = event.target.closest("[data-open-date]");
  if (!row) return;
  openDailyDate(row.dataset.openDate);
});

document.getElementById("dailySummaryBody").addEventListener("keydown", event => {
  if (!["Enter", " "].includes(event.key)) return;
  const row = event.target.closest("[data-open-date]");
  if (!row) return;
  event.preventDefault();
  openDailyDate(row.dataset.openDate);
});

document.getElementById("detailRows").addEventListener("click", event => {
  const button = event.target.closest("[data-delete-row]");
  if (button && !isDetailEditing) confirmDeleteTransaction(Number(button.dataset.deleteRow));
});

async function initialize() {
  try {
    await refreshOliData();
  } catch (error) {
    showToast(error.message, "error", "Gagal Memuat Data");
  }
}

initialize();
