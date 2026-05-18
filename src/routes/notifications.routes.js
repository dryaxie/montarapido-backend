const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');

// ── GET /api/notifications ─────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const where = { userId: req.user.id };
  if (unreadOnly === 'true') where.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ]);

  res.json({ success: true, data: { notifications, unreadCount, pagination: { total, page: parseInt(page), limit: parseInt(limit) } } });
});

// ── PATCH /api/notifications/:id/read ─────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { isRead: true, readAt: new Date() },
  });
  res.json({ success: true, message: 'Notificação marcada como lida.' });
});

// ── PATCH /api/notifications/read-all ─────────────────────
router.patch('/read-all', authenticate, async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  res.json({ success: true, message: `${count} notificações marcadas como lidas.` });
});

module.exports = router;
