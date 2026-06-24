const STORAGE_KEY = 'metaBarberAuth';

const state = {
  token: '',
  user: null,
  users: [],
  monthRef: '',
  selectedUserId: null,
};

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T00:00:00`));
}

function formatMonthLabel(monthRef) {
  if (!monthRef) {
    return '';
  }

  const [year, month] = monthRef.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

function showMessage(elementId, message, type = '') {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.textContent = message || '';
  element.className = `form-message ${type}`.trim();
}

function saveAuth(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

function getSelectedUserId() {
  if (state.user?.role !== 'admin') {
    return null;
  }

  const filter = document.getElementById('userFilter');
  return filter?.value || String(state.user.id);
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, value);
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
      if (!window.location.pathname.endsWith('/')) {
        window.location.href = '/';
      }
    }
    throw new Error(data.error || 'Não foi possível concluir a operação.');
  }

  return data;
}

function setDefaultDates() {
  const saleDate = document.querySelector('input[name="saleDate"]');
  const clientDate = document.querySelector('input[name="clientDate"]');

  if (saleDate) {
    saleDate.value = getTodayDate();
  }
  if (clientDate) {
    clientDate.value = getTodayDate();
  }
}

function setTopbarTitle(sectionId) {
  const titles = {
    dashboardSection: 'Painel principal',
    reportsSection: 'Relatórios',
    adminSection: 'Administração',
  };
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    pageTitle.textContent = titles[sectionId] || 'Meta Barber';
  }
}

function activateSection(sectionId) {
  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.toggle('active', section.id === sectionId);
  });

  document.querySelectorAll('.nav-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === sectionId);
  });

  setTopbarTitle(sectionId);
}

function renderEmptyRow(targetId, colSpan, text) {
  const tbody = document.getElementById(targetId);
  if (!tbody) {
    return;
  }

  tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-state">${text}</td></tr>`;
}

function renderSalesTable(sales) {
  const tbody = document.getElementById('salesTableBody');
  if (!tbody) {
    return;
  }

  if (!sales.length) {
    renderEmptyRow('salesTableBody', 4, 'Nenhuma venda registrada.');
    return;
  }

  tbody.innerHTML = sales
    .map((sale) => `
      <tr>
        <td><span class="pill ${sale.type}">${sale.type}</span></td>
        <td>${formatCurrency(sale.value)}</td>
        <td>${formatDate(sale.sale_date)}</td>
        <td><button class="btn btn-danger" data-delete-sale="${sale.id}">Excluir</button></td>
      </tr>
    `)
    .join('');
}

function renderClientsTable(clients) {
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) {
    return;
  }

  if (!clients.length) {
    renderEmptyRow('clientsTableBody', 4, 'Nenhum cliente registrado.');
    return;
  }

  tbody.innerHTML = clients
    .map((client) => `
      <tr>
        <td><span class="pill ${client.type}">${client.type}</span></td>
        <td>${client.quantity}</td>
        <td>${formatDate(client.client_date)}</td>
        <td><button class="btn btn-danger" data-delete-client="${client.id}">Excluir</button></td>
      </tr>
    `)
    .join('');
}

function renderUserOptions(users) {
  const wrap = document.getElementById('userFilterWrap');
  const select = document.getElementById('userFilter');

  if (!wrap || !select || state.user?.role !== 'admin') {
    return;
  }

  wrap.classList.remove('hidden');
  const currentValue = state.selectedUserId || String(state.user.id);

  select.innerHTML = users
    .map(
      (user) => `
        <option value="${user.id}" ${String(user.id) === String(currentValue) ? 'selected' : ''}>
          ${user.name} (${user.role === 'admin' ? 'Administrador' : 'Barbeiro'})
        </option>
      `
    )
    .join('');

  state.selectedUserId = select.value;
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) {
    return;
  }

  if (!users.length) {
    renderEmptyRow('usersTableBody', 4, 'Nenhum usuário cadastrado.');
    return;
  }

  tbody.innerHTML = users
    .map((user) => `
      <tr>
        <td>${user.name}</td>
        <td>${user.username}</td>
        <td><span class="pill ${user.role}">${user.role === 'admin' ? 'Administrador' : 'Barbeiro'}</span></td>
        <td>
          ${
            Number(user.id) === Number(state.user?.id)
              ? '<span class="empty-state">Conta atual</span>'
              : `<button class="btn btn-danger" data-delete-user="${user.id}">Excluir</button>`
          }
        </td>
      </tr>
    `)
    .join('');
}

