/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MONTARAPIDO — API SERVICE LAYER (api.js)            ║
 * ║  Conecta o frontend HTML ao backend Node.js                 ║
 * ║  Inclua este arquivo ANTES do script principal do app       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Uso: <script src="api.js"></script>
 *
 * Todas as funções retornam uma Promise.
 * Em caso de erro, lançam um Error com a mensagem da API.
 */

// ══════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════

const API_CONFIG = {
  // 🔧 ALTERE para a URL do seu backend
  BASE_URL: 'https://montarapido-api.onrender.com',

  // Tempo máximo de espera por resposta (ms)
  TIMEOUT: 15000,
};

// ══════════════════════════════════════════════════════════════
//  GERENCIADOR DE TOKEN (localStorage)
// ══════════════════════════════════════════════════════════════

const TokenManager = {
  getAccess:    ()      => localStorage.getItem('mr_access_token'),
  getRefresh:   ()      => localStorage.getItem('mr_refresh_token'),
  setTokens:    (a, r)  => { localStorage.setItem('mr_access_token', a); if (r) localStorage.setItem('mr_refresh_token', r); },
  clearTokens:  ()      => { localStorage.removeItem('mr_access_token'); localStorage.removeItem('mr_refresh_token'); localStorage.removeItem('mr_user'); },
  getUser:      ()      => JSON.parse(localStorage.getItem('mr_user') || 'null'),
  setUser:      (u)     => localStorage.setItem('mr_user', JSON.stringify(u)),
  isLoggedIn:   ()      => !!localStorage.getItem('mr_access_token'),
};

// ══════════════════════════════════════════════════════════════
//  HTTP CLIENT (fetch wrapper com retry automático)
// ══════════════════════════════════════════════════════════════

let _isRefreshing = false;
let _refreshQueue = [];

const http = {
  /**
   * Requisição base com tratamento de token expirado
   */
  async request(method, path, body = null, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${path}`;
    const isFormData = body instanceof FormData;

    const headers = {
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...(options.auth !== false && TokenManager.getAccess()
        ? { Authorization: `Bearer ${TokenManager.getAccess()}` }
        : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));

      // Token expirado → tenta renovar e repetir
      if (res.status === 401 && data.code === 'TOKEN_EXPIRED') {
        return await http._handleRefreshAndRetry(method, path, body, options);
      }

      if (!res.ok) {
        const msg = data.message || data.errors?.[0]?.msg || `Erro ${res.status}`;
        throw Object.assign(new Error(msg), { status: res.status, data });
      }

      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Tempo de conexão esgotado. Verifique sua internet.');
      throw err;
    }
  },

  async _handleRefreshAndRetry(method, path, body, options) {
    if (_isRefreshing) {
      return new Promise((resolve, reject) => {
        _refreshQueue.push({ resolve, reject, method, path, body, options });
      });
    }
    _isRefreshing = true;
    try {
      const refreshToken = TokenManager.getRefresh();
      if (!refreshToken) throw new Error('Sessão expirada. Faça login novamente.');

      const res = await fetch(`${API_CONFIG.BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Sessão expirada.');

      TokenManager.setTokens(data.data.accessToken, data.data.refreshToken);

      // Resolve fila de pendências
      _refreshQueue.forEach(({ resolve, method: m, path: p, body: b, options: o }) => {
        resolve(http.request(m, p, b, o));
      });
      _refreshQueue = [];
      _isRefreshing = false;

      return http.request(method, path, body, options);
    } catch (err) {
      _refreshQueue.forEach(({ reject }) => reject(err));
      _refreshQueue = [];
      _isRefreshing = false;
      TokenManager.clearTokens();
      window.dispatchEvent(new CustomEvent('mr:session-expired'));
      throw err;
    }
  },

  get:    (path, opts)       => http.request('GET',    path, null, opts),
  post:   (path, body, opts) => http.request('POST',   path, body, opts),
  put:    (path, body, opts) => http.request('PUT',    path, body, opts),
  patch:  (path, body, opts) => http.request('PATCH',  path, body, opts),
  delete: (path, opts)       => http.request('DELETE', path, null, opts),
};

// ══════════════════════════════════════════════════════════════
//  AUTH API
// ══════════════════════════════════════════════════════════════

