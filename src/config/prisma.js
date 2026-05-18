const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

// Supabase usa connection pooling (pgBouncer)
// É necessário adicionar ?pgbouncer=true&connection_limit=1 na DATABASE_URL
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
    : ['warn', 'error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug(`Query: ${e.query} | ${e.duration}ms`);
  });
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
