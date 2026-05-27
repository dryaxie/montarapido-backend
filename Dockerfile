# ╔═══════════════════════════════════════════════════════╗
# ║         MONTARAPIDO — Dockerfile Multi-Stage          ║
# ╚═══════════════════════════════════════════════════════╝

# ── Stage 1: Base ──────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat libssl3 && \
    ln -s /usr/lib/libssl.so.3 /usr/lib/libssl.so.1.1 || true && \
    ln -s /usr/lib/libcrypto.so.3 /usr/lib/libcrypto.so.1.1 || true
WORKDIR /app

# Instala dependências do sistema (bcrypt, sharp etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    openssl \
    openssl-dev \
    libc6-compat \
    libssl3 && \
    ln -s /usr/lib/libssl.so.3 /usr/lib/libssl.so.1.1 || true && \
    ln -s /usr/lib/libcrypto.so.3 /usr/lib/libcrypto.so.1.1 || true

# Copia manifests de dependências
COPY package*.json ./
COPY prisma ./prisma/

# ── Stage 2: Development (com nodemon) ──────────────────────
FROM base AS development
ENV NODE_ENV=development

RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 3000 9229

CMD ["npm", "run", "dev"]

# ── Stage 3: Builder (instala apenas prod deps) ─────────────
FROM base AS builder
ENV NODE_ENV=production

RUN npm ci --only=production && npm cache clean --force
RUN npx prisma generate

# ── Stage 4: Production (imagem final mínima) ───────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache openssl libc6-compat libssl3 && \
    ln -s /usr/lib/libssl.so.3 /usr/lib/libssl.so.1.1 || true && \
    ln -s /usr/lib/libcrypto.so.3 /usr/lib/libcrypto.so.1.1 || true

# Segurança: usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodeuser -u 1001

# Copia apenas o necessário
COPY --from=builder --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodeuser:nodejs /app/prisma      ./prisma
COPY --chown=nodeuser:nodejs package*.json ./
COPY --chown=nodeuser:nodejs src            ./src

# Cria diretórios de runtime
RUN mkdir -p uploads logs && \
    chown -R nodeuser:nodejs uploads logs

USER nodeuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