function fillGoalForm(goals) {
  const form = document.getElementById('goalsForm');
  if (!form) {
    return;
  }

  form.extraGoal.value = goals.extraGoal ?? goals.extra_goal ?? 0;
  form.productGoal.value = goals.productGoal ?? goals.product_goal ?? 0;
  form.clientGoal.value = goals.clientGoal ?? goals.client_goal ?? 0;
  form.ticketGoal.value = goals.ticketGoal ?? goals.ticket_goal ?? 0;
  form.otherGoal.value = goals.otherGoal ?? goals.other_goal ?? 0;
}

function fillMetrics(metrics, goals) {
  document.getElementById('metricMetaTotal').textContent = formatCurrency(goals.totalGoal);
  document.getElementById('metricExtras').textContent = formatCurrency(metrics.extrasVendidos);
  document.getElementById('metricProdutos').textContent = formatCurrency(metrics.produtosVendidos);
  document.getElementById('metricFaturamento').textContent = formatCurrency(metrics.faturamentoTotal);
  document.getElementById('metricProgresso').textContent = `${Math.round(metrics.progressoMetas)}%`;
  document.getElementById('progressFill').style.width = `${Math.min(metrics.progressoMetas, 100)}%`;
}

function renderReport(report) {
  const summary = document.getElementById('reportSummary');
  const body = document.getElementById('reportTableBody');
  const barberName = document.getElementById('reportBarberName');
  const monthLabel = document.getElementById('reportMonthLabel');
  const metaInfo = document.getElementById('reportMetaInfo');

  barberName.textContent = report.barber.name;
  monthLabel.textContent = `Mês de referência: ${formatMonthLabel(report.monthRef)}`;

  summary.innerHTML = `
    <article class="stat-card card">
      <span>Total do mês</span>
      <strong>${formatCurrency(report.totals.bruto)}</strong>
    </article>
    <article class="stat-card card">
      <span>Meta mensal</span>
      <strong>${formatCurrency(report.goals.metaMensal)}</strong>
    </article>
    <article class="stat-card card">
      <span>Meta diária</span>
      <strong>${formatCurrency(report.goals.metaDiaria)}</strong>
    </article>
    <article class="stat-card card">
      <span>Faltam para a meta</span>
      <strong>${formatCurrency(report.goals.faltam)}</strong>
    </article>
    <article class="stat-card card">
      <span>Clientes por tipo</span>
      <strong>${report.totals.clienteClube} Clube / ${report.totals.clienteAvulso} Avulso</strong>
    </article>
  `;

  metaInfo.innerHTML = `
    <span>Extras: ${formatCurrency(report.goals.extra)}</span>
    <span>Produtos: ${formatCurrency(report.goals.produto)}</span>
    <span>Clientes: ${report.goals.cliente}</span>
    <span>Total Clube: ${report.totals.clienteClube}</span>
    <span>Total Avulso: ${report.totals.clienteAvulso}</span>
    <span>Ticket meta: ${formatCurrency(report.goals.ticket)}</span>
    <span>Outros: ${formatCurrency(report.goals.outros)}</span>
    <span>Meta diária atualizada: ${formatCurrency(report.goals.metaDiariaAtualizada)}</span>
    <span>Esperado até agora: ${formatCurrency(report.goals.faturamentoEsperado)}</span>
    <span>Diferença da meta diária: ${formatCurrency(report.goals.diferencaMetaDiaria)}</span>
  `;

  body.innerHTML = report.rows
    .map((row) => `
      <tr>
        <td>${String(row.day).padStart(2, '0')}</td>
        <td>${formatCurrency(row.bruto)}</td>
        <td>${formatCurrency(row.extra)}</td>
        <td>${formatCurrency(row.produto)}</td>
        <td>${row.cliente}</td>
        <td>${row.clienteClube}</td>
        <td>${row.clienteAvulso}</td>
        <td>${formatCurrency(row.ticket)}</td>
      </tr>
    `)
    .join('');

  body.innerHTML += `
    <tr>
      <td><strong>Total</strong></td>
      <td><strong>${formatCurrency(report.totals.bruto)}</strong></td>
      <td><strong>${formatCurrency(report.totals.extra)}</strong></td>
      <td><strong>${formatCurrency(report.totals.produto)}</strong></td>
      <td><strong>${report.totals.cliente}</strong></td>
      <td><strong>${report.totals.clienteClube}</strong></td>
      <td><strong>${report.totals.clienteAvulso}</strong></td>
      <td><strong>${formatCurrency(report.totals.ticket)}</strong></td>
    </tr>
  `;
}