const AuthAPI = {
  /**
   * Login — retorna { user, accessToken, refreshToken }
   */
  async login(email, password) {
    const res = await http.post('/auth/login', { email, password }, { auth: false });
    TokenManager.setTokens(res.data.accessToken, res.data.refreshToken);
    TokenManager.setUser(res.data.user);
    return res.data;
  },

  /**
   * Cadastro de cliente
   */
  async registerCliente(data) {
    const res = await http.post('/auth/register/cliente', data, { auth: false });
    if (res.data?.accessToken) {
      TokenManager.setTokens(res.data.accessToken, res.data.refreshToken);
      TokenManager.setUser(res.data.user);
    }
    return res;
  },

  /**
   * Cadastro de montador (retorna mensagem de aguarde aprovação)
   */
  async registerMontador(data) {
    return http.post('/auth/register/montador', data, { auth: false });
  },

  /**
   * Dados do usuário logado
   */
  async me() {
    const res = await http.get('/auth/me');
    TokenManager.setUser(res.data.user);
    return res.data.user;
  },

  /**
   * Esqueci minha senha
   */
  forgotPassword: (email) =>
    http.post('/auth/forgot-password', { email }, { auth: false }),

  /**
   * Redefinir senha com token
   */
  resetPassword: (token, password) =>
    http.post('/auth/reset-password', { token, password }, { auth: false }),

  /**
   * Logout
   */
  async logout() {
    try {
      await http.post('/auth/logout', { refreshToken: TokenManager.getRefresh() });
    } finally {
      TokenManager.clearTokens();
    }
  },

  isLoggedIn:  () => TokenManager.isLoggedIn(),
  currentUser: () => TokenManager.getUser(),
};

// ══════════════════════════════════════════════════════════════
//  SERVICES API
// ══════════════════════════════════════════════════════════════

const ServicesAPI = {
  /**
   * Criar serviço
   * @param {Object} data - { type, description, address, city, state, cep,
   *                          scheduledDate, scheduledTime, items[], paymentMethod }
   */
  create: (data)            => http.post('/services', data),

  /**
   * Listar meus serviços
   */
  list: (params = {})       => http.get(`/services?${new URLSearchParams(params)}`),

  /**
   * Serviços disponíveis (para montadores)
   */
  available: (params = {})  => http.get(`/services/available?${new URLSearchParams(params)}`),

  /**
   * Detalhes de um serviço
   */
  get: (id)                 => http.get(`/services/${id}`),

  /**
   * Aceitar serviço (montador)
   */
  accept: (id)              => http.patch(`/services/${id}/accept`),

  /**
   * Confirmar conclusão (cliente ou montador)
   */
  confirm: (id)             => http.patch(`/services/${id}/confirm`),

  /**
   * Cancelar serviço
   */
  cancel: (id, reason)      => http.patch(`/services/${id}/cancel`, { reason }),

  /**
   * Upload de fotos do serviço
   */
  async uploadPhotos(id, files, photoType = 'before') {
    const form = new FormData();
    files.forEach(f => form.append('photos', f));
    form.append('photoType', photoType);
    return http.post(`/services/${id}/photos`, form);
  },

  /**
   * Calcular preço (usando tabela local de preços)
   */
  async calcularPreco(items) {
    const prices = await PricesAPI.list();
    let total = 0;
    const breakdown = items.map(item => {
      const entry = prices.find(p => p.category === item.category);
      const val = entry ? (entry.minPrice + entry.maxPrice) / 2 : 80;
      total += val * (item.quantity || 1);
      return { ...item, estimatedValue: val };
    });
    return { total, breakdown };
  },
};

// ══════════════════════════════════════════════════════════════
//  MONTADORES API
// ══════════════════════════════════════════════════════════════

const MontadoresAPI = {
  /**
   * Buscar montadores (requer login)
   */
  list: (params = {})         => http.get(`/montadores?${new URLSearchParams(params)}`),

  /**
   * Perfil público de um montador
   */
  get: (id)                   => http.get(`/montadores/${id}`),

  /**
   * Meu perfil (montador logado)
   */
  myProfile: ()               => http.get('/montadores/me/profile'),

  /**
   * Atualizar meu perfil
   */
  updateProfile: (data)       => http.patch('/montadores/me/profile', data),

  /**
   * Atualizar especialidades
   */
  updateSpecialties: (list)   => http.patch('/montadores/me/specialties', { specialties: list }),

  /**
   * Atualizar disponibilidade
   */
  updateAvailability: (list)  => http.patch('/montadores/me/availability', { availability: list }),

  /**
   * Upload de foto de perfil
   */
  async uploadProfilePhoto(file) {
    const form = new FormData();
    form.append('photo', file);
    return http.post('/montadores/me/photo', form);
  },

  /**
   * Upload de fotos do portfólio
   */
  async uploadPortfolio(files, caption = '') {
    const form = new FormData();
    files.forEach(f => form.append('photos', f));
    if (caption) form.append('caption', caption);
    return http.post('/montadores/me/portfolio', form);
  },

  /**
   * Remover foto do portfólio
   */
  deletePortfolioPhoto: (photoId) => http.delete(`/montadores/me/portfolio/${photoId}`),
};

