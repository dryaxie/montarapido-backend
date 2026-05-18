/**
 * Script de verificação pré-deploy
 * Roda antes de subir para o Render e valida tudo
 * Uso: node scripts/deploy-check.js
 */
require('dotenv').config();

const checks = [];
let allOk = true;

function check(name, condition, fix) {
  const ok = condition();
  checks.push({ name, ok, fix });
  if (!ok) allOk = false;
}

// Variáveis obrigatórias
check('DATABASE_URL configurada',    () => !!process.env.DATABASE_URL,            'Configure no .env: DATABASE_URL=postgresql://...');
check('JWT_SECRET configurado',      () => !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, 'Gere com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
check('JWT_REFRESH_SECRET configurado', () => !!process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length >= 32, 'Gere outro hex de 64 bytes');
check('FRONTEND_URL configurada',    () => !!process.env.FRONTEND_URL,            'Configure: FRONTEND_URL=https://montarapido.vercel.app');
check('JWT_SECRET ≠ JWT_REFRESH',   () => process.env.JWT_SECRET !== process.env.JWT_REFRESH_SECRET, 'Os dois JWT secrets devem ser diferentes!');
check('NODE_ENV = production',       () => process.env.NODE_ENV === 'production',  'Configure: NODE_ENV=production');

// Verificações opcionais (avisa mas não bloqueia)
const optionals = [
  { name: 'Mercado Pago configurado', ok: !!process.env.MERCADO_PAGO_ACCESS_TOKEN },
  { name: 'E-mail SMTP configurado',  ok: !!process.env.SMTP_USER },
  { name: 'WhatsApp configurado',     ok: !!process.env.WHATSAPP_API_URL },
];

console.log('\n🔍 MontaRapido — Verificação de Deploy\n' + '═'.repeat(45));

checks.forEach(({ name, ok, fix }) => {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok && fix) console.log(`   ↳ ${fix}`);
});

console.log('\n⚠️  Opcionais (não bloqueiam o deploy):');
optionals.forEach(({ name, ok }) => {
  console.log(`${ok ? '✅' : '⚠️ '} ${name}${ok ? '' : ' — configure depois'}`);
});

console.log('\n' + '═'.repeat(45));
if (allOk) {
  console.log('✅ Tudo certo! Pode fazer o deploy.\n');
  process.exit(0);
} else {
  console.log('❌ Corrija os erros acima antes do deploy.\n');
  process.exit(1);
}
