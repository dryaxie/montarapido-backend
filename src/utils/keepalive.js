/**
 * Keep-alive para o plano gratuito do Render
 * O Render dorme o serviço após 15min sem requisições.
 * Este módulo faz um ping a cada 14min para manter acordado.
 *
 * ATIVE apenas em produção com plano free.
 * No plano pago, remova este módulo.
 */
const https = require('https');
const logger = require('../config/logger');

const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 minutos

function startKeepAlive(url) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!url) {
    logger.warn('[KeepAlive] BACKEND_URL não configurada. Ping desativado.');
    return;
  }

  const pingUrl = `${url}/health`;
  logger.info(`[KeepAlive] Ping a cada 14min → ${pingUrl}`);

  setInterval(() => {
    https.get(pingUrl, (res) => {
      logger.debug(`[KeepAlive] Ping OK — status ${res.statusCode}`);
    }).on('error', (err) => {
      logger.warn(`[KeepAlive] Ping falhou: ${err.message}`);
    });
  }, PING_INTERVAL_MS);
}

module.exports = { startKeepAlive };