// ══════════════════════════════════════════════════════════════
//  PAYMENTS API
// ══════════════════════════════════════════════════════════════

const PaymentsAPI = {
  get: (id)       => http.get(`/payments/${id}`),
  list: ()        => http.get('/payments'),
};

// ══════════════════════════════════════════════════════════════
//  REVIEWS API
// ══════════════════════════════════════════════════════════════

const ReviewsAPI = {
  /**
   * Avaliar montador após serviço concluído
   */
  create: (serviceId, rating, comment) =>
    http.post('/reviews', { serviceId, rating, comment }),

  /**
   * Avaliações de um montador
   */
  getByMontador: (montadorId, params = {}) =>
    http.get(`/reviews/montador/${montadorId}?${new URLSearchParams(params)}`),

  /**
   * Montador responde avaliação
   */
  reply: (reviewId, reply) =>
    http.patch(`/reviews/${reviewId}/reply`, { reply }),
};

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS API
// ══════════════════════════════════════════════════════════════

const NotificationsAPI = {
  list: (params = {})    => http.get(`/notifications?${new URLSearchParams(params)}`),
  markRead: (id)         => http.patch(`/notifications/${id}/read`),
  markAllRead: ()        => http.patch('/notifications/read-all'),
};

// ══════════════════════════════════════════════════════════════
//  PRICES API (pública para logados)
// ══════════════════════════════════════════════════════════════

const PricesAPI = {
  list: async () => {
    const res = await http.get('/prices');
    return res.data.prices;
  },
};

// ══════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════

const AdminAPI = {
  // Dashboard
  dashboard: ()                   => http.get('/admin/dashboard'),

  // Usuários
  users: (params = {})            => http.get(`/admin/users?${new URLSearchParams(params)}`),
  toggleUserActive: (id)          => http.patch(`/admin/users/${id}/toggle-active`),

  // Montadores
  pendingMontadores: ()           => http.get('/admin/montadores/pending'),
  approveMontador: (id)           => http.patch(`/admin/montadores/${id}/approve`),
  rejectMontador: (id, reason)    => http.patch(`/admin/montadores/${id}/reject`, { reason }),
  addMontador: (data)             => http.post('/admin/montadores', data),

  // Serviços
  services: (params = {})         => http.get(`/admin/services?${new URLSearchParams(params)}`),
  confirmPayment: (serviceId)     => http.patch(`/admin/payments/${serviceId}/confirm-manual`),
  cancelService: (id, reason)     => http.patch(`/admin/services/${id}/cancel`, { reason }),

  // Tabela de preços
  priceTable: ()                  => http.get('/admin/price-table'),
  updatePrice: (category, data)   => http.put(`/admin/price-table/${category}`, data),

  // Configurações
  config: ()                      => http.get('/admin/config'),
  updateConfig: (key, value)      => http.put(`/admin/config/${key}`, { value }),
  toggleAI: (enabled)             => http.put('/admin/config/AI_ENABLED', { value: String(enabled) }),

  // Administradores
  admins: ()                      => http.get('/admin/admins'),
  createAdmin: (data)             => http.post('/admin/admins', data),
  deleteAdmin: (id)               => http.delete(`/admin/admins/${id}`),

  // Relatórios
  reports: (params = {})          => http.get(`/admin/reports/summary?${new URLSearchParams(params)}`),
};

// ══════════════════════════════════════════════════════════════
//  UI HELPERS — Conectam chamadas de API com o frontend
// ══════════════════════════════════════════════════════════════

/**
 * Executa uma chamada de API com loading + toast de erro automático
 *
 * @param {Function} apiFn   - Função da API a chamar
 * @param {Object}   opts    - { onSuccess, onError, loadingEl, successMsg }
 */
async function apiCall(apiFn, opts = {}) {
  const { onSuccess, onError, loadingEl, successMsg } = opts;

  if (loadingEl) {
    loadingEl.disabled = true;
    loadingEl._originalText = loadingEl.innerHTML;
    loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...';
  }

  try {
    const result = await apiFn();
    if (successMsg) showToast(successMsg, 'success');
    if (onSuccess) onSuccess(result);
    return result;
  } catch (err) {
    const msg = err.message || 'Erro inesperado. Tente novamente.';
    showToast(msg, 'error');
    if (onError) onError(err);
    return null;
  } finally {
    if (loadingEl) {
      loadingEl.disabled = false;
      loadingEl.innerHTML = loadingEl._originalText;
    }
  }
}

