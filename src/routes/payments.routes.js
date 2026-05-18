const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middleware/auth');
const { processWebhook } = require('../services/payment.service');
const logger = require('../config/logger');

// ── POST /api/payments/webhook — Mercado Pago ─────────────
router.post('/webhook', async (req, res) => {
  try {
    logger.info('[Webhook] MP recebido:', JSON.stringify(req.body));
    const result = await processWebhook(req.body);
    if (result?.action === 'payment_approved') {
      const { notifyMontadoresNewService } = require('../services/notification.service');
      await notifyMontadoresNewService(result.payment.service);
    }
    res.sendStatus(200);
  } catch (err) {
    logger.error('[Webhook] Erro:', err.message);
    res.sendStatus(200); // sempre 200 para o MP
  }
});

// ── GET /api/payments/:id ──────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { service: { select: { clientId: true, montadorId: true, type: true, estimatedValue: true } } },
  });

  if (!payment) return res.status(404).json({ success: false, message: 'Pagamento não encontrado.' });

  const isOwner = payment.service.clientId === req.user.id;
  const isAdminUser = ['ADMIN', 'ADMIN_GERAL'].includes(req.user.role);
  if (!isOwner && !isAdminUser) return res.status(403).json({ success: false, message: 'Sem permissão.' });

  res.json({ success: true, data: { payment } });
});

// ── PATCH /api/payments/:id/confirm-manual — Admin confirma manualmente ──
router.patch('/:serviceId/confirm-manual', authenticate, isAdmin, async (req, res) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.serviceId },
    include: { payment: true },
  });

  if (!service?.payment) return res.status(404).json({ success: false, message: 'Serviço ou pagamento não encontrado.' });
  if (service.payment.status === 'HELD') return res.status(409).json({ success: false, message: 'Pagamento já confirmado.' });

  await prisma.payment.update({
    where: { id: service.payment.id },
    data: { status: 'HELD', paidAt: new Date() },
  });

  // Notificar montadores
  const { notifyMontadoresNewService } = require('../services/notification.service');
  await notifyMontadoresNewService(service);

  logger.info(`[Payment] Confirmação manual pelo admin: ${service.payment.id}`);
  res.json({ success: true, message: 'Pagamento confirmado manualmente.' });
});

// ── GET /api/payments — Admin: listar todos ────────────────
router.get('/', authenticate, isAdmin, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const where = {};
  if (status) where.status = status;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { service: { select: { id: true, type: true, city: true, client: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.payment.count({ where }),
  ]);

  res.json({ success: true, data: { payments, pagination: { total, page: parseInt(page), limit: parseInt(limit) } } });
});

module.exports = router;
