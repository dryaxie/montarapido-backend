const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
});

const paymentApi   = new Payment(client);
const preferenceApi = new Preference(client);

/**
 * Cria preferência de pagamento (Pix ou Cartão) no Mercado Pago
 */
const createMPPayment = async (service, user, method = 'pix') => {
  if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
    logger.warn('[Payment] Mercado Pago não configurado. Retornando dados simulados.');
    return {
      mpPaymentId: null,
      mpExternalReference: `montarapido-${service.id}`,
      status: 'PENDING',
    };
  }
  try {
    const externalRef = `montarapido-${service.id}-${uuidv4().slice(0,8)}`;
    const commission = (service.estimatedValue * (100 - parseInt(process.env.PLATFORM_FEE_PERCENT || '25'))) / 100;

    if (method === 'pix') {
      // Criar pagamento Pix direto
      const pixPayment = await paymentApi.create({
        body: {
          transaction_amount: service.estimatedValue,
          description: `MontaRapido - ${service.type} - ${service.id.slice(0, 8)}`,
          payment_method_id: 'pix',
          external_reference: externalRef,
          payer: {
            email: user.email,
            first_name: user.name.split(' ')[0],
            last_name: user.name.split(' ').slice(1).join(' ') || '-',
          },
          notification_url: `${process.env.BACKEND_URL || 'https://api.montarapido.com.br'}/api/payments/webhook`,
        },
      });

      return {
        mpPaymentId: String(pixPayment.id),
        mpExternalReference: externalRef,
        mpPixQrCode: pixPayment.point_of_interaction?.transaction_data?.qr_code_base64,
        mpPixCopyPaste: pixPayment.point_of_interaction?.transaction_data?.qr_code,
        status: 'PENDING',
      };
    } else {
      // Criar preferência (cartão)
      const preference = await preferenceApi.create({
        body: {
          items: [{
            id: service.id,
            title: `MontaRapido - ${service.type}`,
            description: service.description,
            quantity: 1,
            unit_price: service.estimatedValue,
            currency_id: 'BRL',
          }],
          payer: { email: user.email, name: user.name },
          external_reference: externalRef,
          back_urls: {
            success: `${process.env.FRONTEND_URL}/pagamento/sucesso`,
            failure: `${process.env.FRONTEND_URL}/pagamento/erro`,
            pending: `${process.env.FRONTEND_URL}/pagamento/pendente`,
          },
          auto_return: 'approved',
          notification_url: `${process.env.BACKEND_URL || 'https://api.montarapido.com.br'}/api/payments/webhook`,
          payment_methods: {
            installments: 12,
            default_installments: 1,
          },
        },
      });

      return {
        mpPreferenceId: preference.id,
        mpExternalReference: externalRef,
        checkoutUrl: preference.init_point,
        status: 'PENDING',
      };
    }
  } catch (err) {
    logger.error('[Payment] Erro ao criar pagamento MP:', err.message);
    throw new Error('Falha ao processar pagamento. Tente novamente.');
  }
};

/**
 * Processa webhook do Mercado Pago
 */
const processWebhook = async (body) => {
  try {
    if (body.type !== 'payment') return null;
    const mpPayment = await paymentApi.get({ id: body.data.id });

    const payment = await prisma.payment.findFirst({
      where: { mpExternalReference: mpPayment.external_reference },
      include: { service: { include: { client: true } } },
    });

    if (!payment) return null;

    if (mpPayment.status === 'approved' && payment.status === 'PENDING') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'HELD', paidAt: new Date(), mpPaymentId: String(mpPayment.id) },
      });
      await prisma.service.update({
        where: { id: payment.serviceId },
        data: { status: 'PENDING' },
      });

      logger.info(`[Payment] Pagamento aprovado: ${payment.id}`);
      return { success: true, action: 'payment_approved', payment };
    }

    return null;
  } catch (err) {
    logger.error('[Payment] Erro no webhook:', err.message);
    return null;
  }
};

/**
 * Libera pagamento ao montador após dupla confirmação
 */
const releasePayment = async (paymentId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { montador: { include: { user: true } } },
  });

  if (!payment || !payment.clientConfirmed || !payment.montadorConfirmed) {
    throw new Error('Confirmação dupla pendente.');
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  // Aqui: integrar com API de transferência do MP para conta do montador
  logger.info(`[Payment] Pagamento liberado: ${paymentId} | Montador: ${payment.montador.user.name} | Valor: R$${payment.montadorAmount}`);

  // Atualizar earnings do montador
  await prisma.montadorProfile.update({
    where: { id: payment.montadorId },
    data: { totalEarnings: { increment: payment.montadorAmount } },
  });

  return payment;
};

module.exports = { createMPPayment, processWebhook, releasePayment };
