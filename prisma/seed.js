const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // ── Seed: Tabela de Preços ──────────────────────────────
  const prices = [
    { category: 'GUARDA_ROUPA',      minPrice: 100, maxPrice: 220, notes: 'Inclui espelho. Portas extras = valor adicional.' },
    { category: 'CAMA_SOLTEIRO',     minPrice: 60,  maxPrice: 90,  notes: 'Box ou estrado.' },
    { category: 'CAMA_CASAL',        minPrice: 80,  maxPrice: 130, notes: 'Inclui cabeceira.' },
    { category: 'MESA_ESCRITORIO',   minPrice: 50,  maxPrice: 80,  notes: 'Mesa simples.' },
    { category: 'MESA_JANTAR',       minPrice: 70,  maxPrice: 110, notes: 'Até 6 lugares.' },
    { category: 'ESTANTE_RACK',      minPrice: 70,  maxPrice: 120, notes: 'Até 5 prateleiras.' },
    { category: 'SOFA',              minPrice: 80,  maxPrice: 150, notes: 'Modular inclui conexões.' },
    { category: 'COZINHA_PLANEJADA', minPrice: 300, maxPrice: 600, notes: 'Por projeto completo.' },
    { category: 'CLOSET',            minPrice: 200, maxPrice: 450, notes: 'Planejado.' },
    { category: 'INFANTIL',          minPrice: 60,  maxPrice: 120, notes: 'Berço, bicama, etc.' },
    { category: 'EXTERNO',           minPrice: 80,  maxPrice: 150, notes: 'Móveis de jardim/varanda.' },
    { category: 'OUTRO',             minPrice: 50,  maxPrice: 100, notes: 'Avaliação individual.' },
  ];

  for (const p of prices) {
    await prisma.priceTable.upsert({
      where: { category: p.category },
      update: p,
      create: p,
    });
  }
  console.log('✅ Tabela de preços criada');

  // ── Seed: Config do Sistema ─────────────────────────────
  const configs = [
    { key: 'AI_ENABLED',              value: 'false',  description: 'IA avançada de precificação ativa?' },
    { key: 'MONTADOR_COMMISSION',     value: '75',     description: '% que vai para o montador' },
    { key: 'PLATFORM_FEE',            value: '25',     description: '% da plataforma' },
    { key: 'JOB_TIMEOUT_HOURS',       value: '2',      description: 'Horas para montador aceitar o serviço' },
    { key: 'ADMIN_WHATSAPP',          value: '5511999999999', description: 'WhatsApp do Admin Geral' },
    { key: 'MIN_PORTFOLIO_PHOTOS',    value: '3',      description: 'Fotos mínimas no portfólio' },
    { key: 'MAX_SERVICE_RADIUS_KM',   value: '100',    description: 'Raio máximo de atendimento' },
  ];

  for (const c of configs) {
    await prisma.systemConfig.upsert({
      where: { key: c.key },
      update: { value: c.value },
      create: c,
    });
  }
  console.log('✅ Configurações do sistema criadas');

  // ── Seed: Admin Geral ───────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@2025!', 12);
const admin = await prisma.user.upsert({
  where: { email: 'dry.axie@gmail.com' },
  update: { password: adminPassword, isActive: true, isVerified: true },
  create: {
    name: 'Admin Geral',
    email: 'dry.axie@gmail.com',
    password: adminPassword,
    role: 'ADMIN_GERAL',
    isActive: true,
    isVerified: true,
    emailVerifiedAt: new Date(),
    adminProfile: {
      create: { whatsapp: '5511999999999' }
    }
  },
});
console.log(`✅ Admin Geral criado: ${admin.email}`);

  // ── Seed: Cliente de Teste ──────────────────────────────
  const clientPass = await bcrypt.hash('Cliente@123', 12);
  const client = await prisma.user.upsert({
    where: { email: 'cliente@teste.com' },
    update: {},
    create: {
      name: 'João Silva',
      email: 'cliente@teste.com',
      password: clientPass,
      phone: '11987654321',
      role: 'CLIENTE',
      city: 'São Paulo',
      state: 'SP',
      isVerified: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✅ Cliente de teste criado: ${client.email}`);

  // ── Seed: Montador de Teste ─────────────────────────────
  const montadorPass = await bcrypt.hash('Montador@123', 12);
  const montadorUser = await prisma.user.upsert({
    where: { email: 'montador@teste.com' },
    update: {},
    create: {
      name: 'Carlos Mota',
      email: 'montador@teste.com',
      password: montadorPass,
      phone: '11912345678',
      role: 'MONTADOR',
      city: 'São Paulo',
      state: 'SP',
      isVerified: true,
      emailVerifiedAt: new Date(),
      montadorProfile: {
        create: {
          cpf: '123.456.789-00',
          birthDate: new Date('1990-05-15'),
          address: 'Rua das Flores, 123',
          cep: '01310-100',
          neighborhood: 'Bela Vista',
          transport: 'CAR',
          experienceYears: 5,
          bio: 'Especialista em montagem de móveis residenciais e corporativos com 5 anos de experiência.',
          isAvailable: true,
          isApproved: true,
          approvedAt: new Date(),
          pixKey: 'carlos@montarapido.com.br',
          pixBank: 'Nubank',
          serviceRadius: 40,
          serviceRegions: ['São Paulo', 'Guarulhos', 'Santo André'],
          averageRating: 4.9,
          totalReviews: 87,
          totalServices: 87,
          specialties: {
            create: [
              { category: 'GUARDA_ROUPA' },
              { category: 'CAMA_CASAL' },
              { category: 'MESA_ESCRITORIO' },
              { category: 'ESTANTE_RACK' },
            ]
          },
          availability: {
            create: [
              { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
              { dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
              { dayOfWeek: 3, startTime: '08:00', endTime: '18:00' },
              { dayOfWeek: 4, startTime: '08:00', endTime: '18:00' },
              { dayOfWeek: 5, startTime: '08:00', endTime: '18:00' },
              { dayOfWeek: 6, startTime: '08:00', endTime: '13:00' },
            ]
          }
        }
      }
    },
  });
  console.log(`✅ Montador de teste criado: ${montadorUser.email}`);

  console.log('\n🎉 Seed concluído com sucesso!\n');
  console.log('── Credenciais de acesso ──────────────────────');
  console.log('Admin Geral:  admin@montarapido.com.br  / Admin@2025!');
  console.log('Cliente:      cliente@teste.com          / Cliente@123');
  console.log('Montador:     montador@teste.com         / Montador@123');
  console.log('───────────────────────────────────────────────');
}

main()
  .catch((e) => { console.error('❌ Erro no seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
