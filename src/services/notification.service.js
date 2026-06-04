const prisma = require('../config/prisma');
const { sendWhatsApp, templates } = require('./whatsapp.service');
const logger = require('../config/logger');

/**
 * Cria notificação no banco e (opcionalmente) envia WhatsApp
 */
const createNotification = async ({
  userId, serviceId, type, title, message, data = {},
  sendWA = false, waPhone = null,
}) => {
  try {
    const notification = await prisma.notification.create({
      data: { userId, serviceId, type, title, message, data },
    });

    if (sendWA && waPhone) {
      const sent = await sendWhatsApp(waPhone, message);
      if (sent) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { sentViaWA: true },
        });
      }
    }

    return notification;
  } catch (err) {
    logger.error('[Notification] Erro ao criar notificação:', err.message);
  }
};

/**
 * Notifica montadores disponíveis na região sobre novo serviço
 */
const notifyMontadoresNewService = async (service) => {
  try {
    // Busca montadores aprovados, disponíveis e com especialidade compatível
    const montadores = await prisma.montadorProfile.findMany({
      where: {
        isApproved: true,
        isAvailable: true,
        user: { isActive: true },
        serviceRegions: { hasSome: [service.city] },
      },
      include: { user: { select: { id: true, name: true, phone: true } } },
      take: 20,
    });

    logger.info(`[Notification] Notificando ${montadores.length} montadores sobre serviço #${service.id}`);

    for (const montador of montadores) {
      const msg = templates.newServiceAvailable(service, montador.user);
      await createNotification({
  userId: montador.userId,
  serviceId: service.id,
  type: 'NEW_SERVICE',
  title: '🔔 Novo serviço disponível!',
  message: `${service.type} em ${service.city}\n📍 ${service.address}${service.complement ? ', ' + service.complement : ''}, ${service.neighborhood || ''}\n👤 Cliente: ${service.client?.name || 'Cliente'}\n📞 ${service.client?.phone || 'Não informado'}\n💰 R$ ${(service.estimatedValue * 0.75).toFixed(2)} para você`,
        data: { serviceId: service.id, city: service.city, value: service.estimatedValue },
        sendWA: !!montador.user.phone,
        waPhone: montador.user.phone,
      });
    }
  } catch (err) {
    logger.error('[Notification] Erro ao notificar montadores:', err.message);
  }
};

/**
 * Notifica admin geral sobre novo cadastro
 */
const notifyAdminNewRegistration = async (user, type = 'cliente') => {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'ADMIN_WHATSAPP' } });
    const adminPhone = config?.value || process.env.ADMIN_WHATSAPP;

    const msg = type === 'montador'
      ? templates.newMontadorRegistered(user)
      : templates.newClientRegistered(user);

    if (adminPhone) await sendWhatsApp(adminPhone, msg);

    // Notifica todos os admins no sistema
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'ADMIN_GERAL'] }, isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: `Novo ${type} cadastrado`,
        message: `${user.name} (${user.email}) acabou de se cadastrar como ${type}.`,
      });
    }
  } catch (err) {
    logger.error('[Notification] Erro ao notificar admin:', err.message);
  }
};

module.exports = { createNotification, notifyMontadoresNewService, notifyAdminNewRegistration };