async function loadUsers() {
  if (state.user?.role !== 'admin') {
    return;
  }

  const data = await apiFetch('/api/users');
  state.users = data.users;

  if (!state.selectedUserId) {
    state.selectedUserId = String(state.user.id);
  }

  renderUserOptions(state.users);
  renderUsersTable(state.users);
}

async function loadDashboard() {
  const userId = getSelectedUserId();
  const query = buildQuery({
    month: state.monthRef,
    userId,
  });
  const data = await apiFetch(`/api/dashboard${query}`);

  fillGoalForm(data.goals);
  fillMetrics(data.metrics, data.goals);
  renderSalesTable(data.recentSales || []);
  renderClientsTable(data.recentClients || []);

  const sidebarUser = document.getElementById('sidebarUser');
  if (sidebarUser) {
    sidebarUser.textContent = `${state.user.name} • ${state.user.role === 'admin' ? 'Administrador' : 'Barbeiro'}`;
  }
}

async function loadReport() {
  const userId = getSelectedUserId();
  const query = buildQuery({
    month: state.monthRef,
    userId,
  });
  const report = await apiFetch(`/api/reports/daily${query}`);
  renderReport(report);
}

async function refreshData() {
  await loadDashboard();
  await loadReport();
}

async function initLoginPage() {
  const auth = getAuth();
  if (auth.token) {
    window.location.href = '/app';
    return;
  }

  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('loginMessage', 'Validando acesso...');

    try {
      const payload = {
        identifier: form.identifier.value.trim(),
        password: form.password.value,
      };

      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      saveAuth(data);
      window.location.href = '/app';
    } catch (error) {
      showMessage('loginMessage', error.message, 'error');
    }
  });
}

function applyRoleVisibility() {
  document.querySelectorAll('[data-role="admin"]').forEach((element) => {
    if (state.user?.role !== 'admin') {
      element.classList.add('hidden');
    }
  });

  if (state.user?.role !== 'admin') {
    const adminSection = document.getElementById('adminSection');
    if (adminSection) {
      adminSection.remove();
    }
  }
}

