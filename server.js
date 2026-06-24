const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { run, get, all, initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'meta-barber-secret';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function currentMonthRef() {
  return new Date().toISOString().slice(0, 7);
}

function isValidMonth(month) {
  return /^\d{4}-\d{2}$/.test(month || '');
}

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMonthInfo(monthRef) {
  const [year, month] = monthRef.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${monthRef}-01`;
  const monthEnd = `${monthRef}-${String(daysInMonth).padStart(2, '0')}`;
  const today = new Date();
  const currentRef = today.toISOString().slice(0, 7);

  let elapsedDays = daysInMonth;
  if (monthRef === currentRef) {
    elapsedDays = today.getDate();
  } else if (monthRef > currentRef) {
    elapsedDays = 0;
  }

  return {
    year,
    month,
    daysInMonth,
    monthStart,
    monthEnd,
    elapsedDays,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function findUserByIdentifier(identifier) {
  return get(
    `
      SELECT id, name, username, email, password_hash, role
      FROM users
      WHERE email = ? OR username = ?
      LIMIT 1
    `,
    [identifier, identifier]
  );
}

const authMiddleware = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Token não informado.' });
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
    return;
  }

  const user = await get(
    `
      SELECT id, name, username, email, role, created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [payload.id]
  );

  if (!user) {
    res.status(401).json({ error: 'Usuário não encontrado.' });
    return;
  }

  req.user = user;
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Acesso não autorizado.' });
      return;
    }
    next();
  };
}

function resolveTargetUserId(req) {
  if (req.user.role !== 'admin') {
    return req.user.id;
  }

  const requested =
    req.query.userId ||
    req.body.userId ||
    req.params.userId;

  return requested ? Number(requested) : req.user.id;
}

