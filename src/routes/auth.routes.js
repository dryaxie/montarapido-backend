const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../services/email.service');
const { notifyAdminNewRegistration } = require('../services/notification.service');
const logger = require('../config/logger');

const generateTokens = (userId) => ({
  accessToken: jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  refreshToken: jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }),
});

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// ── POST /api/auth/register/cliente ───────────────────────
router.post('/register/cliente', [
  body('name').trim().notEmpty().withMessage('Nome obrigatório.'),
  body('email').isEmail().normalizeEmail().withMessage('E-mail inválido.'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter mínimo 6 caracteres.'),
  body('phone').optional().isMobilePhone('pt-BR'),
  body('city').optional().trim(),
], validate, async (req, res) => {
  const { name, email, password, phone, city, state } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ success: false, message: 'E-mail já cadastrado.' });

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, password: hashed, phone, city, state, role: 'CLIENTE' },
  });

  const { accessToken, refreshToken } = generateTokens(user.id);
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });

  // Notificações assíncronas
  sendEmail({ to: email, ...emailTemplates.welcomeClient(name) });
  notifyAdminNewRegistration(user, 'cliente');

  logger.info(`[Auth] Novo cliente: ${email}`);
  res.status(201).json({
    success: true,
    message: 'Conta criada com sucesso!',
    data: { accessToken, refreshToken, user: { id: user.id, name, email, role: 'CLIENTE' } },
  });
});

// ── POST /api/auth/register/montador ──────────────────────
router.post('/register/montador', [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').notEmpty(),
  body('cpf').notEmpty().withMessage('CPF obrigatório.'),
  body('birthDate').isISO8601().withMessage('Data de nascimento inválida.'),
  body('address').notEmpty(),
  body('cep').notEmpty(),
  body('transport').isIn(['FOOT','MOTO','CAR','VAN','TRUCK']),
  body('experienceYears').isInt({ min: 0 }),
  body('specialties').isArray({ min: 1 }),
], validate, async (req, res) => {
  const { name, email, password, phone, cpf, birthDate, address, cep, neighborhood, transport,
          experienceYears, bio, pixKey, pixBank, serviceRadius, serviceRegions, specialties,
          availability, city, state } = req.body;

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { montadorProfile: { cpf } }] } });
  if (existing) return res.status(409).json({ success: false, message: 'E-mail ou CPF já cadastrado.' });

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name, email, password: hashed, phone, role: 'MONTADOR', city, state,
      montadorProfile: {
        create: {
          cpf, birthDate: new Date(birthDate), address, cep, neighborhood,
          transport, experienceYears: parseInt(experienceYears), bio,
          pixKey, pixBank,
          serviceRadius: parseInt(serviceRadius) || 30,
          serviceRegions: serviceRegions || [],
          specialties: { create: specialties.map(s => ({ category: s })) },
          availability: availability ? { create: availability } : undefined,
        },
      },
    },
    include: { montadorProfile: { select: { id: true } } },
  });

  // Montador precisa de aprovação — não gera token ainda
  notifyAdminNewRegistration(user, 'montador');
  logger.info(`[Auth] Novo montador: ${email} — aguardando aprovação`);

  res.status(201).json({
    success: true,
    message: 'Cadastro enviado! Aguarde a aprovação em até 24 horas.',
  });
});

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { montadorProfile: { select: { id: true, isApproved: true, isAvailable: true } } },
  });

  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
  }
  if (!user.isActive) return res.status(403).json({ success: false, message: 'Conta desativada.' });
  if (user.role === 'MONTADOR' && !user.montadorProfile?.isApproved) {
    return res.status(403).json({ success: false, message: 'Seu cadastro está aguardando aprovação.', code: 'PENDING_APPROVAL' });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  await prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });

  logger.info(`[Auth] Login: ${email} (${user.role})`);
  res.json({
    success: true,
    data: {
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role,
              profilePhoto: user.profilePhoto, city: user.city,
              montadorProfile: user.montadorProfile || null },
    },
  });
});

// ── POST /api/auth/refresh ─────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token não fornecido.' });
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const stored = await prisma.refreshToken.findFirst({
      where: { token: refreshToken, userId: decoded.id, expiresAt: { gt: new Date() } },
    });
    if (!stored) return res.status(401).json({ success: false, message: 'Refresh token inválido ou expirado.' });

    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.id);
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { token: newRefresh, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });
  } catch {
    res.status(401).json({ success: false, message: 'Refresh token inválido.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────
router.post('/forgot-password', [body('email').isEmail().normalizeEmail()], validate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  // Responde OK mesmo se não encontrou (segurança)
  if (user) {
    const token = uuidv4();
    await prisma.passwordReset.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    sendEmail({ to: user.email, ...emailTemplates.resetPassword(user.name, resetUrl) });
  }
  res.json({ success: true, message: 'Se o e-mail existir, você receberá o link em breve.' });
});

// ── POST /api/auth/reset-password ─────────────────────────
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 6 }),
], validate, async (req, res) => {
  const { token, password } = req.body;
  const reset = await prisma.passwordReset.findFirst({
    where: { token, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!reset) return res.status(400).json({ success: false, message: 'Token inválido ou expirado.' });

  const hashed = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: reset.userId }, data: { password: hashed } });
  await prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
  await prisma.refreshToken.deleteMany({ where: { userId: reset.userId } });

  res.json({ success: true, message: 'Senha redefinida com sucesso!' });
});

// ── POST /api/auth/logout ──────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  res.json({ success: true, message: 'Logout realizado.' });
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      city: true, state: true, profilePhoto: true, createdAt: true,
      montadorProfile: {
        include: { specialties: true, availability: true, portfolioPhotos: { take: 6 } }
      },
    },
  });
  res.json({ success: true, data: { user } });
});

module.exports = router;
