# 🔧 MontaRapido — Backend API

Backend completo do marketplace de montagem de móveis **MontaRapido**.

## 🛠️ Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Banco de dados | PostgreSQL |
| ORM | Prisma |
| Autenticação | JWT (Access + Refresh Token) |
| Pagamentos | Mercado Pago SDK |
| WhatsApp | Z-API / Evolution API |
| E-mail | Nodemailer (SMTP/Gmail) |
| Upload | Multer |
| Logs | Winston |
| Segurança | Helmet, Rate Limiting, bcrypt |

---

## 📁 Estrutura do Projeto

```
montarapido-backend/
├── prisma/
│   ├── schema.prisma       # Modelos do banco de dados
│   └── seed.js             # Dados iniciais (admin, preços, configs)
├── src/
│   ├── config/
│   │   ├── prisma.js       # Instância do Prisma Client
│   │   └── logger.js       # Winston logger
│   ├── middleware/
│   │   ├── auth.js         # JWT + autorização por role
│   │   └── upload.js       # Multer (imagens)
│   ├── routes/
│   │   ├── auth.routes.js          # Login, registro, senha
│   │   ├── services.routes.js      # CRUD de serviços
│   │   ├── montadores.routes.js    # Perfil e busca de montadores
│   │   ├── payments.routes.js      # Pagamentos + Webhook MP
│   │   ├── admin.routes.js         # Painel administrativo completo
│   │   ├── reviews.routes.js       # Avaliações
│   │   └── notifications.routes.js # Notificações in-app
│   ├── services/
│   │   ├── whatsapp.service.js     # Envio de WhatsApp (Z-API)
│   │   ├── email.service.js        # Nodemailer + templates HTML
│   │   ├── notification.service.js # Notificações no banco + WA
│   │   └── payment.service.js      # Mercado Pago + liberação
│   └── server.js           # Entry point
├── .env.example
├── package.json
└── README.md
```

---

## 🚀 Setup e Instalação

### 1. Pré-requisitos
- Node.js 18+
- PostgreSQL 14+ instalado e rodando

### 2. Instalar dependências
```bash
cd montarapido-backend
npm install
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite o .env com seus dados
```

### 4. Criar o banco de dados
```bash
# Criar o banco no PostgreSQL
psql -U postgres -c "CREATE DATABASE montarapido_db;"

# Gerar o Prisma Client
npm run db:generate

# Rodar as migrations
npm run db:migrate

# Popular com dados iniciais
npm run db:seed
```

