const router = require('express').Router();
const { body } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isCliente } = require('../middleware/auth');

// ── POST /api/reviews — Avaliar montador ──────────────────
router.post('/', authenticate, isCliente, [
  body('serviceId').notEmpty(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().trim(),
], async (req, res) => {
  const { serviceId, rating, comment } = req.body;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { review: true },
  });

  if (!service) return res.status(404).json({ success: false, message: 'Serviço não encontrado.' });
  if (service.clientId !== req.user.id) return res.status(403).json({ success: false, message: 'Sem permissão.' });
  if (service.status !== 'COMPLETED') return res.status(400).json({ success: false, message: 'Só é possível avaliar serviços concluídos.' });
  if (service.review) return res.status(409).json({ success: false, message: 'Você já avaliou este serviço.' });
  if (!service.montadorId) return res.status(400).json({ success: false, message: 'Serviço não tem montador.' });

  const review = await prisma.review.create({
    data: { serviceId, authorId: req.user.id, montadorId: service.montadorId, rating, comment },
  });

  // Recalcula média do montador
  const stats = await prisma.review.aggregate({
    _avg: { rating: true }, _count: { id: true },
    where: { montadorId: service.montadorId },
  });
  await prisma.montadorProfile.update({
    where: { id: service.montadorId },
    data: { averageRating: stats._avg.rating || 0, totalReviews: stats._count.id },
  });

  res.status(201).json({ success: true, message: 'Avaliação enviada! Obrigado.', data: { review } });
});

// ── GET /api/reviews/montador/:montadorId ─────────────────
router.get('/montador/:montadorId', async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { montadorId: req.params.montadorId },
      select: { id: true, rating: true, comment: true, reply: true, createdAt: true, author: { select: { name: true, profilePhoto: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
    }),
    prisma.review.count({ where: { montadorId: req.params.montadorId } }),
  ]);
  res.json({ success: true, data: { reviews, pagination: { total, page: parseInt(page), limit: parseInt(limit) } } });
});

// ── PATCH /api/reviews/:id/reply — Montador responde ──────
router.patch('/:id/reply', authenticate, async (req, res) => {
  const { reply } = req.body;
  const review = await prisma.review.findUnique({ where: { id: req.params.id }, include: { montador: true } });
  if (!review) return res.status(404).json({ success: false, message: 'Avaliação não encontrada.' });
  if (review.montador.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Sem permissão.' });
  await prisma.review.update({ where: { id: review.id }, data: { reply, replyAt: new Date() } });
  res.json({ success: true, message: 'Resposta enviada!' });
});

module.exports = router;
