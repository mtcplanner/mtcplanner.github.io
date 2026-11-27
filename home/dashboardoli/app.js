const MONITORING_OLI_GAS_URL = "https://script.google.com/macros/s/AKfycbxDqN_3UoOxvyRGNo6iH795N9mxUtNB8mWpZfsMq-nrLekclAckAFBm3NTy9VCII736/exec";
let dashboardData = null;
const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

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
  if (!value) return "-";
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value);
}

function setError(message) {
  const notice = document.getElementById("errorNotice");
  notice.textContent = message || "";
  notice.hidden = !message;
}

function renderKpis(data) {
  const kpi = data.kpi || {};
  const cards = [
    { icon: "🛢️", label: "Total Stok Semua Oli", value: `${formatNumber(kpi.totalStokAkhir)} L`, note: `${kpi.totalLokasiAktif || 0} Lokasi • ${kpi.totalJenisOliAktif || 0} Jenis Oli` },
    { icon: "📥", label: "Oli Masuk Hari Ini", value: `${formatNumber(kpi.totalDatangHariIni)} L`, note: `Tanggal: ${formatDate(data.serverDate)}` },
    { icon: "📤", label: "Oli Terpakai Hari Ini", value: `${formatNumber(kpi.totalTerpakaiHariIni)} L`, note: "Akumulasi pemakaian harian" },
    { icon: "⚠️", label: "Kondisi Oli Kritis", value: `${kpi.totalItemKritis || 0} Item`, note: "Saldo ≤ Min Stok Alert", critical: true }
  ];

  document.getElementById("kpiGrid").innerHTML = cards.map(card => `
    <article class="kpi-card${card.critical ? " kpi-critical" : ""}">
      <span class="kpi-icon">${card.icon}</span>
      <div class="kpi-content">
        <div class="kpi-label">${card.label}</div>
        <strong class="kpi-value">${card.value}</strong>
        <small>${card.note}</small>
      </div>
    </article>
  `).join("");
}

