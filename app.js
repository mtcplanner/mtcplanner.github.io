// ============================================================
// MAINTENANCE PLANNER PORTAL - JS ENGINE & API INTEGRATION
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbx7wa-CsHSAkHhmxcigi71Aq7X6QMATj6oNj9dde45mCJsIP5HPcEiFTt4WbC5aKjOf/exec";

let currentUser = null;
let modulesData = {};
let isSidebarVisible = true;

window.onload = function() {
  checkSession();
};

// API Fetch Helper (POST)
async function apiCall(actionName, payload = {}) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: actionName, ...payload })
    });
    return await response.json();
  } catch (error) {
    console.error("API Error:", error);
    showToast("Gagal terhubung ke Server API.", "error");
    return { success: false, message: "Koneksi terputus." };
  }
}

// === FLOATING TOAST NOTIFICATION (TOP RIGHT) ===
function showToast(message, type = "success", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-card toast-${type}`;
  
  const iconSymbol = type === "success" ? "✓" : "✕";
  const toastTitle = title || (type === "success" ? "Berhasil" : "Pemberitahuan");
  
  toast.innerHTML = `
    <div class="toast-icon">${iconSymbol}</div>
    <div class="toast-body">
      <div class="toast-title">${toastTitle}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

// === SESSION CHECK & LOGIN HANDLERS ===
function checkSession() {
  const userSession = sessionStorage.getItem('user');
  if (userSession) {
    try {
      currentUser = JSON.parse(userSession);
      showDashboard(currentUser);
    } catch (e) {
      sessionStorage.removeItem('user');
      showLogin();
    }
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('dashboardView').style.display = 'none';
}

function showDashboard(userData) {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashboardView').style.display = 'flex';
  
  const name = userData.nama || userData.username;
  
  if (document.getElementById('userProfileName')) document.getElementById('userProfileName').textContent = name;
  if (document.getElementById('udFullName')) document.getElementById('udFullName').textContent = name;
  if (document.getElementById('userAvatar')) document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
  
  const isDev = userData.level === 'Developer';
  if (document.getElementById('udRole')) document.getElementById('udRole').textContent = isDev ? 'System Developer' : 'Maintenance Planner';

  if (document.getElementById('systemEditMenu')) document.getElementById('systemEditMenu').style.display = isDev ? 'flex' : 'none';
  if (document.getElementById('registerUserMenu')) document.getElementById('registerUserMenu').style.display = isDev ? 'flex' : 'none';
  if (document.getElementById('deleteUserMenu')) document.getElementById('deleteUserMenu').style.display = isDev ? 'flex' : 'none';

  window._currentUser = userData;
  reloadModulesInitial();
}

async function handleLogin() {
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const btn = document.getElementById('btnLogin');
  const err = document.getElementById('loginError');

  if (!u || !p) {
    err.textContent = "Username dan password wajib diisi!";
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span>Memverifikasi...</span>';
  err.style.display = 'none';

  const res = await apiCall('loginUser', { username: u, password: p });
  btn.disabled = false;
  btn.innerHTML = '<span>MASUK SEKARANG</span>';

  if (res.success) {
    currentUser = { username: res.username, nama: res.nama, level: res.level || 'User' };
    sessionStorage.setItem('user', JSON.stringify(currentUser));
    showDashboard(currentUser);
    showToast("Selamat datang kembali di Portal Planner!", "success");
  } else {
    err.textContent = res.message || "Username atau password salah!";
    err.style.display = 'block';
  }
}

// === MODULE RENDERER ===
async function reloadModulesInitial() {
  const res = await apiCall('getModulesList');
  if (res.success) {
    modulesData = res;
    renderMenu(res);
    
    const lastViewStr = sessionStorage.getItem('lastView');
    if (lastViewStr) {
      const lastView = JSON.parse(lastViewStr);
      if (lastView.type === 'module') loadModule(lastView.id, lastView.url, lastView.name);
      else showHome();
    } else {
      showHome();
    }
  }
}

function renderMenu(config) {
  const list = document.getElementById('menuList');
  if (!list) return;
  list.innerHTML = '';

  const homeLi = document.createElement('li');
  homeLi.className = 'menu-item active';
  homeLi.innerHTML = '<span>🏠</span> Home';
  homeLi.onclick = function() { showHome(); setActiveMenu(this); };
  list.appendChild(homeLi);

  if (currentUser && currentUser.level && currentUser.level.toLowerCase() === 'viewer') return;

  if (config.dataEntry && config.dataEntry.years) {
    const groupLi = document.createElement('li');
    groupLi.innerHTML = `
      <div class="menu-group-header" onclick="toggleGroup(this)">
        <span>📂 ${config.dataEntry.name}</span>
        <span class="group-arrow">▶</span>
      </div>
      <div class="menu-group-content"></div>
    `;

    const contentDiv = groupLi.querySelector('.menu-group-content');
    const years = Object.keys(config.dataEntry.years).sort((a, b) => b - a);

    years.forEach(year => {
      const yearDiv = document.createElement('div');
      yearDiv.className = 'year-selector';
      yearDiv.innerHTML = `<span>📅 ${year}</span> <span class="group-arrow">▶</span>`;
      yearDiv.onclick = function(e) { e.stopPropagation(); toggleYearModules(this); };

      const modulesDiv = document.createElement('div');
      modulesDiv.className = 'year-modules';

      config.dataEntry.years[year].forEach(m => {
        const item = document.createElement('div');
        item.className = 'year-module-item';
        item.innerHTML = `<span>${m.icon}</span> ${m.name}`;
        item.onclick = function(e) {
          e.stopPropagation();
          loadModule(m.key, m.url, `${m.name} (${year})`);
          setActiveMenu(this);
        };
        modulesDiv.appendChild(item);
      });

      contentDiv.appendChild(yearDiv);
      contentDiv.appendChild(modulesDiv);
    });

    list.appendChild(groupLi);
  }

  if (config.standalone) {
    config.standalone.forEach(mod => {
      const li = document.createElement('li');
      li.className = 'menu-item';
      li.innerHTML = `<span>${mod.icon}</span> ${mod.name}`;
      li.onclick = function() { loadModule(mod.key, mod.url, mod.name); setActiveMenu(this); };
      list.appendChild(li);
    });
  }
}

function toggleGroup(header) {
  header.classList.toggle('expanded');
  const content = header.nextElementSibling;
  content.classList.toggle('open');
}

function toggleYearModules(yearEl) {
  yearEl.classList.toggle('expanded');
  const modulesDiv = yearEl.nextElementSibling;
  modulesDiv.classList.toggle('open');
}

function setActiveMenu(el) {
  document.querySelectorAll('.menu-item, .year-module-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
}

function loadModule(id, url, name) {
  if (!url || url.includes('URL_WEB_APP')) {
    showToast("Modul ini belum dikonfigurasi.", "error");
    return;
  }

  const role = currentUser ? (currentUser.level || 'User').toLowerCase() : 'user';
  const username = currentUser ? (currentUser.nama || currentUser.username) : 'Unknown';
  const separator = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${separator}role=${encodeURIComponent(role)}&user=${encodeURIComponent(username)}`;

  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('moduleFrame').src = finalUrl;

  sessionStorage.setItem('lastView', JSON.stringify({ type: 'module', id, url, name }));
}

function showHome() {
  document.getElementById('moduleFrame').src = '';
  document.getElementById('welcomeScreen').style.display = 'block';
  sessionStorage.setItem('lastView', JSON.stringify({ type: 'home' }));
  renderHomeCards();
}

function renderHomeCards() {
  const grid = document.getElementById('homeSubMenuGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (modulesData && modulesData.home && modulesData.home.length > 0) {
    modulesData.home.forEach(mod => {
      const card = document.createElement('div');
      card.className = 'home-card';
      card.innerHTML = `<div class="home-icon">${mod.icon || '📌'}</div><div class="home-title">${mod.name}</div>`;
      card.onclick = () => loadModule(mod.key, mod.url, mod.name);
      grid.appendChild(card);
    });
  } else {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:#94a3b8; font-size:12px; padding:20px;">Belum ada sub-menu home dikonfigurasi.</div>';
  }
}

function filterHomeCards(query) {
  const q = query.toLowerCase();
  const cards = document.querySelectorAll('.home-card');
  cards.forEach(card => {
    const title = card.querySelector('.home-title')?.textContent.toLowerCase() || '';
    if (title.includes(q)) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  if (window.innerWidth <= 768) {
    const isOpen = sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('show', isOpen);
  } else {
    isSidebarVisible = !isSidebarVisible;
    sidebar.classList.toggle('collapsed', !isSidebarVisible);
  }
}

function toggleUserDropdown(e) {
  e.stopPropagation();
  document.getElementById('userDropdown').classList.toggle('show');
}

document.addEventListener('click', () => {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.remove('show');
});

// === MODALS MANAGEMENT ===
function openModal(id) {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.remove('show');
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('show'), 10);

  if (id === 'deleteUserModal') loadDeleteUserList();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => modal.style.display = 'none', 200);
}

function openLogoutModal() { openModal('logoutModal'); }
function confirmLogout() {
  sessionStorage.clear();
  currentUser = null;
  closeModal('logoutModal');
  showLogin();
  showToast("Anda telah keluar dari akun.", "success");
}

async function submitForgotPassword() {
  const email = document.getElementById('fpEmail').value.trim();
  const msg = document.getElementById('fpMsg');
  if (!email) return showMsg(msg, 'Email wajib diisi!', false);

  const res = await apiCall('forgotPassword', { email });
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast(res.message, "success");
    setTimeout(() => closeModal('forgotPasswordModal'), 1800);
  }
}

async function submitChangePassword() {
  const oldPassword = document.getElementById('cpOldPass').value;
  const newPassword = document.getElementById('cpNewPass').value;
  const confirmP = document.getElementById('cpConfirmPass').value;
  const msg = document.getElementById('cpMsg');

  if (newPassword !== confirmP) return showMsg(msg, 'Konfirmasi password tidak cocok!', false);

  const res = await apiCall('changePassword', { username: currentUser.username, oldPassword, newPassword });
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast("Password berhasil diubah!", "success");
    setTimeout(() => closeModal('changePasswordModal'), 1500);
  }
}

async function submitSystemEdit() {
  const action = document.getElementById('seAction').value;
  const type = document.getElementById('seType').value;
  const tahun = document.getElementById('seYear').value.trim();
  const moduleSelect = document.getElementById('seModuleSelect').value;
  const moduleKeyInput = document.getElementById('seModuleKeyInput').value.trim();
  const moduleName = document.getElementById('seModuleName').value.trim();
  const newUrl = document.getElementById('seUrl').value.trim();
  const msg = document.getElementById('seMsg');

  const moduleKey = (type === 'dataEntry') ? moduleSelect : moduleKeyInput;
  const payload = { username: currentUser.username, tahun: type === 'dataEntry' ? tahun : type, moduleKey, moduleNameInput: moduleName, newUrl };

  const res = await apiCall(action === 'update' ? 'updateModuleUrl' : 'deleteModule', payload);
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast(res.message, "success");
    setTimeout(() => { closeModal('systemEditModal'); reloadModulesInitial(); }, 1500);
  }
}

async function submitRegisterUser() {
  const newUsername = document.getElementById('regUsername').value.trim();
  const newPassword = document.getElementById('regPassword').value.trim();
  const newNama = document.getElementById('regNama').value.trim();
  const newEmail = document.getElementById('regEmail').value.trim();
  const newLevel = document.getElementById('regLevel').value;
  const msg = document.getElementById('regMsg');

  const res = await apiCall('registerUser', { username: currentUser.username, newUsername, newPassword, newNama, newEmail, newLevel });
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast(`Akun ${newUsername} berhasil terdaftar.`, "success");
    setTimeout(() => closeModal('registerUserModal'), 1500);
  }
}

async function loadDeleteUserList() {
  const select = document.getElementById('delUserSelect');
  select.innerHTML = '<option value="">-- Memuat Akun... --</option>';
  const res = await apiCall('getUsersList', { username: currentUser.username });
  if (res.success && res.users) {
    select.innerHTML = '<option value="">-- Pilih Akun Target --</option>';
    res.users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.username;
      opt.textContent = `${u.nama} (${u.username}) [${u.level}]`;
      select.appendChild(opt);
    });
  }
}

async function submitDeleteUser() {
  const targetUsername = document.getElementById('delUserSelect').value;
  const msg = document.getElementById('delUserMsg');
  const res = await apiCall('deleteUser', { username: currentUser.username, targetUsername });
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast(res.message, "success");
    setTimeout(() => closeModal('deleteUserModal'), 1500);
  }
}

function showMsg(el, text, isSuccess) {
  el.textContent = text;
  el.className = `gm-msg ${isSuccess ? 'success' : 'error'}`;
}

function onSeActionChange() {
  const action = document.getElementById('seAction').value;
  const urlGroup = document.getElementById('seUrlGroup');
  const nameGroup = document.getElementById('seModuleNameGroup');
  const iconGroup = document.getElementById('seIconGroup');
  const btn = document.getElementById('seBtnSubmit');

  if (action === 'delete') {
    urlGroup.style.display = 'none';
    nameGroup.style.display = 'none';
    if (iconGroup) iconGroup.style.display = 'none';
    btn.textContent = 'Hapus Modul';
    btn.className = 'btn-danger';
  } else {
    urlGroup.style.display = 'block';
    btn.textContent = 'Simpan Modul';
    btn.className = 'btn-primary';
  }
  onSeTypeChange();
}

function onSeTypeChange() {
  const type = document.getElementById('seType').value;
  const action = document.getElementById('seAction').value;
  const yearGroup = document.getElementById('seYearGroup');
  const moduleSelect = document.getElementById('seModuleSelect');
  const moduleKeyInput = document.getElementById('seModuleKeyInput');
  const moduleNameGroup = document.getElementById('seModuleNameGroup');
  const iconGroup = document.getElementById('seIconGroup');

  if (type === 'dataEntry') {
    yearGroup.style.display = 'block';
    moduleSelect.style.display = 'block';
    moduleKeyInput.style.display = 'none';
    moduleNameGroup.style.display = 'none';
    if (iconGroup) iconGroup.style.display = 'none';
  } else {
    yearGroup.style.display = 'none';
    moduleSelect.style.display = 'none';
    moduleKeyInput.style.display = 'block';
    if (action === 'update') {
      moduleNameGroup.style.display = 'block';
      if (iconGroup) iconGroup.style.display = 'block';
    } else {
      moduleNameGroup.style.display = 'none';
      if (iconGroup) iconGroup.style.display = 'none';
    }
  }
}

async function submitSystemEdit() {
  const action = document.getElementById('seAction').value;
  const type = document.getElementById('seType').value;
  const tahun = document.getElementById('seYear').value.trim();
  const moduleSelect = document.getElementById('seModuleSelect').value;
  const moduleKeyInput = document.getElementById('seModuleKeyInput').value.trim();
  const moduleName = document.getElementById('seModuleName').value.trim();
  const icon = document.getElementById('seIcon')?.value.trim() || '';
  const newUrl = document.getElementById('seUrl').value.trim();
  const msg = document.getElementById('seMsg');

  const moduleKey = (type === 'dataEntry') ? moduleSelect : moduleKeyInput;
  const payload = { 
    username: currentUser.username, 
    tahun: type === 'dataEntry' ? tahun : type, 
    moduleKey, 
    moduleNameInput: moduleName, 
    icon: type !== 'dataEntry' ? icon : '', 
    newUrl 
  };

  const res = await apiCall(action === 'update' ? 'updateModuleUrl' : 'deleteModule', payload);
  showMsg(msg, res.message, res.success);
  if (res.success) {
    showToast(res.message, "success");
    setTimeout(() => { closeModal('systemEditModal'); reloadModulesInitial(); }, 1500);
  }
}
function openWebServerModal() {
  window.open('https://webserver-40px.onrender.com/', '_blank');
}