async function initAppPage() {
  const auth = getAuth();
  if (!auth.token) {
    window.location.href = '/';
    return;
  }

  state.token = auth.token;
  state.user = auth.user;
  state.monthRef = getCurrentMonth();

  document.getElementById('monthRef').value = state.monthRef;
  setDefaultDates();

  try {
    const me = await apiFetch('/api/auth/me');
    state.user = me.user;
    saveAuth({ token: state.token, user: state.user });
    applyRoleVisibility();

    if (state.user.role === 'admin') {
      await loadUsers();
    }

    await refreshData();
  } catch (error) {
    showMessage('goalsMessage', error.message, 'error');
    return;
  }

  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => activateSection(button.dataset.section));
  });

  document.getElementById('monthRef').addEventListener('change', async (event) => {
    state.monthRef = event.target.value || getCurrentMonth();
    await refreshData();
  });

  const userFilter = document.getElementById('userFilter');
  if (userFilter) {
    userFilter.addEventListener('change', async (event) => {
      state.selectedUserId = event.target.value;
      await refreshData();
    });
  }

  document.getElementById('logoutButton').addEventListener('click', () => {
    clearAuth();
    window.location.href = '/';
  });

  document.getElementById('goalsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showMessage('goalsMessage', 'Salvando metas...');

    try {
      await apiFetch('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          monthRef: state.monthRef,
          extraGoal: form.extraGoal.value,
          productGoal: form.productGoal.value,
          clientGoal: form.clientGoal.value,
          ticketGoal: form.ticketGoal.value,
          otherGoal: form.otherGoal.value,
          userId: getSelectedUserId(),
        }),
      });

      showMessage('goalsMessage', 'Metas salvas com sucesso.', 'success');
      await refreshData();
    } catch (error) {
      showMessage('goalsMessage', error.message, 'error');
    }
  });

  document.getElementById('saleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showMessage('saleMessage', 'Registrando venda...');

    try {
      await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type.value,
          value: form.value.value,
          saleDate: form.saleDate.value,
          userId: getSelectedUserId(),
        }),
      });

      form.reset();
      form.type.value = 'extra';
      form.saleDate.value = getTodayDate();
      showMessage('saleMessage', 'Venda registrada com sucesso.', 'success');
      await refreshData();
    } catch (error) {
      showMessage('saleMessage', error.message, 'error');
    }
  });

  document.getElementById('clientForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showMessage('clientMessage', 'Registrando cliente...');

    try {
      await apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type.value,
          quantity: form.quantity.value,
          clientDate: form.clientDate.value,
          userId: getSelectedUserId(),
        }),
      });

      form.reset();
      form.type.value = 'Clube';
      form.clientDate.value = getTodayDate();
      showMessage('clientMessage', 'Cliente registrado com sucesso.', 'success');
      await refreshData();
    } catch (error) {
      showMessage('clientMessage', error.message, 'error');
    }
  });

  document.body.addEventListener('click', async (event) => {
    const saleButton = event.target.closest('[data-delete-sale]');
    if (saleButton) {
      if (!window.confirm('Deseja excluir esta venda?')) {
        return;
      }
      await apiFetch(`/api/sales/${saleButton.dataset.deleteSale}`, { method: 'DELETE' });
      await refreshData();
    }

    const clientButton = event.target.closest('[data-delete-client]');
    if (clientButton) {
      if (!window.confirm('Deseja excluir este registro de cliente?')) {
        return;
      }
      await apiFetch(`/api/clients/${clientButton.dataset.deleteClient}`, { method: 'DELETE' });
      await refreshData();
    }

    const userButton = event.target.closest('[data-delete-user]');
    if (userButton) {
      if (!window.confirm('Deseja excluir este usuário?')) {
        return;
      }
      await apiFetch(`/api/users/${userButton.dataset.deleteUser}`, { method: 'DELETE' });
      await loadUsers();
      await refreshData();
    }
  });

  const userForm = document.getElementById('userForm');
  if (userForm) {
    userForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      showMessage('userMessage', 'Criando usuário...');

      try {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name.value.trim(),
            username: form.username.value.trim(),
            email: form.email.value.trim(),
            role: form.role.value,
            password: form.password.value,
          }),
        });

        form.reset();
        showMessage('userMessage', 'Usuário criado com sucesso.', 'success');
        await loadUsers();
      } catch (error) {
        showMessage('userMessage', error.message, 'error');
      }
    });
  }

  document.getElementById('printReportButton').addEventListener('click', () => {
    activateSection('reportsSection');
    window.print();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('loginForm')) {
    initLoginPage();
  }

  if (document.querySelector('.app-shell')) {
    initAppPage();
  }
});
