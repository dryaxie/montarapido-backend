const router = require('express').Router();
const { body } = require('express-validator');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticate, isAdmin, isAdminGeral } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../services/email.service');
const { sendWhatsApp } = require('../services/whatsapp.service');
const logger = require('../config/logger');

// ══════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════
router.get('/dashboard', authenticate, isAdmin, async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalClients, totalMontadores, totalServices, pendingServices,
         completedThisMonth, revenueThisMonth, topMontadores, recentServices] = await Promise.all([
    prisma.user.count({ where: { role: 'CLIENTE', isActive: true } }),
    prisma.montadorProfile.count({ where: { isApproved: true } }),
    prisma.service.count(),
    prisma.service.count({ where: { status: 'PENDING' } }),
    prisma.service.count({ where: { status: 'COMPLETED', completedAt: { gte: startOfMonth } } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'RELEASED', releasedAt: { gte: startOfMonth } } }),
    prisma.montadorProfile.findMany({
      orderBy: { totalServices: 'desc' }, take: 5,
      select: { id: true, totalServices: true, totalEarnings: true, averageRating: true, user: { select: { name: true, profilePhoto: true } } },
    }),
    prisma.service.findMany({
      orderBy: { createdAt: 'desc' }, take: 10,
      select: {
        id: true, type: true, status: true, estimatedValue: true, city: true, createdAt: true,
        client: { select: { name: true } },
        montador: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);

  // Serviços por mês (últimos 6)
  const servicesByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const count = await prisma.service.count({ where: { createdAt: { gte: d, lte: end } } });
    servicesByMonth.push({ month: d.toLocaleDateString('pt-BR', { month: 'short' }), count });
  }

  res.json({
    success: true,
    data: {
      stats: {
        totalClients, totalMontadores, totalServices, pendingServices,
        completedThisMonth, revenueThisMonth: revenueThisMonth._sum.amount || 0,
      },
      servicesByMonth, topMontadores, recentServices,
    },
  });
});

// ══════════════════════════════════════════════════════════
//  USUÁRIOS
// ══════════════════════════════════════════════════════════
router.get('/users', authenticate, isAdmin, async (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;
  const where = {};
  if (role) where.role = role;
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true, city: true, state: true },
      skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
    }),
    prisma.user.count({ where }),
  ]);

  res.json({ success: true, data: { users, pagination: { total, page: parseInt(page), limit: parseInt(limit) } } });
});

router.patch('/users/:id/toggle-active', authenticate, isAdmin, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { isActive: !user.isActive } });
  logger.info(`[Admin] Usuário ${user.email} ${updated.isActive ? 'ativado' : 'desativado'} por ${req.user.email}`);
  res.json({ success: true, message: `Usuário ${updated.isActive ? 'ativado' : 'desativado'}.`, data: { user: updated } });
});

// ══════════════════════════════════════════════════════════
//  MONTADORES — Aprovar/Reprovar
// ══════════════════════════════════════════════════════════
router.get('/montadores/pending', authenticate, isAdmin, async (req, res) => {
  const montadores = await prisma.montadorProfile.findMany({
    where: { isApproved: false },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
      specialties: true, portfolioPhotos: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: { montadores } });
});

router.patch('/montadores/:id/approve', authenticate, isAdmin, async (req, res) => {
  const montador = await prisma.montadorProfile.update({
    where: { id: req.params.id },
    data: { isApproved: true, approvedAt: new Date() },
    include: { user: true },
  });

  sendEmail({ to: montador.user.email, ...emailTemplates.montadorApproved(montador.user.name) });
  if (montador.user.phone) sendWhatsApp(montador.user.phone, `✅ *MontaRapido*\n\nOlá, ${montador.user.name}! Seu cadastro foi *aprovado*! Acesse o app e comece a receber pedidos. 🔧`);

  logger.info(`[Admin] Montador aprovado: ${montador.user.email} por ${req.user.email}`);
  res.json({ success: true, message: 'Montador aprovado!', data: { montador } });
});

router.patch('/montadores/:id/reject', authenticate, isAdmin, async (req, res) => {
  const { reason } = req.body;
  const montador = await prisma.montadorProfile.update({
    where: { id: req.params.id },
    data: { isApproved: false },
    include: { user: true },
  });
  if (montador.user.phone) sendWhatsApp(montador.user.phone, `❌ *MontaRapido*\n\nOlá, ${montador.user.name}. Seu cadastro não foi aprovado.\n\nMotivo: ${reason || 'Dados incompletos.'}\n\nSe tiver dúvidas, entre em contato com nosso suporte.`);
  res.json({ success: true, message: 'Montador reprovado.' });
});

// Adicionar montador manualmente
router.post('/montadores', authenticate, isAdmin, [
  body('name').notEmpty(), body('email').isEmail(),
  body('phone').notEmpty(), body('cpf').notEmpty(),
], async (req, res) => {
  const { name, email, phone, cpf, city, state, transport = 'CAR', experienceYears = 1 } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ success: false, message: 'E-mail já cadastrado.' });

  const tempPass = `Monta${Math.random().toString(36).slice(2, 8)}!`;
  const hashed = await bcrypt.hash(tempPass, 12);

  const user = await prisma.user.create({
    data: {
      name, email, password: hashed, phone, city, state, role: 'MONTADOR',
      montadorProfile: {
        create: {
          cpf, address: '', cep: '',
          transport, experienceYears, birthDate: new Date('1990-01-01'),
          isApproved: true, approvedAt: new Date(),
        },
      },
    },
  });

  sendEmail({ to: email, subject: 'Bem-vindo ao MontaRapido! 🔧', html: `<p>Olá ${name}! Sua conta foi criada. Senha temporária: <strong>${tempPass}</strong>. Altere após o login.</p>` });
  logger.info(`[Admin] Montador adicionado manualmente: ${email} por ${req.user.email}`);
  res.status(201).json({ success: true, message: 'Montador adicionado com sucesso!', data: { email, tempPassword: tempPass } });
});

