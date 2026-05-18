const axios = require('axios');
const logger = require('../config/logger');

/**
 * Envia mensagem WhatsApp via Z-API (ou Evolution API)
 * Troque o provider no .env se usar outro gateway
 */
const sendWhatsApp = async (to, message) => {
  try {
    // Remove caracteres não numéricos e adiciona código do país se necessário
    const phone = to.replace(/\D/g, '');
    const finalPhone = phone.startsWith('55') ? phone : `55${phone}`;

    if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_TOKEN) {
      logger.warn('[WhatsApp] Credenciais não configuradas. Mensagem não enviada.', { to, message });
      return false;
    }

    await axios.post(
      `${process.env.WHATSAPP_API_URL}/send-text`,
      { phone: finalPhone, message },
      { headers: { 'Client-Token': process.env.WHATSAPP_TOKEN }, timeout: 10000 }
    );

    logger.info(`[WhatsApp] Mensagem enviada para ${finalPhone}`);
    return true;
  } catch (err) {
    logger.error(`[WhatsApp] Erro ao enviar mensagem: ${err.message}`, { to });
    return false;
  }
};

// ── Templates de mensagem ──────────────────────────────────

const templates = {
  // Para o Admin Geral
  newClientRegistered: (client) =>
    `🆕 *Novo Cliente Cadastrado — MontaRapido*\n\nNome: ${client.name}\nEmail: ${client.email}\nTelefone: ${client.phone || 'Não informado'}\nCidade: ${client.city || 'Não informada'}\n\n_Acesse o painel admin para mais detalhes._`,

  newMontadorRegistered: (montador) =>
    `🔧 *Novo Montador Cadastrado — MontaRapido*\n\nNome: ${montador.name}\nEmail: ${montador.email}\nTelefone: ${montador.phone || 'Não informado'}\n\n⏳ Aguardando aprovação no painel admin.`,

  // Para Montadores
  newServiceAvailable: (service, montador) =>
    `🔔 *Novo Serviço Disponível!*\n\nOlá, ${montador.name}!\n\nTipo: ${service.type}\nCidade: ${service.city}\nData: ${new Date(service.scheduledDate).toLocaleDateString('pt-BR')} às ${service.scheduledTime}\nValor para você: R$ ${(service.estimatedValue * 0.75).toFixed(2)}\n\n📱 Acesse o app para aceitar ou recusar.\nLink: https://montarapido.com.br/dash`,

  serviceAccepted: (service, client) =>
    `✅ *Serviço Aceito!*\n\nOlá, ${client.name}!\n\nSeu serviço de *${service.type}* foi aceito!\n\nMontador: ${service.montador?.user?.name}\nTelefone: ${service.montador?.user?.phone}\nData: ${new Date(service.scheduledDate).toLocaleDateString('pt-BR')} às ${service.scheduledTime}\n\nSe precisar de ajuda, nos chame aqui. 😊`,

  montadorJobDetails: (service, montador) =>
    `📋 *Detalhes do Serviço Aceito*\n\nOlá, ${montador.name}!\n\nCliente: ${service.client?.name}\nTelefone do cliente: ${service.client?.phone}\nEndereço: ${service.address}, ${service.city} - ${service.state}\nTipo: ${service.type}\nDescrição: ${service.description}\nData: ${new Date(service.scheduledDate).toLocaleDateString('pt-BR')} às ${service.scheduledTime}\n\n💰 Você receberá: R$ ${(service.estimatedValue * 0.75).toFixed(2)} após a conclusão.\n\nBom trabalho! 🔧`,

  paymentConfirmed: (service, user) =>
    `💳 *Pagamento Confirmado!*\n\nOlá, ${user.name}!\n\nSeu pagamento de R$ ${service.estimatedValue.toFixed(2)} para o serviço de *${service.type}* foi confirmado com sucesso!\n\nAguarde a notificação quando um montador aceitar seu pedido. ⏳`,

  serviceCompleted: (service, user) =>
    `🎉 *Serviço Concluído!*\n\nOlá, ${user.name}!\n\nO serviço de *${service.type}* foi concluído com sucesso!\n\nO pagamento foi liberado ao montador. Obrigado por usar o MontaRapido! 😊\n\nAvalie o serviço no app: https://montarapido.com.br`,

  forgotPassword: (user, resetUrl) =>
    `🔐 *Recuperação de Senha — MontaRapido*\n\nOlá, ${user.name}!\n\nClique no link abaixo para redefinir sua senha:\n${resetUrl}\n\n⚠️ O link expira em 1 hora.\n\nSe não foi você, ignore esta mensagem.`,
};

module.exports = { sendWhatsApp, templates };