async function ensureTargetUserExists(userId) {
  return get(
    `
      SELECT id, name, username, email, role
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  );
}

async function buildDashboard(userId, monthRef) {
  const goal = (await get(
    `
      SELECT *
      FROM goals
      WHERE user_id = ? AND month_ref = ?
      LIMIT 1
    `,
    [userId, monthRef]
  )) || {
    extra_goal: 0,
    product_goal: 0,
    client_goal: 0,
    ticket_goal: 0,
    other_goal: 0,
    month_ref: monthRef,
  };

  const salesSummary = (await get(
    `
      SELECT
        COALESCE(SUM(value), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN type = 'extra' THEN value ELSE 0 END), 0) AS extra_revenue,
        COALESCE(SUM(CASE WHEN type = 'produto' THEN value ELSE 0 END), 0) AS product_revenue,
        COUNT(*) AS sale_count
      FROM sales
      WHERE user_id = ? AND substr(sale_date, 1, 7) = ?
    `,
    [userId, monthRef]
  )) || {
    total_revenue: 0,
    extra_revenue: 0,
    product_revenue: 0,
    sale_count: 0,
  };

  const clientSummary = (await get(
    `
      SELECT
        COALESCE(SUM(quantity), 0) AS total_clients,
        COALESCE(SUM(CASE WHEN type = 'Clube' THEN quantity ELSE 0 END), 0) AS club_clients,
        COALESCE(SUM(CASE WHEN type = 'Avulso' THEN quantity ELSE 0 END), 0) AS walkin_clients
      FROM clients
      WHERE user_id = ? AND substr(client_date, 1, 7) = ?
    `,
    [userId, monthRef]
  )) || {
    total_clients: 0,
    club_clients: 0,
    walkin_clients: 0,
  };

  const recentSales = await all(
    `
      SELECT id, type, value, sale_date, created_at
      FROM sales
      WHERE user_id = ?
      ORDER BY sale_date DESC, id DESC
      LIMIT 8
    `,
    [userId]
  );

  const recentClients = await all(
    `
      SELECT id, type, quantity, client_date, created_at
      FROM clients
      WHERE user_id = ?
      ORDER BY client_date DESC, id DESC
      LIMIT 8
    `,
    [userId]
  );

  const totalGoal =
    toNumber(goal.extra_goal) +
    toNumber(goal.product_goal) +
    toNumber(goal.other_goal);

  const progressPercent = totalGoal > 0
    ? Math.min((toNumber(salesSummary.total_revenue) / totalGoal) * 100, 100)
    : 0;

  return {
    monthRef,
    goals: {
      monthRef,
      extraGoal: toNumber(goal.extra_goal),
      productGoal: toNumber(goal.product_goal),
      clientGoal: toInteger(goal.client_goal),
      ticketGoal: toNumber(goal.ticket_goal),
      otherGoal: toNumber(goal.other_goal),
      totalGoal,
    },
    metrics: {
      metaTotalMes: totalGoal,
      extrasVendidos: toNumber(salesSummary.extra_revenue),
      produtosVendidos: toNumber(salesSummary.product_revenue),
      faturamentoTotal: toNumber(salesSummary.total_revenue),
      totalClientes: toInteger(clientSummary.total_clients),
      totalVendas: toInteger(salesSummary.sale_count),
      clientesClube: toInteger(clientSummary.club_clients),
      clientesAvulso: toInteger(clientSummary.walkin_clients),
      progressoMetas: progressPercent,
    },
    recentSales,
    recentClients,
  };
}

async function buildDailyReport(userId, monthRef) {
  const user = await ensureTargetUserExists(userId);
  const monthInfo = getMonthInfo(monthRef);

  const goals = (await get(
    `
      SELECT *
      FROM goals
      WHERE user_id = ? AND month_ref = ?
      LIMIT 1
    `,
    [userId, monthRef]
  )) || {
    extra_goal: 0,
    product_goal: 0,
    client_goal: 0,
    ticket_goal: 0,
    other_goal: 0,
  };

  const salesRows = await all(
    `
      SELECT sale_date, type, value
      FROM sales
      WHERE user_id = ? AND substr(sale_date, 1, 7) = ?
      ORDER BY sale_date ASC, id ASC
    `,
    [userId, monthRef]
  );

  const clientRows = await all(
    `
      SELECT client_date, type, quantity
      FROM clients
      WHERE user_id = ? AND substr(client_date, 1, 7) = ?
      ORDER BY client_date ASC, id ASC
    `,
    [userId, monthRef]
  );

  const salesByDay = new Map();
  for (const row of salesRows) {
    const day = row.sale_date.slice(-2);
    const current = salesByDay.get(day) || { extra: 0, produto: 0 };
    current[row.type] += toNumber(row.value);
    salesByDay.set(day, current);
  }

  const clientsByDay = new Map();
  for (const row of clientRows) {
    const day = row.client_date.slice(-2);
    const current = clientsByDay.get(day) || { total: 0, clube: 0, avulso: 0 };
    const quantity = toInteger(row.quantity);
    current.total += quantity;
    if (row.type === 'Clube') {
      current.clube += quantity;
    }
    if (row.type === 'Avulso') {
      current.avulso += quantity;
    }
    clientsByDay.set(day, current);
  }

  const rows = [];
  let totalGross = 0;
  let totalExtra = 0;
  let totalProduct = 0;
  let totalClients = 0;
  let totalClubClients = 0;
  let totalWalkinClients = 0;

  for (let day = 1; day <= monthInfo.daysInMonth; day += 1) {
    const dayKey = String(day).padStart(2, '0');
    const sale = salesByDay.get(dayKey) || { extra: 0, produto: 0 };
    const clients = clientsByDay.get(dayKey) || { total: 0, clube: 0, avulso: 0 };
    const gross = toNumber(sale.extra) + toNumber(sale.produto);
    const ticket = clients.total > 0 ? gross / clients.total : 0;

    totalGross += gross;
    totalExtra += toNumber(sale.extra);
    totalProduct += toNumber(sale.produto);
    totalClients += clients.total;
    totalClubClients += clients.clube;
    totalWalkinClients += clients.avulso;

    rows.push({
      day,
      bruto: gross,
      extra: toNumber(sale.extra),
      produto: toNumber(sale.produto),
      cliente: clients.total,
      clienteClube: clients.clube,
      clienteAvulso: clients.avulso,
      ticket,
    });
  }

  const metaMensal =
    toNumber(goals.extra_goal) +
    toNumber(goals.product_goal) +
    toNumber(goals.other_goal);
  const metaDiaria = monthInfo.daysInMonth > 0 ? metaMensal / monthInfo.daysInMonth : 0;
  const faltam = Math.max(metaMensal - totalGross, 0);
  const diasRestantes = Math.max(monthInfo.daysInMonth - monthInfo.elapsedDays, 0);
  const metaDiariaAtualizada = diasRestantes > 0 ? faltam / diasRestantes : 0;
  const faturamentoEsperado = metaDiaria * monthInfo.elapsedDays;
  const diferencaMetaDiaria = totalGross - faturamentoEsperado;
  const ticketMedio = totalClients > 0 ? totalGross / totalClients : 0;

  return {
    barber: {
      id: user.id,
      name: user.name,
      username: user.username,
    },
    monthRef,
    daysInMonth: monthInfo.daysInMonth,
    elapsedDays: monthInfo.elapsedDays,
    rows,
    totals: {
      bruto: totalGross,
      extra: totalExtra,
      produto: totalProduct,
      cliente: totalClients,
      clienteClube: totalClubClients,
      clienteAvulso: totalWalkinClients,
      ticket: ticketMedio,
    },
    goals: {
      extra: toNumber(goals.extra_goal),
      produto: toNumber(goals.product_goal),
      cliente: toInteger(goals.client_goal),
      ticket: toNumber(goals.ticket_goal),
      outros: toNumber(goals.other_goal),
      metaMensal,
      metaDiaria,
      faltam,
      extras: totalExtra,
      metaDiariaAtualizada,
      faturamentoEsperado,
      diferencaMetaDiaria,
    },
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    res.status(400).json({ error: 'Informe e-mail ou usuário, e também a senha.' });
    return;
  }

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    res.status(401).json({ error: 'Credenciais inválidas.' });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    res.status(401).json({ error: 'Credenciais inválidas.' });
    return;
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
}));

app.get('/api/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

app.get('/api/dashboard', authMiddleware, asyncHandler(async (req, res) => {
  const monthRef = isValidMonth(req.query.month) ? req.query.month : currentMonthRef();
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const dashboard = await buildDashboard(userId, monthRef);
  res.json({
    user: targetUser,
    ...dashboard,
  });
}));

app.get('/api/goals', authMiddleware, asyncHandler(async (req, res) => {
  const monthRef = isValidMonth(req.query.month) ? req.query.month : currentMonthRef();
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const row = await get(
    `
      SELECT id, user_id, month_ref, extra_goal, product_goal, client_goal, ticket_goal, other_goal
      FROM goals
      WHERE user_id = ? AND month_ref = ?
      LIMIT 1
    `,
    [userId, monthRef]
  );

  res.json({
    goal: row || {
      user_id: userId,
      month_ref: monthRef,
      extra_goal: 0,
      product_goal: 0,
      client_goal: 0,
      ticket_goal: 0,
      other_goal: 0,
    },
  });
}));

app.post('/api/goals', authMiddleware, asyncHandler(async (req, res) => {
  const monthRef = isValidMonth(req.body.monthRef) ? req.body.monthRef : currentMonthRef();
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const extraGoal = Math.max(toNumber(req.body.extraGoal), 0);
  const productGoal = Math.max(toNumber(req.body.productGoal), 0);
  const clientGoal = Math.max(toInteger(req.body.clientGoal), 0);
  const ticketGoal = Math.max(toNumber(req.body.ticketGoal), 0);
  const otherGoal = Math.max(toNumber(req.body.otherGoal), 0);

  await run(
    `
      INSERT INTO goals (user_id, month_ref, extra_goal, product_goal, client_goal, ticket_goal, other_goal, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, month_ref)
      DO UPDATE SET
        extra_goal = excluded.extra_goal,
        product_goal = excluded.product_goal,
        client_goal = excluded.client_goal,
        ticket_goal = excluded.ticket_goal,
        other_goal = excluded.other_goal,
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, monthRef, extraGoal, productGoal, clientGoal, ticketGoal, otherGoal]
  );

  res.json({ message: 'Metas salvas com sucesso.' });
}));

