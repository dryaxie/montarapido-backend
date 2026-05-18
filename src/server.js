require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./config/logger');
const prisma = require('./config/prisma');

// ── Rotas ───────────────────────────────────────────────────
const authRoutes          = require('./routes/auth.routes');
const servicesRoutes      = require('./routes/services.routes');
const montadoresRoutes    = require('./routes/montadores.routes');
const paymentsRoutes      = require('./routes/payments.routes');
const adminRoutes         = require('./routes/admin.routes');
const reviewsRoutes       = require('./routes/reviews.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════
//  MIDDLEWARES GLOBAIS
// ══════════════════════════════════════════════════════════
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // para servir imagens
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logger HTTP
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Arquivos estáticos (uploads)
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

// ── Rate Limiting ──────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { success: false, message: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// ══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true, status: 'healthy', timestamp: new Date().toISOString(),
      version: '1.0.0', environment: process.env.NODE_ENV,
      database: 'connected',
    });
  } catch {
    res.status(503).json({ success: false, status: 'unhealthy', database: 'disconnected' });
  }
});

// ══════════════════════════════════════════════════════════
//  ROTAS DA API
// ══════════════════════════════════════════════════════════
app.use('/api/auth',          authRoutes);
app.use('/api/services',      servicesRoutes);
app.use('/api/montadores',    montadoresRoutes);
app.use('/api/payments',      paymentsRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/reviews',       reviewsRoutes);
app.use('/api/notifications', notificationsRoutes);

// ── Tabela de preços pública (para usuários logados) ───────
app.get('/api/prices', async (req, res) => {
  const prices = await prisma.priceTable.findMany({ where: { isActive: true }, orderBy: { category: 'asc' } });
  res.json({ success: true, data: { prices } });
});

// ── Documentação rápida das rotas ─────────────────────────
app.get('/api', (req, res) => {
  res.json({
    success: true,
    name: 'MontaRapido API',
    version: '1.0.0',
    docs: 'https://api.montarapido.com.br/api',
    endpoints: {
      auth:          '/api/auth',
      services:      '/api/services',
      montadores:    '/api/montadores',
      payments:      '/api/payments',
      admin:         '/api/admin',
      reviews:       '/api/reviews',
      notifications: '/api/notifications',
      prices:        '/api/prices',
    },
    routes: {
      'POST /api/auth/register/cliente':     'Cadastrar cliente',
      'POST /api/auth/register/montador':    'Cadastrar montador',
      'POST /api/auth/login':                'Login',
      'POST /api/auth/refresh':              'Renovar token',
      'POST /api/auth/forgot-password':      'Recuperar senha',
      'POST /api/auth/reset-password':       'Redefinir senha',
      'GET  /api/auth/me':                   'Perfil do usuário logado',
      'POST /api/services':                  'Criar serviço (cliente)',
      'GET  /api/services':                  'Listar meus serviços',
      'GET  /api/services/available':        'Serviços disponíveis (montador)',
      'GET  /api/services/:id':              'Detalhes do serviço',
      'PATCH /api/services/:id/accept':      'Aceitar serviço (montador)',
      'PATCH /api/services/:id/confirm':     'Confirmar conclusão',
      'PATCH /api/services/:id/cancel':      'Cancelar serviço',
      'GET  /api/montadores':                'Buscar montadores (logado)',
      'GET  /api/montadores/:id':            'Perfil do montador',
      'POST /api/payments/webhook':          'Webhook Mercado Pago',
      'GET  /api/admin/dashboard':           'Dashboard admin',
      'GET  /api/admin/montadores/pending':  'Montadores aguardando aprovação',
      'PATCH /api/admin/montadores/:id/approve': 'Aprovar montador',
      'GET  /api/admin/price-table':         'Tabela de preços',
      'PUT  /api/admin/price-table/:cat':    'Atualizar preço',
      'GET  /api/admin/config':              'Configurações do sistema',
      'PUT  /api/admin/config/:key':         'Atualizar configuração (ex: AI_ENABLED)',
      'GET  /api/admin/admins':              'Listar admins (Admin Geral)',
      'POST /api/admin/admins':              'Criar admin (Admin Geral)',
      'GET  /api/admin/reports/summary':     'Relatório financeiro',
    },
  });
});

// ══════════════════════════════════════════════════════════
//  HANDLER DE ERROS GLOBAL
// ══════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  logger.error(`[Error] ${req.method} ${req.path}:`, { message: err.message, stack: err.stack });

  if (err.code === 'P2002') { // Prisma unique constraint
    return res.status(409).json({ success: false, message: 'Registro duplicado. Verifique os dados.' });
  }
  if (err.code === 'P2025') { // Prisma record not found
    return res.status(404).json({ success: false, message: 'Registro não encontrado.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Erro interno do servidor. Tente novamente.'
    : err.message;

  res.status(status).json({ success: false, message });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Rota não encontrada: ${req.method} ${req.path}` });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
// Keep-alive para plano free do Render
const { startKeepAlive } = require('./utils/keepalive');

const start = async () => {
  try {
    await prisma.$connect();
    logger.info('✅ Banco de dados conectado');

    app.listen(PORT, () => {
      logger.info(`🚀 MontaRapido API rodando na porta ${PORT}`);
      logger.info(`📖 Documentação: http://localhost:${PORT}/api`);
      logger.info(`❤️  Health check: http://localhost:${PORT}/health`);
      logger.info(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      // Evita sleep no plano free do Render
      startKeepAlive(process.env.BACKEND_URL);
    });
  } catch (err) {
    logger.error('❌ Falha ao iniciar servidor:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  logger.info('SIGTERM recebido. Encerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});

start();

module.exports = app;