// ══════════════════════════════════════════════════════════
//  TABELA DE PREÇOS
// ══════════════════════════════════════════════════════════
router.get('/price-table', authenticate, isAdmin, async (req, res) => {
  const prices = await prisma.priceTable.findMany({ orderBy: { category: 'asc' } });
  res.json({ success: true, data: { prices } });
});

router.put('/price-table/:category', authenticate, isAdmin, async (req, res) => {
  const { minPrice, maxPrice, notes, isActive, imageUrl } = req.body;
  const price = await prisma.priceTable.upsert({
    where: { category: req.params.category },
    update: { minPrice: parseFloat(minPrice), maxPrice: parseFloat(maxPrice), notes, isActive, imageUrl, updatedBy: req.user.id },
    create: { category: req.params.category, minPrice: parseFloat(minPrice), maxPrice: parseFloat(maxPrice), notes, isActive: true, updatedBy: req.user.id },
  });
  logger.info(`[Admin] Preço atualizado: ${req.params.category} por ${req.user.email}`);
  res.json({ success: true, message: 'Preço atualizado!', data: { price } });
});

// ══════════════════════════════════════════════════════════
//  CONFIGURAÇÕES DO SISTEMA
// ══════════════════════════════════════════════════════════
router.get('/config', authenticate, isAdmin, async (req, res) => {
  const configs = await prisma.systemConfig.findMany();
  const map = configs.reduce((acc, c) => ({ ...acc, [c.key]: c.value }), {});
  res.json({ success: true, data: { config: map } });
});

router.put('/config/:key', authenticate, isAdmin, async (req, res) => {
  const { value } = req.body;
  const config = await prisma.systemConfig.upsert({
    where: { key: req.params.key },
    update: { value, updatedBy: req.user.id },
    create: { key: req.params.key, value, updatedBy: req.user.id },
  });
  logger.info(`[Admin] Config atualizada: ${req.params.key}=${value} por ${req.user.email}`);
  res.json({ success: true, message: 'Configuração salva!', data: { config } });
});

// ══════════════════════════════════════════════════════════
//  ADMINISTRADORES (somente Admin Geral)
// ══════════════════════════════════════════════════════════
router.get('/admins', authenticate, isAdminGeral, async (req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'ADMIN_GERAL'] } },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, adminProfile: true },
  });
  res.json({ success: true, data: { admins } });
});

router.post('/admins', authenticate, isAdminGeral, [
  body('name').notEmpty(), body('email').isEmail(),
  body('password').isLength({ min: 8 }),
], async (req, res) => {
  const { name, email, password, whatsapp } = req.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ success: false, message: 'E-mail já cadastrado.' });

  const hashed = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: {
      name, email, password: hashed, role: 'ADMIN', isVerified: true, emailVerifiedAt: new Date(),
      adminProfile: { create: { whatsapp, createdBy: req.user.id } },
    },
  });
  logger.info(`[Admin] Novo admin criado: ${email} por ${req.user.email}`);
  res.status(201).json({ success: true, message: 'Admin criado!', data: { admin: { id: admin.id, name, email } } });
});

router.delete('/admins/:id', authenticate, isAdminGeral, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ success: false, message: 'Você não pode remover a si mesmo.' });
  const admin = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!admin || !['ADMIN','ADMIN_GERAL'].includes(admin.role)) return res.status(404).json({ success: false, message: 'Admin não encontrado.' });
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  logger.info(`[Admin] Admin removido: ${admin.email} por ${req.user.email}`);
  res.json({ success: true, message: 'Admin removido.' });
});

// ══════════════════════════════════════════════════════════
//  RELATÓRIOS
// ══════════════════════════════════════════════════════════
router.get('/reports/summary', authenticate, isAdmin, async (req, res) => {
  const { startDate, endDate } = req.query;
  const where = {};
  if (startDate) where.createdAt = { gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const [services, revenue, byStatus, byCity] = await Promise.all([
    prisma.service.count({ where }),
    prisma.payment.aggregate({ _sum: { amount: true, platformFee: true, montadorAmount: true }, where: { createdAt: where.createdAt, status: { in: ['HELD','RELEASED'] } } }),
    prisma.service.groupBy({ by: ['status'], where, _count: { id: true } }),
    prisma.service.groupBy({ by: ['city'], where, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 }),
  ]);

  res.json({
    success: true,
    data: {
      totalServices: services,
      revenue: { total: revenue._sum.amount || 0, platform: revenue._sum.platformFee || 0, montadores: revenue._sum.montadorAmount || 0 },
      byStatus: byStatus.reduce((acc, s) => ({ ...acc, [s.status]: s._count.id }), {}),
      topCities: byCity.map(c => ({ city: c.city, count: c._count.id })),
    },
  });
});

module.exports = router;
