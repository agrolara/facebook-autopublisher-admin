document.addEventListener('DOMContentLoaded', () => {
  let authToken = localStorage.getItem('admin_token') || null;
  let allLicenses = [];

  // Elementos DOM - Auth
  const loginScreen = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const loginForm = document.getElementById('loginForm');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const loginError = document.getElementById('loginError');
  const btnLogout = document.getElementById('btnLogout');
  const btnRefresh = document.getElementById('btnRefresh');

  // Elementos DOM - Dashboard
  const statTotal = document.getElementById('statTotal');
  const statActive = document.getElementById('statActive');
  const statExpiring = document.getElementById('statExpiring');
  const statExpired = document.getElementById('statExpired');
  const searchInput = document.getElementById('searchInput');
  const licensesList = document.getElementById('licensesList');
  const listCountBadge = document.getElementById('listCountBadge');
  const emptyState = document.getElementById('emptyState');

  // Elementos DOM - Modales
  const createModal = document.getElementById('createModal');
  const btnOpenCreateModal = document.getElementById('btnOpenCreateModal');
  const createLicenseForm = document.getElementById('createLicenseForm');
  const createEmailInput = document.getElementById('createEmailInput');
  const createCustomKeyInput = document.getElementById('createCustomKeyInput');
  const createError = document.getElementById('createError');

  const whatsappModal = document.getElementById('whatsappModal');
  const whatsappMessageText = document.getElementById('whatsappMessageText');
  const btnCopyWhatsapp = document.getElementById('btnCopyWhatsapp');
  const toast = document.getElementById('toast');

  // ==========================================
  // 1. INICIALIZACIÓN
  // ==========================================
  if (authToken) {
    showDashboard();
    fetchLicenses();
  } else {
    showLogin();
  }

  function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
    adminPasswordInput.value = '';
    adminPasswordInput.focus();
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
  }

  // ==========================================
  // 2. AUTHENTICACIÓN
  // ==========================================
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = adminPasswordInput.value.trim();
    if (!password) return;

    loginError.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (data.success && data.token) {
        authToken = data.token;
        localStorage.setItem('admin_token', authToken);
        showDashboard();
        fetchLicenses();
        showToast('¡Bienvenido al Panel de Control!');
      } else {
        loginError.textContent = data.error || 'Contraseña incorrecta.';
        loginError.classList.remove('hidden');
      }
    } catch (err) {
      loginError.textContent = 'Error de conexión con el servidor.';
      loginError.classList.remove('hidden');
    }
  });

  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    authToken = null;
    showLogin();
  });

  btnRefresh.addEventListener('click', () => {
    fetchLicenses();
    showToast('Lista actualizada');
  });

  // ==========================================
  // 3. API & DATA FETCHING
  // ==========================================
  async function apiRequest(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    };

    const res = await fetch(endpoint, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    });

    if (res.status === 401) {
      localStorage.removeItem('admin_token');
      authToken = null;
      showLogin();
      throw new Error('Sesión expirada.');
    }

    return await res.json();
  }

  async function fetchLicenses() {
    try {
      const data = await apiRequest('/api/licenses');
      if (data.success) {
        allLicenses = data.licenses || [];
        updateStats(data.stats);
        renderLicenses(allLicenses);
      }
    } catch (err) {
      console.error('[App] Error al obtener licencias:', err);
    }
  }

  function updateStats(stats) {
    if (!stats) return;
    statTotal.textContent = stats.total || 0;
    statActive.textContent = stats.active || 0;
    statExpiring.textContent = stats.expiringSoon || 0;
    statExpired.textContent = stats.expired || 0;
  }

  // ==========================================
  // 4. RENDERIZADO DE TARJETAS DE LICENCIA
  // ==========================================
  function renderLicenses(licenses) {
    licensesList.innerHTML = '';
    listCountBadge.textContent = `${licenses.length} clientes`;

    if (licenses.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    licenses.forEach(lic => {
      const card = document.createElement('div');
      card.className = 'lic-card';

      let badgeClass = 'badge-active';
      let badgeText = `🟢 Activa (${lic.daysRemaining}d)`;

      if (lic.status === 'suspended') {
        badgeClass = 'badge-suspended';
        badgeText = '⏸ Pausada';
      } else if (lic.isExpired) {
        badgeClass = 'badge-expired';
        badgeText = '🔴 Expirada';
      } else if (lic.daysRemaining <= 5) {
        badgeClass = 'badge-warning';
        badgeText = `🟡 Vence en ${lic.daysRemaining}d`;
      }

      const expiryFormatted = lic.expires_at ? new Date(lic.expires_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin límite';
      const hwidLabel = lic.hwid ? '💻 PC Vinculada' : '⏳ Sin vincular (Listo)';

      card.innerHTML = `
        <div class="lic-card-header">
          <span class="lic-email">${escapeHtml(lic.email)}</span>
          <span class="status-badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="lic-key-box">
          <span>${escapeHtml(lic.license_key)}</span>
          <button class="btn-copy btn-copy-key" data-key="${escapeHtml(lic.license_key)}" title="Copiar clave">📋</button>
        </div>

        <div class="lic-meta-row">
          <span>Vence: <strong>${expiryFormatted}</strong></span>
          <span>${hwidLabel}</span>
        </div>

        <div class="lic-actions-grid">
          <button class="btn-action-sm btn-renew" data-id="${lic.id}" data-email="${escapeHtml(lic.email)}">
            ⚡ +30 Días (Renovar)
          </button>
          <button class="btn-action-sm btn-whatsapp" data-id="${lic.id}">
            📲 WhatsApp
          </button>
          <button class="btn-action-sm btn-reset-hwid" data-id="${lic.id}" title="Permite que el cliente active su licencia en una PC nueva">
            🔄 Reset PC
          </button>
          <button class="btn-action-sm btn-toggle-status" data-id="${lic.id}" data-status="${lic.status}">
            ${lic.status === 'active' ? '⏸ Pausar' : '▶ Activar'}
          </button>
          <button class="btn-action-sm btn-delete" data-id="${lic.id}" data-email="${escapeHtml(lic.email)}" style="color:#f87171;">
            🗑 Eliminar
          </button>
        </div>
      `;

      licensesList.appendChild(card);
    });

    attachCardEvents();
  }

  function attachCardEvents() {
    // Copiar Clave
    document.querySelectorAll('.btn-copy-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = btn.getAttribute('data-key');
        navigator.clipboard.writeText(key);
        showToast('Clave copiada al portapapeles');
      });
    });

    // Renovar +30 Días
    document.querySelectorAll('.btn-renew').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const email = btn.getAttribute('data-email');
        if (!confirm(`¿Renovar 30 días adicionales para ${email}?`)) return;

        btn.disabled = true;
        try {
          const res = await apiRequest('/api/licenses/renew', {
            method: 'POST',
            body: JSON.stringify({ id, days: 30 })
          });
          if (res.success) {
            showToast('✅ Licencia renovada por +30 días.');
            fetchLicenses();
          }
        } catch (err) {
          showToast('Error al renovar licencia');
        }
      });
    });

    // Desvincular PC (Reset HWID)
    document.querySelectorAll('.btn-reset-hwid').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('¿Desvincular la PC actual para que el cliente pueda activarla en un nuevo equipo?')) return;

        try {
          const res = await apiRequest('/api/licenses/reset-hwid', {
            method: 'POST',
            body: JSON.stringify({ id })
          });
          if (res.success) {
            showToast('PC desvinculada exitosamente.');
            fetchLicenses();
          }
        } catch (err) {
          showToast('Error al desvincular equipo');
        }
      });
    });

    // Mensaje WhatsApp
    document.querySelectorAll('.btn-whatsapp').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const lic = allLicenses.find(l => l.id === id);
        if (!lic) return;

        const message = `¡Hola! Gracias por tu suscripción a *Facebook AutoPublisher Pro* 🚀\n\n` +
          `1️⃣ Descarga el instalador del programa aquí:\n👉 https://drive.google.com/tu-link-de-descarga\n\n` +
          `2️⃣ Abre el archivo e ingresa tus datos de activación:\n` +
          `📧 *Correo:* ${lic.email}\n` +
          `🔑 *Clave de Licencia:* ${lic.license_key}\n\n` +
          `Tu membresía estará activa durante ${lic.daysRemaining} días. ¡Cualquier duda quedo a tu disposición!`;

        whatsappMessageText.value = message;
        openModal('whatsappModal');
      });
    });

    // Alternar Estado
    document.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const currentStatus = btn.getAttribute('data-status');
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

        try {
          const res = await apiRequest('/api/licenses/toggle-status', {
            method: 'POST',
            body: JSON.stringify({ id, status: newStatus })
          });
          if (res.success) {
            showToast(newStatus === 'active' ? 'Licencia reactivada' : 'Licencia pausada');
            fetchLicenses();
          }
        } catch (err) {
          showToast('Error al cambiar estado');
        }
      });
    });

    // Eliminar Licencia
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const email = btn.getAttribute('data-email');
        if (!confirm(`¿Eliminar definitivamente la licencia de ${email}? Esta acción no se puede deshacer.`)) return;

        try {
          const res = await apiRequest(`/api/licenses/${id}`, { method: 'DELETE' });
          if (res.success) {
            showToast('Licencia eliminada');
            fetchLicenses();
          }
        } catch (err) {
          showToast('Error al eliminar');
        }
      });
    });
  }

  // ==========================================
  // 5. CREACIÓN DE LICENCIAS
  // ==========================================
  btnOpenCreateModal.addEventListener('click', () => {
    createEmailInput.value = '';
    createCustomKeyInput.value = '';
    createError.classList.add('hidden');
    openModal('createModal');
  });

  createLicenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = createEmailInput.value.trim();
    const duration = document.querySelector('input[name="createDuration"]:checked').value;
    const customKey = createCustomKeyInput.value.trim();

    if (!email) return;
    createError.classList.add('hidden');

    try {
      const res = await apiRequest('/api/licenses/create', {
        method: 'POST',
        body: JSON.stringify({ email, days: duration, customKey })
      });

      if (res.success && res.license) {
        closeModal('createModal');
        showToast(`Licencia creada para ${email}`);
        await fetchLicenses();

        // Abrir modal de WhatsApp automáticamente con los datos del nuevo cliente
        const lic = res.license;
        const message = `¡Hola! Gracias por tu suscripción a *Facebook AutoPublisher Pro* 🚀\n\n` +
          `1️⃣ Descarga el instalador del programa aquí:\n👉 https://drive.google.com/tu-link-de-descarga\n\n` +
          `2️⃣ Abre el archivo e ingresa tus datos de activación:\n` +
          `📧 *Correo:* ${lic.email}\n` +
          `🔑 *Clave de Licencia:* ${lic.license_key}\n\n` +
          `Tu membresía estará activa por ${duration} días. ¡Cualquier duda quedo a tu disposición!`;

        whatsappMessageText.value = message;
        openModal('whatsappModal');
      } else {
        createError.textContent = res.error || 'Error creando licencia.';
        createError.classList.remove('hidden');
      }
    } catch (err) {
      createError.textContent = err.message || 'Error al conectar con la base de datos.';
      createError.classList.remove('hidden');
    }
  });

  // Copiar WhatsApp
  btnCopyWhatsapp.addEventListener('click', () => {
    whatsappMessageText.select();
    navigator.clipboard.writeText(whatsappMessageText.value);
    showToast('¡Mensaje copiado! Listo para pegar en WhatsApp');
  });

  // ==========================================
  // 6. BUSCADOR EN TIEMPO REAL
  // ==========================================
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderLicenses(allLicenses);
      return;
    }

    const filtered = allLicenses.filter(l =>
      (l.email && l.email.toLowerCase().includes(q)) ||
      (l.license_key && l.license_key.toLowerCase().includes(q))
    );
    renderLicenses(filtered);
  });

  // ==========================================
  // 7. UTILS & MODALS
  // ==========================================
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      closeModal(modalId);
    });
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