app.get('/api/sales', authMiddleware, asyncHandler(async (req, res) => {
  const userId = resolveTargetUserId(req);
  const limit = Math.min(Math.max(toInteger(req.query.limit) || 20, 1), 100);
  const monthRef = isValidMonth(req.query.month) ? req.query.month : null;
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  let sql = `
    SELECT id, user_id, type, value, sale_date, created_at
    FROM sales
    WHERE user_id = ?
  `;
  const params = [userId];

  if (monthRef) {
    sql += ' AND substr(sale_date, 1, 7) = ?';
    params.push(monthRef);
  }

  sql += ' ORDER BY sale_date DESC, id DESC LIMIT ?';
  params.push(limit);

  const rows = await all(sql, params);
  res.json({ sales: rows });
}));

app.post('/api/sales', authMiddleware, asyncHandler(async (req, res) => {
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const type = req.body.type;
  const value = toNumber(req.body.value);
  const saleDate = req.body.saleDate;

  if (!['extra', 'produto'].includes(type)) {
    res.status(400).json({ error: 'Tipo de venda inválido.' });
    return;
  }

  if (value <= 0) {
    res.status(400).json({ error: 'O valor deve ser maior que zero.' });
    return;
  }

  if (!isValidDate(saleDate)) {
    res.status(400).json({ error: 'Data de venda inválida.' });
    return;
  }

  await run(
    `
      INSERT INTO sales (user_id, type, value, sale_date)
      VALUES (?, ?, ?, ?)
    `,
    [userId, type, value, saleDate]
  );

  res.json({ message: 'Venda registrada com sucesso.' });
}));

