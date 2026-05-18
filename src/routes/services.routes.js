const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isCliente, isMontador, isAdmin } = require('../middleware/auth');
const { uploadService, handleUploadError } = require('../middleware/upload');
const { notifyMontadoresNewService, createNotification } = require('../services/notification.service');
const { sendWhatsApp, templates } = require('../services/whatsapp.service');
const { createMPPayment } = require('../services/payment.service');
const logger = require('../config/logger');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

const SERVICE_SELECT = {
  id: true, type: true, description: true, status: true,
  address: true, city: true, state: true, cep: true,
  scheduledDate: true, scheduledTime: true,
  estimatedValue: true, finalValue: true, montadorValue: true,
  acceptedAt: true, completedAt: true, cancelledAt: true, cancelReason: true,
  aiUsed: true, createdAt: true,
  client: { select: { id: true, name: true, phone: true, profilePhoto: true } },
  montador: { select: { id: true, user: { select: { name: true, phone: true, profilePhoto: true } }, averageRating: true } },
  items: { include: { photos: true } },
  photos: true,
  payment: { select: { id: true, status: true, method: true, mpPixQrCode: true, mpPixCopyPaste: true, mpPreferenceId: true } },
  review: true,
  timeline: { orderBy: { createdAt: 'asc' } },
};

// ── POST /api/services — Criar serviço ────────────────────
router.post('/', authenticate, isCliente, [
  body('type').isIn(['MONTAGEM','DESMONTAGEM','MONTAGEM_DESMONTAGEM','REMONTAGEM']),
  body('description').trim().notEmpty(),
  body('address').notEmpty(), body('city').notEmpty(), body('state').notEmpty(),
  body('cep').notEmpty(), body('scheduledDate').isISO8601(),
  body('scheduledTime').matches(/^\d{2}:\d{2}$/),
  body('items').isArray({ min: 1 }),
  body('paymentMethod').isIn(['PIX_MERCADOPAGO','CARD_MERCADOPAGO','PIX_DIRECT']),
], validate, async (req, res) => {
  const { type, description, address, complement, neighborhood, city, state, cep,
          scheduledDate, scheduledTime, items, paymentMethod, useAI } = req.body;

  // Calcular valor estimado
  let estimatedValue = 0;
  const priceTable = await prisma.priceTable.findMany({ where: { isActive: true } });
  const aiConfig = await prisma.systemConfig.findUnique({ where: { key: 'AI_ENABLED' } });
  const aiEnabled = aiConfig?.value === 'true' && useAI;

  const processedItems = items.map(item => {
    const priceEntry = priceTable.find(p => p.category === item.category);
    const price = priceEntry ? (priceEntry.minPrice + priceEntry.maxPrice) / 2 : 80;
    estimatedValue += price * (item.quantity || 1);
    return { category: item.category, description: item.description, quantity: item.quantity || 1, estimatedValue: price };
  });

  const platformFee = estimatedValue * (parseInt(process.env.PLATFORM_FEE_PERCENT || '25') / 100);
  const montadorValue = estimatedValue - platformFee;

  // Criar serviço no banco
  const service = await prisma.service.create({
    data: {
      clientId: req.user.id, type, description,
      address, complement, neighborhood, city, state, cep,
      scheduledDate: new Date(scheduledDate), scheduledTime,
      estimatedValue, platformFee, montadorValue,
      aiUsed: aiEnabled,
      items: { create: processedItems },
      timeline: { create: { status: 'PENDING', description: 'Serviço criado e aguardando pagamento.', createdBy: req.user.id } },
    },
    include: { items: true, client: { select: { id: true, name: true, email: true, phone: true } } },
  });

  // Criar pagamento
  let paymentData = {};
  if (paymentMethod !== 'PIX_DIRECT') {
    const mpMethod = paymentMethod === 'PIX_MERCADOPAGO' ? 'pix' : 'card';
    paymentData = await createMPPayment(service, req.user, mpMethod);
  }

  const payment = await prisma.payment.create({
    data: {
      serviceId: service.id,
      montadorId: '', // será preenchido quando aceitar
      method: paymentMethod,
      amount: estimatedValue, platformFee, montadorAmount: montadorValue,
      pixKey: paymentMethod === 'PIX_DIRECT' ? process.env.PIX_KEY_PLATFORM : undefined,
      ...paymentData,
    },
  });

  logger.info(`[Service] Novo serviço criado: ${service.id} | Cliente: ${req.user.email}`);
  res.status(201).json({ success: true, message: 'Serviço criado!', data: { service, payment } });
});

