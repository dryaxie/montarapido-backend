const nodemailer = require('nodemailer');
const logger = require('../config/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_USER) {
    logger.warn('[Email] SMTP não configurado. Email não enviado.', { to, subject });
    return false;
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'MontaRapido <noreply@montarapido.com.br>',
      to, subject, html, text,
    });
    logger.info(`[Email] Enviado para ${to}: ${info.messageId}`);
    return true;
  } catch (err) {
    logger.error(`[Email] Erro: ${err.message}`, { to });
    return false;
  }
};

const emailTemplates = {
  welcomeClient: (name) => ({
    subject: 'Bem-vindo ao MontaRapido! 🛋️',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
        <div style="background:linear-gradient(135deg,#FF6B00,#ff9b4d);padding:40px 32px;text-align:center">
          <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0">MontaRapido</h1>
          <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px">Seu móvel novo, montado do jeito certo.</p>
        </div>
        <div style="padding:40px 32px">
          <h2 style="color:#1C1C2E;font-size:22px;font-weight:800;margin-bottom:16px">Olá, ${name}! 👋</h2>
          <p style="color:#6B7280;line-height:1.7;font-size:15px">Bem-vindo ao <strong>MontaRapido</strong>! Sua conta foi criada com sucesso.</p>
          <p style="color:#6B7280;line-height:1.7;font-size:15px">Agora você pode solicitar montagem de móveis com profissionais verificados na sua região.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${process.env.FRONTEND_URL}" style="background:#FF6B00;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Acessar o MontaRapido →</a>
          </div>
        </div>
        <div style="background:#F9FAFB;padding:20px 32px;text-align:center;color:#9CA3AF;font-size:13px">
          <p>MontaRapido © 2025 | <a href="#" style="color:#FF6B00">Política de Privacidade</a></p>
        </div>
      </div>`,
  }),

  resetPassword: (name, resetUrl) => ({
    subject: 'Redefinir senha — MontaRapido 🔐',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1C1C2E;padding:32px;text-align:center">
          <h1 style="color:#FF6B00;font-size:24px;font-weight:900;margin:0">MontaRapido</h1>
        </div>
        <div style="padding:40px 32px;background:#fff">
          <h2 style="color:#1C1C2E">Olá, ${name}</h2>
          <p style="color:#6B7280;line-height:1.7">Recebemos uma solicitação para redefinir a senha da sua conta.</p>
          <p style="color:#6B7280;line-height:1.7">Clique no botão abaixo para criar uma nova senha. O link expira em <strong>1 hora</strong>.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${resetUrl}" style="background:#FF6B00;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700">Redefinir minha senha →</a>
          </div>
          <p style="color:#9CA3AF;font-size:13px">Se não foi você, ignore este e-mail. Sua senha permanece a mesma.</p>
        </div>
      </div>`,
  }),

  montadorApproved: (name) => ({
    subject: 'Sua conta foi aprovada! 🎉 — MontaRapido',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#FF6B00,#ff9b4d);padding:40px 32px;text-align:center">
          <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0">MontaRapido</h1>
        </div>
        <div style="padding:40px 32px;background:#fff">
          <h2>Parabéns, ${name}! 🔧</h2>
          <p style="color:#6B7280;line-height:1.7">Sua conta de montador foi <strong>aprovada</strong>! Você já pode começar a receber pedidos na sua região.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${process.env.FRONTEND_URL}/login" style="background:#22C55E;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700">Acessar meu painel →</a>
          </div>
        </div>
      </div>`,
  }),
};

module.exports = { sendEmail, emailTemplates };