/**
 * Inicializa o app verificando se há usuário logado
 * Chame no load do frontend
 */
async function initApp() {
  if (TokenManager.isLoggedIn()) {
    try {
      const user = await AuthAPI.me();
      state.user = user;
    } catch {
      TokenManager.clearTokens();
      state.user = null;
    }
  }

  // Listener de sessão expirada
  window.addEventListener('mr:session-expired', () => {
    state.user = null;
    showToast('Sua sessão expirou. Faça login novamente.', 'warning');
    navigate('login');
    render();
  });
}

// ══════════════════════════════════════════════════════════════
//  INTEGRAÇÃO COM FORMULÁRIOS DO FRONTEND
//  Substitui as funções mock do app principal
// ══════════════════════════════════════════════════════════════

/**
 * Login real com a API
 */
async function doLoginReal(event) {
  event.preventDefault();
  const email = document.getElementById('login-email')?.value;
  const password = document.getElementById('login-senha')?.value;
  const btn = event.submitter || event.target.querySelector('[type=submit]');

  await apiCall(
    () => AuthAPI.login(email, password),
    {
      loadingEl: btn,
      onSuccess: (data) => {
        state.user = data.user;
        showToast(`Bem-vindo, ${data.user.name.split(' ')[0]}! 👋`, 'success');
        if (data.user.role === 'ADMIN_GERAL' || data.user.role === 'ADMIN') navigate('dash-admin');
        else if (data.user.role === 'MONTADOR') navigate('dash-montador');
        else navigate('dash-cliente');
      },
    }
  );
}

/**
 * Cadastro de cliente real
 */
async function doRegisterClienteReal(event) {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('[type=submit]');

  const data = {
    name:     form.querySelector('[name=name]')?.value     || form.querySelectorAll('input[type=text]')[0]?.value,
    email:    form.querySelector('[name=email]')?.value    || form.querySelector('[type=email]')?.value,
    password: form.querySelector('[name=password]')?.value || form.querySelector('[type=password]')?.value,
    phone:    form.querySelector('[name=phone]')?.value    || form.querySelector('[type=tel]')?.value,
    city:     form.querySelector('[name=city]')?.value     || form.querySelectorAll('input[type=text]')[4]?.value,
  };

  await apiCall(
    () => AuthAPI.registerCliente(data),
    {
      loadingEl: btn,
      onSuccess: (res) => {
        if (res.data?.user) state.user = res.data.user;
        showToast('Conta criada com sucesso!', 'success');
        navigate('dash-cliente');
      },
    }
  );
}

/**
 * Recuperação de senha real
 */
async function doForgotPasswordReal(event) {
  event.preventDefault();
  const email = document.getElementById('forgot-email')?.value;
  const btn = event.submitter || event.target.querySelector('[type=submit]');

  await apiCall(
    () => AuthAPI.forgotPassword(email),
    {
      loadingEl: btn,
      onSuccess: () => {
        document.getElementById('forgot-form')?.classList.add('hidden');
        document.getElementById('forgot-success')?.classList.remove('hidden');
      },
    }
  );
}

/**
 * Logout real
 */
async function logoutReal() {
  await AuthAPI.logout();
  state.user = null;
  showToast('Você saiu da conta.', '');
  navigate('home');
}

/**
 * Calcular montagem usando preços reais do backend
 */
async function calcularMontagemReal() {
  const cats = document.querySelectorAll('.servico-categoria');
  const items = Array.from(cats).map(sel => ({
    category: sel.value,
    description: sel.closest('.card')?.querySelector('.servico-desc')?.value || '',
    quantity: 1,
  })).filter(i => i.category);

  if (!items.length) {
    showToast('Selecione ao menos uma categoria de móvel.', 'error');
    return;
  }

  const btn = document.querySelector('#calcular-btn');
  await apiCall(
    () => ServicesAPI.calcularPreco(items),
    {
      loadingEl: btn,
      onSuccess: ({ total, breakdown }) => {
        const itemsEl  = document.getElementById('orcamento-items');
        const totalEl  = document.getElementById('orcamento-total');
        if (itemsEl) itemsEl.innerHTML = breakdown.map(it => `
          <div class="flex justify-between" style="padding:8px 0;border-bottom:1px dashed rgba(255,107,0,.3)">
            <span class="text-muted">${it.category || 'Serviço'}</span>
            <span style="font-weight:600">R$ ${it.estimatedValue.toFixed(2)}</span>
          </div>`).join('');
        if (totalEl) totalEl.textContent = `R$ ${total.toFixed(2)}`;
        showToast(`Orçamento: R$ ${total.toFixed(2)}`, 'success');
        setTimeout(() => {
          if (confirm(`Valor estimado: R$ ${total.toFixed(2)}\n\nProsseguir para o pagamento?`)) {
            navigate('pagamento', { total });
          }
        }, 400);
      },
    }
  );
}