// ── GET /api/services — Listar serviços ───────────────────
router.get('/', authenticate, async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const where = {};

  if (req.user.role === 'CLIENTE')   where.clientId  = req.user.id;
  if (req.user.role === 'MONTADOR')  where.montador  = { userId: req.user.id };
  if (status) where.status = status;

  const [services, total] = await Promise.all([
    prisma.service.findMany({
      where, select: SERVICE_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.service.count({ where }),
  ]);

  res.json({ success: true, data: { services, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } } });
});

// ── GET /api/services/available — Para montadores ─────────
router.get('/available', authenticate, isMontador, async (req, res) => {
  const { city, category } = req.query;
  const montador = await prisma.montadorProfile.findUnique({
    where: { userId: req.user.id },
    select: { serviceRegions: true, specialties: true },
  });

  const where = {
    status: 'PENDING',
    montadorId: null,
    payment: { status: { in: ['PAID', 'HELD', 'PROCESSING'] } },
  };

  if (city) where.city = { contains: city, mode: 'insensitive' };
  else if (montador?.serviceRegions?.length) {
    where.city = { in: montador.serviceRegions };
  }

  const services = await prisma.service.findMany({
    where, select: SERVICE_SELECT,
    orderBy: { scheduledDate: 'asc' },
    take: 20,
  });

  res.json({ success: true, data: { services } });
});

// ── GET /api/services/:id ──────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    select: SERVICE_SELECT,
  });
  if (!service) return res.status(404).json({ success: false, message: 'Serviço não encontrado.' });

  // Verifica permissão
  const isOwner = service.client?.id === req.user.id;
  const isMontadorOfService = service.montador?.user && req.user.role === 'MONTADOR';
  const isAdminUser = ['ADMIN','ADMIN_GERAL'].includes(req.user.role);
  if (!isOwner && !isMontadorOfService && !isAdminUser) {
    return res.status(403).json({ success: false, message: 'Sem permissão.' });
  }

  res.json({ success: true, data: { service } });
});

// ── PATCH /api/services/:id/accept — Montador aceita ──────
router.patch('/:id/accept', authenticate, isMontador, async (req, res) => {
  const montador = await prisma.montadorProfile.findUnique({ where: { userId: req.user.id } });
  if (!montador?.isApproved) return res.status(403).json({ success: false, message: 'Perfil não aprovado.' });

  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: { client: true, payment: true },
  });

  if (!service) return res.status(404).json({ success: false, message: 'Serviço não encontrado.' });
  if (service.status !== 'PENDING') return res.status(409).json({ success: false, message: 'Serviço não está disponível.' });
  if (!service.payment || !['PAID','HELD'].includes(service.payment.status)) {
    return res.status(409).json({ success: false, message: 'Pagamento não confirmado.' });
  }

  const [updated] = await prisma.$transaction([
    prisma.service.update({
      where: { id: service.id },
      data: { montadorId: montador.id, status: 'ACCEPTED', acceptedAt: new Date(),
              timeline: { create: { status: 'ACCEPTED', description: `Montador ${req.user.name} aceitou o serviço.`, createdBy: req.user.id } } },
    }),
    prisma.payment.update({ where: { serviceId: service.id }, data: { montadorId: montador.id } }),
  ]);

  // Notificações
  await createNotification({
    userId: service.clientId, serviceId: service.id,
    type: 'SERVICE_ACCEPTED', title: '✅ Montador aceitou seu serviço!',
    message: `${req.user.name} aceitará seu pedido em ${new Date(service.scheduledDate).toLocaleDateString('pt-BR')} às ${service.scheduledTime}.`,
    sendWA: !!service.client.phone, waPhone: service.client.phone,
  });

  // WhatsApp com detalhes completos para o montador
  if (req.user.phone) {
    sendWhatsApp(req.user.phone, templates.montadorJobDetails({ ...service, montador: { user: req.user } }, req.user));
  }

  logger.info(`[Service] Aceito: ${service.id} | Montador: ${req.user.email}`);
  res.json({ success: true, message: 'Serviço aceito com sucesso!', data: { service: updated } });
});

