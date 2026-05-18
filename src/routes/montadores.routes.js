const router = require('express').Router();
const { body, query } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isMontador, isAdmin } = require('../middleware/auth');
const { uploadProfile, uploadPortfolio, handleUploadError } = require('../middleware/upload');

const MONTADOR_PUBLIC = {
  id: true, userId: true, bio: true, transport: true,
  experienceYears: true, averageRating: true, totalReviews: true,
  totalServices: true, isAvailable: true, serviceRadius: true, serviceRegions: true,
  user: { select: { name: true, city: true, state: true, profilePhoto: true } },
  specialties: { select: { category: true } },
  portfolioPhotos: { take: 6, orderBy: { createdAt: 'desc' } },
  availability: true,
};

// ── GET /api/montadores — Busca pública (só para logados) ──
router.get('/', authenticate, async (req, res) => {
  const { city, category, page = 1, limit = 12, available } = req.query;
  const where = { isApproved: true, user: { isActive: true } };

  if (city) where.serviceRegions = { hasSome: [city] };
  if (category) where.specialties = { some: { category } };
  if (available === 'true') where.isAvailable = true;

  const [montadores, total] = await Promise.all([
    prisma.montadorProfile.findMany({
      where, select: MONTADOR_PUBLIC,
      orderBy: [{ averageRating: 'desc' }, { totalReviews: 'desc' }],
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.montadorProfile.count({ where }),
  ]);

  res.json({ success: true, data: { montadores, pagination: { total, page: parseInt(page), limit: parseInt(limit) } } });
});

// ── GET /api/montadores/:id ────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const montador = await prisma.montadorProfile.findUnique({
    where: { id: req.params.id },
    select: {
      ...MONTADOR_PUBLIC,
      reviews: {
        select: { rating: true, comment: true, reply: true, createdAt: true, author: { select: { name: true, profilePhoto: true } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      },
    },
  });

  if (!montador || !montador.isApproved) {
    return res.status(404).json({ success: false, message: 'Montador não encontrado.' });
  }

  res.json({ success: true, data: { montador } });
});

// ── GET /api/montadores/me/profile ────────────────────────
router.get('/me/profile', authenticate, isMontador, async (req, res) => {
  const montador = await prisma.montadorProfile.findUnique({
    where: { userId: req.user.id },
    include: { specialties: true, availability: true, portfolioPhotos: true, user: { select: { name: true, email: true, phone: true, profilePhoto: true, city: true, state: true } } },
  });
  if (!montador) return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
  res.json({ success: true, data: { montador } });
});

// ── PATCH /api/montadores/me/profile ──────────────────────
router.patch('/me/profile', authenticate, isMontador, async (req, res) => {
  const { bio, transport, experienceYears, pixKey, pixBank, serviceRadius, serviceRegions, isAvailable } = req.body;

  const montador = await prisma.montadorProfile.update({
    where: { userId: req.user.id },
    data: {
      bio, transport, pixKey, pixBank,
      experienceYears: experienceYears ? parseInt(experienceYears) : undefined,
      serviceRadius: serviceRadius ? parseInt(serviceRadius) : undefined,
      serviceRegions: serviceRegions || undefined,
      isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : undefined,
    },
  });

  res.json({ success: true, message: 'Perfil atualizado!', data: { montador } });
});

// ── PATCH /api/montadores/me/specialties ──────────────────
router.patch('/me/specialties', authenticate, isMontador, async (req, res) => {
  const { specialties } = req.body;
  if (!Array.isArray(specialties) || specialties.length === 0) {
    return res.status(422).json({ success: false, message: 'Informe ao menos uma especialidade.' });
  }

  const montador = await prisma.montadorProfile.findUnique({ where: { userId: req.user.id } });

  await prisma.$transaction([
    prisma.montadorSpecialty.deleteMany({ where: { montadorId: montador.id } }),
    prisma.montadorSpecialty.createMany({ data: specialties.map(c => ({ montadorId: montador.id, category: c })) }),
  ]);

  res.json({ success: true, message: 'Especialidades atualizadas!' });
});

// ── PATCH /api/montadores/me/availability ─────────────────
router.patch('/me/availability', authenticate, isMontador, async (req, res) => {
  const { availability } = req.body;
  const montador = await prisma.montadorProfile.findUnique({ where: { userId: req.user.id } });

  await prisma.$transaction([
    prisma.montadorAvailability.deleteMany({ where: { montadorId: montador.id } }),
    prisma.montadorAvailability.createMany({ data: availability.map(a => ({ ...a, montadorId: montador.id })) }),
  ]);

  res.json({ success: true, message: 'Disponibilidade atualizada!' });
});

// ── POST /api/montadores/me/portfolio ─────────────────────
router.post('/me/portfolio', authenticate, isMontador,
  uploadPortfolio.array('photos', 10), handleUploadError,
  async (req, res) => {
    const montador = await prisma.montadorProfile.findUnique({ where: { userId: req.user.id } });

    const count = await prisma.portfolioPhoto.count({ where: { montadorId: montador.id } });
    if (count >= 20) return res.status(400).json({ success: false, message: 'Máximo de 20 fotos no portfólio.' });

    const photos = req.files.map(f => ({
      montadorId: montador.id,
      url: `/uploads/portfolio/${f.filename}`,
      caption: req.body.caption || null,
    }));
    await prisma.portfolioPhoto.createMany({ data: photos });
    res.json({ success: true, message: `${photos.length} foto(s) adicionada(s).`, data: { photos } });
  }
);

// ── DELETE /api/montadores/me/portfolio/:photoId ───────────
router.delete('/me/portfolio/:photoId', authenticate, isMontador, async (req, res) => {
  const montador = await prisma.montadorProfile.findUnique({ where: { userId: req.user.id } });
  await prisma.portfolioPhoto.deleteMany({ where: { id: req.params.photoId, montadorId: montador.id } });
  res.json({ success: true, message: 'Foto removida.' });
});

// ── POST /api/montadores/me/photo — Foto de perfil ────────
router.post('/me/photo', authenticate, isMontador,
  uploadProfile.single('photo'), handleUploadError,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    const url = `/uploads/profiles/${req.file.filename}`;
    await prisma.user.update({ where: { id: req.user.id }, data: { profilePhoto: url } });
    res.json({ success: true, message: 'Foto de perfil atualizada!', data: { url } });
  }
);

module.exports = router;