function renderCritical(items) {
  const tbody = document.getElementById("criticalBody");
  document.getElementById("criticalCount").textContent = `${items.length} Item Kritis`;
  if (!items.length) {
    tbody.innerHTML = '<tr><td class="empty-cell" colspan="8">Tidak ada oli dalam kondisi kritis.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.namaLokasi)}</strong><small class="subcode">${escapeHtml(item.kodeLokasi)}</small></td>
      <td>${escapeHtml(item.kodeOli)}</td>
      <td><strong>${escapeHtml(item.namaOli)}</strong></td>
      <td>${escapeHtml(item.kategori || "-")}</td>
      <td class="number-cell">${formatNumber(item.minAlert)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td class="number-cell danger-text">${formatNumber(item.saldoAkhir)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td class="number-cell danger-text">${formatNumber(item.selisihAlert)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td><span class="status-pill">KRITIS</span></td>
    </tr>
  `).join("");
}

function renderGlobalSummary(items) {
  const tbody = document.getElementById("globalSummaryBody");
  if (!items.length) {
    tbody.innerHTML = '<tr><td class="empty-cell" colspan="8">Belum ada data master oli.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${escapeHtml(item.kodeOli)}</td>
      <td><strong>${escapeHtml(item.namaOli)}</strong></td>
      <td>${escapeHtml(item.kategori || "-")}</td>
      <td class="number-cell">${formatNumber(item.stokAwal)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td class="number-cell incoming-text">+${formatNumber(item.datang)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td class="number-cell usage-text">-${formatNumber(item.terpakai)} ${escapeHtml(item.satuan || "Liter")}</td>
      <td class="number-cell"><strong>${formatNumber(item.saldoAkhir)} ${escapeHtml(item.satuan || "Liter")}</strong></td>
      <td>${item.lokasiKritis ? `<span class="status-pill">${item.lokasiKritis} Lokasi Kritis</span>` : '<span class="status-ok">Normal</span>'}</td>
    </tr>
  `).join("");
}

function renderLocations(searchTerm = "") {
  const grid = document.getElementById("locationGrid");
  const locations = dashboardData ? dashboardData.locationMonitoring || [] : [];
  const query = searchTerm.trim().toLowerCase();
  const filtered = locations.map(location => {
    const locationMatches = location.namaLokasi.toLowerCase().includes(query) ||
      location.kodeLokasi.toLowerCase().includes(query);
    return {
      ...location,
      items: !query || locationMatches ? location.items : location.items.filter(item =>
        `${item.namaOli} ${item.kodeOli} ${item.kategori || ""}`.toLowerCase().includes(query)
      )
    };
  }).filter(location => !query || location.namaLokasi.toLowerCase().includes(query) ||
    location.kodeLokasi.toLowerCase().includes(query) || location.items.length > 0);

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-cell">Lokasi atau oli tidak ditemukan.</div>';
    return;
  }

  grid.innerHTML = filtered.map(location => `
    <article class="location-card">
      <header class="location-card-header">
        <div>
          <h3>📍 ${escapeHtml(location.namaLokasi)} <small>(${escapeHtml(location.kodeLokasi)})</small></h3>
          <p>Total Saldo: <strong>${formatNumber(location.totalStok)} L</strong></p>
        </div>
        ${location.kritisCount ? `<span class="status-pill">${location.kritisCount} Kritis</span>` : '<span class="status-ok">Normal</span>'}
      </header>
      <div class="table-wrap location-table-wrap">
        <table class="location-table">
          <thead><tr><th>Nama Oli</th><th>Awal</th><th>Masuk</th><th>Pakai</th><th>Akhir</th><th>Status</th></tr></thead>
          <tbody>
            ${location.items.map(item => `
              <tr class="${item.isKritis ? "critical-row" : ""}">
                <td><strong>${escapeHtml(item.namaOli)}</strong><small class="subcode">${escapeHtml(item.kodeOli)}</small></td>
                <td>${formatNumber(item.stokAwal)}</td>
                <td class="incoming-text">${formatNumber(item.datang)}</td>
                <td class="usage-text">${formatNumber(item.terpakai)}</td>
                <td class="${item.isKritis ? "danger-text" : ""}"><strong>${formatNumber(item.saldoAkhir)}</strong></td>
                <td>${item.isKritis ? '<span class="status-pill">Kritis</span>' : '<span class="status-ok">Normal</span>'}</td>
              </tr>
            `).join("") || '<tr><td class="empty-cell" colspan="6">Tidak ada oli yang cocok.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `).join("");
}

function renderRecentTransactions(items) {
  const tbody = document.getElementById("recentBody");
  if (!items.length) {
    tbody.innerHTML = '<tr><td class="empty-cell" colspan="8">Belum ada transaksi.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${formatDate(item.tanggal)}</td>
      <td>${escapeHtml(item.mr || "-")}</td>
      <td>${escapeHtml(item.namaLokasi || item.kodeLokasi)}</td>
      <td>${escapeHtml(item.namaOli)}</td>
      <td>${escapeHtml(item.tipe)}</td>
      <td class="number-cell">${formatNumber(item.qty)} L</td>
      <td>${escapeHtml(item.noRef || "-")}</td>
      <td>${escapeHtml(item.inputBy || "-")}</td>
    </tr>
  `).join("");
}

function renderDashboard(data) {
  dashboardData = data;
  renderKpis(data);
  renderCritical(data.criticalItems || []);
  renderGlobalSummary(data.oilGlobalSummary || []);
  renderLocations(document.getElementById("locationSearch").value);
  renderRecentTransactions(data.recentTransactions || []);
  document.getElementById("updatedAt").textContent = `Data per ${formatDate(data.serverDate)}`;
}

async function loadDashboard() {
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  button.textContent = "Memuat...";
  setError("");
  try {
    const data = await requestMonitoringOli("getInitialData");
    renderDashboard(data);
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "↻ Refresh Data";
  }
}

document.getElementById("refreshButton").addEventListener("click", loadDashboard);
document.getElementById("locationSearch").addEventListener("input", event => renderLocations(event.target.value));
loadDashboard();