// ── PATCH /api/services/:id/confirm — Dupla confirmação ───
router.patch('/:id/confirm', authenticate, async (req, res) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: { payment: true, client: true, montador: { include: { user: true } } },
  });

  if (!service || service.status !== 'ACCEPTED') {
    return res.status(400).json({ success: false, message: 'Serviço não está em andamento.' });
  }

  const isClientUser   = service.clientId === req.user.id;
  const isMontadorUser = service.montador?.userId === req.user.id;

  if (!isClientUser && !isMontadorUser) return res.status(403).json({ success: false, message: 'Sem permissão.' });

  const updateData = isClientUser
    ? { clientConfirmed: true, clientConfirmedAt: new Date() }
    : { montadorConfirmed: true, montadorConfirmedAt: new Date() };

  await prisma.payment.update({ where: { id: service.payment.id }, data: updateData });

  const updatedPayment = await prisma.payment.findUnique({ where: { id: service.payment.id } });

  // Se ambos confirmaram → conclui serviço e libera pagamento
  if (updatedPayment.clientConfirmed && updatedPayment.montadorConfirmed) {
    const { releasePayment } = require('../services/payment.service');
    await releasePayment(updatedPayment.id);
    await prisma.service.update({
      where: { id: service.id },
      data: { status: 'COMPLETED', completedAt: new Date(),
              timeline: { create: { status: 'COMPLETED', description: 'Serviço concluído. Pagamento liberado ao montador.', createdBy: req.user.id } } },
    });

    await prisma.montadorProfile.update({ where: { id: service.montador.id }, data: { totalServices: { increment: 1 } } });

    // Notificações de conclusão
    await createNotification({ userId: service.clientId, serviceId: service.id, type: 'SERVICE_COMPLETED', title: '🎉 Serviço concluído!', message: 'O serviço foi concluído com sucesso. Por favor, avalie o montador!' });
    await createNotification({ userId: service.montador.userId, serviceId: service.id, type: 'PAYMENT_RELEASED', title: '💰 Pagamento liberado!', message: `R$ ${service.payment.montadorAmount.toFixed(2)} foram liberados para sua conta.`, sendWA: !!service.montador.user.phone, waPhone: service.montador.user.phone });

    logger.info(`[Service] Concluído: ${service.id}`);
    return res.json({ success: true, message: 'Serviço concluído e pagamento liberado!', data: { bothConfirmed: true } });
  }

  res.json({ success: true, message: `Confirmação registrada. Aguardando a ${isClientUser?'montador':'cliente'} confirmar.`, data: { bothConfirmed: false } });
});

// ── PATCH /api/services/:id/cancel ────────────────────────
router.patch('/:id/cancel', authenticate, async (req, res) => {
  const { reason } = req.body;
  const service = await prisma.service.findUnique({ where: { id: req.params.id }, include: { payment: true } });

  if (!service) return res.status(404).json({ success: false, message: 'Serviço não encontrado.' });
  if (['COMPLETED','CANCELLED'].includes(service.status)) {
    return res.status(409).json({ success: false, message: 'Serviço já concluído ou cancelado.' });
  }

  const isOwner = service.clientId === req.user.id;
  const isAdminUser = ['ADMIN','ADMIN_GERAL'].includes(req.user.role);
  if (!isOwner && !isAdminUser) return res.status(403).json({ success: false, message: 'Sem permissão.' });

  await prisma.service.update({
    where: { id: service.id },
    data: {
      status: 'CANCELLED', cancelledAt: new Date(),
      cancelReason: reason, cancelledBy: req.user.id,
      timeline: { create: { status: 'CANCELLED', description: reason || 'Serviço cancelado.', createdBy: req.user.id } },
    },
  });

  if (service.payment?.status === 'HELD') {
    await prisma.payment.update({ where: { serviceId: service.id }, data: { status: 'REFUNDED', refundedAt: new Date() } });
  }

  // Se montador cancelou, notifica outros montadores
  if (service.montadorId && req.user.role === 'MONTADOR') {
    const freshService = await prisma.service.findUnique({ where: { id: service.id } });
    notifyMontadoresNewService(freshService);
  }

  logger.info(`[Service] Cancelado: ${service.id} | Por: ${req.user.email}`);
  res.json({ success: true, message: 'Serviço cancelado.' });
});

// ── POST /api/services/:id/photos ─────────────────────────
router.post('/:id/photos', authenticate,
  uploadService.array('photos', 10), handleUploadError,
  async (req, res) => {
    const service = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!service || service.clientId !== req.user.id) return res.status(403).json({ success: false, message: 'Sem permissão.' });

    const photos = req.files.map(f => ({
      serviceId: service.id,
      url: `/uploads/services/${f.filename}`,
      type: req.body.photoType || 'before',
    }));

    await prisma.servicePhoto.createMany({ data: photos });
    res.json({ success: true, message: `${photos.length} foto(s) enviada(s).`, data: { photos } });
  }
);

module.exports = router;
