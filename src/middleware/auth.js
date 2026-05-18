const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// ── Verificar JWT ──────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token de acesso não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, isVerified: true, profilePhoto: true,
        montadorProfile: { select: { id: true, isApproved: true, isAvailable: true } },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Usuário inativo ou não encontrado.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expirado. Faça login novamente.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Token inválido.' });
  }
};

// ── Verificar Role ─────────────────────────────────────────
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Você não tem permissão para acessar este recurso.',
    });
  }
  next();
};

// ── Atalhos ────────────────────────────────────────────────
const isCliente   = authorize('CLIENTE');
const isMontador  = authorize('MONTADOR');
const isAdmin     = authorize('ADMIN', 'ADMIN_GERAL');
const isAdminGeral = authorize('ADMIN_GERAL');
const isAny       = authorize('CLIENTE', 'MONTADOR', 'ADMIN', 'ADMIN_GERAL');

module.exports = { authenticate, authorize, isCliente, isMontador, isAdmin, isAdminGeral, isAny };