app.delete('/api/sales/:id', authMiddleware, asyncHandler(async (req, res) => {
  const sale = await get(
    `
      SELECT id, user_id
      FROM sales
      WHERE id = ?
      LIMIT 1
    `,
    [req.params.id]
  );

  if (!sale) {
    res.status(404).json({ error: 'Venda não encontrada.' });
    return;
  }

  if (req.user.role !== 'admin' && sale.user_id !== req.user.id) {
    res.status(403).json({ error: 'Acesso não autorizado.' });
    return;
  }

  await run('DELETE FROM sales WHERE id = ?', [req.params.id]);
  res.json({ message: 'Venda excluída com sucesso.' });
}));

app.get('/api/clients', authMiddleware, asyncHandler(async (req, res) => {
  const userId = resolveTargetUserId(req);
  const limit = Math.min(Math.max(toInteger(req.query.limit) || 20, 1), 100);
  const monthRef = isValidMonth(req.query.month) ? req.query.month : null;
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  let sql = `
    SELECT id, user_id, type, quantity, client_date, created_at
    FROM clients
    WHERE user_id = ?
  `;
  const params = [userId];

  if (monthRef) {
    sql += ' AND substr(client_date, 1, 7) = ?';
    params.push(monthRef);
  }

  sql += ' ORDER BY client_date DESC, id DESC LIMIT ?';
  params.push(limit);

  const rows = await all(sql, params);
  res.json({ clients: rows });
}));

app.post('/api/clients', authMiddleware, asyncHandler(async (req, res) => {
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const type = req.body.type;
  const quantity = toInteger(req.body.quantity);
  const clientDate = req.body.clientDate;

  if (!['Clube', 'Avulso'].includes(type)) {
    res.status(400).json({ error: 'Tipo de cliente inválido.' });
    return;
  }

  if (quantity <= 0) {
    res.status(400).json({ error: 'A quantidade deve ser maior que zero.' });
    return;
  }

  if (!isValidDate(clientDate)) {
    res.status(400).json({ error: 'Data de cliente inválida.' });
    return;
  }

  await run(
    `
      INSERT INTO clients (user_id, type, quantity, client_date)
      VALUES (?, ?, ?, ?)
    `,
    [userId, type, quantity, clientDate]
  );

  res.json({ message: 'Cliente registrado com sucesso.' });
}));

app.delete('/api/clients/:id', authMiddleware, asyncHandler(async (req, res) => {
  const client = await get(
    `
      SELECT id, user_id
      FROM clients
      WHERE id = ?
      LIMIT 1
    `,
    [req.params.id]
  );

  if (!client) {
    res.status(404).json({ error: 'Registro de cliente não encontrado.' });
    return;
  }

  if (req.user.role !== 'admin' && client.user_id !== req.user.id) {
    res.status(403).json({ error: 'Acesso não autorizado.' });
    return;
  }

  await run('DELETE FROM clients WHERE id = ?', [req.params.id]);
  res.json({ message: 'Registro de cliente excluído com sucesso.' });
}));

app.get('/api/reports/daily', authMiddleware, asyncHandler(async (req, res) => {
  const monthRef = isValidMonth(req.query.month) ? req.query.month : currentMonthRef();
  const userId = resolveTargetUserId(req);
  const targetUser = await ensureTargetUserExists(userId);

  if (!targetUser) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const report = await buildDailyReport(userId, monthRef);
  res.json(report);
}));

app.get('/api/users', authMiddleware, requireRole('admin'), asyncHandler(async (req, res) => {
  const rows = await all(
    `
      SELECT id, name, username, email, role, created_at
      FROM users
      ORDER BY role ASC, name ASC
    `
  );
  res.json({ users: rows });
}));

app.post('/api/users', authMiddleware, requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, username, email, password, role } = req.body;

  if (!name || !username || !email || !password) {
    res.status(400).json({ error: 'Preencha nome, usuário, e-mail e senha.' });
    return;
  }

  if (!['admin', 'barber'].includes(role)) {
    res.status(400).json({ error: 'Perfil inválido.' });
    return;
  }

  const existing = await get(
    `
      SELECT id
      FROM users
      WHERE email = ? OR username = ?
      LIMIT 1
    `,
    [email, username]
  );

  if (existing) {
    res.status(400).json({ error: 'Já existe um usuário com esse e-mail ou usuário.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await run(
    `
      INSERT INTO users (name, username, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `,
    [name, username, email, passwordHash, role]
  );

  res.json({ message: 'Usuário criado com sucesso.' });
}));

app.delete('/api/users/:id', authMiddleware, requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);

  if (userId === req.user.id) {
    res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    return;
  }

  const target = await get(
    `
      SELECT id
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  );

  if (!target) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  await run('DELETE FROM users WHERE id = ?', [userId]);
  res.json({ message: 'Usuário excluído com sucesso.' });
}));

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: 'Ocorreu um erro interno no servidor.',
  });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Meta Barber disponível em http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Falha ao iniciar o banco de dados:', error);
    process.exit(1);
  });