### 5. Iniciar o servidor
```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

---

## 🔐 Credenciais de Teste (após seed)

| Perfil | E-mail | Senha |
|--------|--------|-------|
| **Admin Geral** | admin@montarapido.com.br | Admin@2025! |
| **Cliente** | cliente@teste.com | Cliente@123 |
| **Montador** | montador@teste.com | Montador@123 |

---

## 📡 Endpoints Principais

### Auth
```
POST /api/auth/register/cliente     # Cadastrar cliente
POST /api/auth/register/montador    # Cadastrar montador (aguarda aprovação)
POST /api/auth/login                # Login → retorna JWT
POST /api/auth/refresh              # Renovar access token
POST /api/auth/forgot-password      # Recuperar senha (envia e-mail)
POST /api/auth/reset-password       # Redefinir senha com token
GET  /api/auth/me                   # Perfil do usuário logado
POST /api/auth/logout               # Logout
```

### Serviços
```
POST   /api/services                # Criar serviço (cliente)
GET    /api/services                # Listar meus serviços
GET    /api/services/available      # Serviços disponíveis (montador)
GET    /api/services/:id            # Detalhes
PATCH  /api/services/:id/accept     # Aceitar (montador)
PATCH  /api/services/:id/confirm    # Confirmar conclusão (cliente ou montador)
PATCH  /api/services/:id/cancel     # Cancelar
POST   /api/services/:id/photos     # Upload de fotos
```

### Montadores
```
GET   /api/montadores               # Busca (requer login)
GET   /api/montadores/:id           # Perfil público
GET   /api/montadores/me/profile    # Meu perfil (montador)
PATCH /api/montadores/me/profile    # Atualizar perfil
PATCH /api/montadores/me/specialties # Especialidades
PATCH /api/montadores/me/availability # Disponibilidade
POST  /api/montadores/me/portfolio  # Upload portfólio
POST  /api/montadores/me/photo      # Foto de perfil
```

### Admin
```
GET   /api/admin/dashboard          # Dashboard completo
GET   /api/admin/users              # Listar usuários
GET   /api/admin/montadores/pending # Aguardando aprovação
PATCH /api/admin/montadores/:id/approve # Aprovar montador
PATCH /api/admin/montadores/:id/reject  # Reprovar montador
POST  /api/admin/montadores         # Adicionar manualmente
GET   /api/admin/price-table        # Tabela de preços
PUT   /api/admin/price-table/:cat   # Atualizar preço
GET   /api/admin/config             # Configurações
PUT   /api/admin/config/AI_ENABLED  # Ativar/desativar IA
GET   /api/admin/admins             # Listar admins (Admin Geral)
POST  /api/admin/admins             # Criar admin (Admin Geral)
DELETE /api/admin/admins/:id        # Remover admin (Admin Geral)
GET   /api/admin/reports/summary    # Relatório financeiro
```

### Pagamentos
```
POST /api/payments/webhook          # Webhook Mercado Pago
GET  /api/payments/:id              # Detalhes do pagamento
PATCH /api/payments/:id/confirm-manual # Confirmar manualmente (admin)
```

---

## 🔄 Fluxo Completo de um Serviço

```
1. Cliente cria serviço → POST /api/services
   └── Sistema calcula valor (tabela ou IA)
   └── Cria preferência de pagamento (MP)

2. Cliente paga → Webhook /api/payments/webhook
   └── Pagamento confirmado → status: HELD
   └── Montadores notificados (in-app + WhatsApp)

3. Montador aceita → PATCH /api/services/:id/accept
   └── Cliente notificado (nome, telefone do montador)
   └── Montador recebe detalhes via WhatsApp

4. Serviço realizado
   └── Montador confirma → PATCH /api/services/:id/confirm
   └── Cliente confirma  → PATCH /api/services/:id/confirm
   └── DUPLA CONFIRMAÇÃO → pagamento liberado (75% ao montador)

5. Cliente avalia → POST /api/reviews
   └── Nota recalculada no perfil do montador
```

---

## 🌐 Variáveis de Ambiente Importantes

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string do PostgreSQL |
| `JWT_SECRET` | Chave para assinar os tokens |
| `MERCADO_PAGO_ACCESS_TOKEN` | Token do Mercado Pago |
| `WHATSAPP_API_URL` | URL da Z-API ou Evolution API |
| `WHATSAPP_TOKEN` | Token da instância WhatsApp |
| `ADMIN_WHATSAPP` | Número do Admin Geral (alertas) |
| `SMTP_USER` / `SMTP_PASS` | Credenciais de e-mail |
| `FRONTEND_URL` | URL do frontend (CORS) |

---

## 🔒 Segurança Implementada

- ✅ Senhas com bcrypt (salt 12)
- ✅ JWT com expiração + refresh token
- ✅ Rate limiting por rota
- ✅ Helmet (headers de segurança)
- ✅ Validação de inputs (express-validator)
- ✅ CORS configurável
- ✅ Erros do Prisma tratados globalmente
- ✅ Logs estruturados (Winston)
- ✅ Audit log de ações administrativas

---

## 🤖 IA de Precificação

Controlada pela config `AI_ENABLED`:
```bash
# Via admin:
PUT /api/admin/config/AI_ENABLED
Body: { "value": "true" }

# Ou no banco:
UPDATE system_config SET value='true' WHERE key='AI_ENABLED';
```

Quando ativada, o campo `useAI: true` na criação do serviço ativa análise por foto + descrição.

---

## 📞 Suporte

- E-mail: suporte@montarapido.com.br
- WhatsApp: (11) 99999-9999