/**
 * Aceitar trabalho (montador) via API real
 */
async function acceptJobReal(serviceId) {
  await apiCall(
    () => ServicesAPI.accept(serviceId),
    {
      successMsg: '✅ Serviço aceito! Cliente notificado via WhatsApp.',
      onSuccess: () => switchTab('overview'),
    }
  );
}

/**
 * Cancelar serviço via API real
 */
async function cancelServiceReal(serviceId, reason = '') {
  if (!confirm('Cancelar este serviço?')) return;
  await apiCall(
    () => ServicesAPI.cancel(serviceId, reason),
    {
      successMsg: 'Serviço cancelado.',
      onSuccess: () => switchTab('services'),
    }
  );
}

/**
 * Confirmar conclusão via API real (dupla confirmação)
 */
async function confirmCompleteReal(serviceId) {
  await apiCall(
    () => ServicesAPI.confirm(serviceId),
    {
      onSuccess: (res) => {
        if (res.data?.bothConfirmed) {
          showToast('✅ Serviço concluído! Pagamento liberado ao montador.', 'success');
          closeModal();
          switchTab('services');
        } else {
          showToast('Confirmação registrada. Aguardando a outra parte.', '');
          closeModal();
        }
      },
    }
  );
}

/**
 * Carregar notificações reais
 */
async function loadNotificationsReal() {
  const res = await apiCall(() => NotificationsAPI.list({ limit: 20 }));
  if (res?.data) {
    state.notifications = res.data.notifications;
    state.unreadCount = res.data.unreadCount;
  }
}

/**
 * Carregar dashboard do cliente via API real
 */
async function loadClienteDashboard() {
  const res = await apiCall(() => ServicesAPI.list({ limit: 10 }));
  if (res?.data) {
    state.services = res.data.services;
  }
  await loadNotificationsReal();
}

/**
 * Carregar dashboard do montador via API real
 */
async function loadMontadorDashboard() {
  const [servicesRes, availableRes] = await Promise.all([
    apiCall(() => ServicesAPI.list({ limit: 10 })),
    apiCall(() => ServicesAPI.available()),
  ]);
  if (availableRes?.data) state.availableJobs = availableRes.data.services;
  if (servicesRes?.data)  state.myJobs = servicesRes.data.services;
}

/**
 * Carregar dashboard admin via API real
 */
async function loadAdminDashboard() {
  const res = await apiCall(() => AdminAPI.dashboard());
  if (res?.data) state.adminDashboard = res.data;
}

/**
 * Toggle IA via API real
 */
async function toggleAIReal(enabled) {
  await apiCall(
    () => AdminAPI.toggleAI(enabled),
    { successMsg: `IA ${enabled ? 'ativada' : 'desativada'}!`, }
  );
  state.aiEnabled = enabled;
}

/**
 * Buscar CEP via ViaCEP (gratuito, sem backend necessário)
 */
async function buscarCEPAPI(cep, callback) {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const data = await res.json();
    if (data.erro) { showToast('CEP não encontrado.', 'error'); return; }
    callback(data);
  } catch {
    showToast('Erro ao buscar CEP.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  EXPORTAR PARA USO GLOBAL
// ══════════════════════════════════════════════════════════════

window.MontaRapidoAPI = {
  auth:          AuthAPI,
  services:      ServicesAPI,
  montadores:    MontadoresAPI,
  payments:      PaymentsAPI,
  reviews:       ReviewsAPI,
  notifications: NotificationsAPI,
  prices:        PricesAPI,
  admin:         AdminAPI,
  token:         TokenManager,

  // Helpers de integração
  initApp,
  apiCall,
  doLoginReal,
  doRegisterClienteReal,
  doForgotPasswordReal,
  logoutReal,
  calcularMontagemReal,
  acceptJobReal,
  cancelServiceReal,
  confirmCompleteReal,
  loadNotificationsReal,
  loadClienteDashboard,
  loadMontadorDashboard,
  loadAdminDashboard,
  toggleAIReal,
  buscarCEPAPI,
};

console.log('✅ MontaRapido API conectada em:', API_CONFIG.BASE_URL);
