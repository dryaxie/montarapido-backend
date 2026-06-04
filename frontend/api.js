const API_CONFIG = {
  BASE_URL: 'https://montarapido-api.onrender.com/api',
  TIMEOUT: 15000,
};

// ══ TOKEN ══
const Auth = {
  save: (token, refresh) => {
    sessionStorage.setItem('mr_token', token);
    sessionStorage.setItem('mr_refresh', refresh);
  },
  token: () => sessionStorage.getItem('mr_token'),
  clear: () => sessionStorage.clear(),
  isLogged: () => !!sessionStorage.getItem('mr_token'),
};

// ══ REQUEST ══
async function apiRequest(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${Auth.token()}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_CONFIG.BASE_URL}${path}`, opts);
  const data = await res.json();

  if (!res.ok) throw new Error(data.message || 'Erro na requisição');
  return data;
}

// ══ AUTH ══
const API = {
  login: (email, password) =>
    apiRequest('POST', '/auth/login', { email, password }, false),

  me: () => apiRequest('GET', '/auth/me'),
  me: () => apiRequest('GET', '/auth/me'),
getProfile: () => apiRequest('GET', '/auth/me'),
updateProfile: (dados) => apiRequest('PUT', '/auth/me', dados),
updatePassword: (dados) => apiRequest('PUT', '/auth/password', dados),

  registerCliente: (dados) =>
    apiRequest('POST', '/auth/register/cliente', dados, false),

  registerMontador: (dados) =>
    apiRequest('POST', '/auth/register/montador', dados, false),

  forgotPassword: (email) =>
    apiRequest('POST', '/auth/forgot-password', { email }, false),

  // ══ ADMIN ══
  admin: {
    dashboard: () => apiRequest('GET', '/admin/dashboard'),
    getMontadores: () => apiRequest('GET', '/admin/montadores/pending'),
    getAllMontadores: () => apiRequest('GET', '/montadores'),
    approveMontador: (id) => apiRequest('PATCH', `/admin/montadores/${id}/approve`),
    getAdmins: () => apiRequest('GET', '/admin/admins'),
    createAdmin: (dados) => apiRequest('POST', '/admin/admins', dados),
    updateProfile: (dados) => apiRequest('PUT', '/admin/profile', dados),
    getPriceTable: () => apiRequest('GET', '/admin/price-table'),
    updatePrice: (cat, dados) => apiRequest('PUT', `/admin/price-table/${cat}`, dados),
    getConfig: () => apiRequest('GET', '/admin/config'),
    updateConfig: (key, value) => apiRequest('PUT', `/admin/config/${key}`, { value }),
    getReports: () => apiRequest('GET', '/admin/reports/summary'),
    getUsers: (role) => apiRequest('GET', `/admin/users${role ? `?role=${role}` : ''}`),
    toggleUser: (id) => apiRequest('PATCH', `/admin/users/${id}/toggle-active`),

    addMontador: (dados) => apiRequest('POST', '/admin/montadores', dados),
updateMontador: (id, dados) => apiRequest('PUT', `/admin/montadores/${id}`, dados),
deleteMontador: (id) => apiRequest('DELETE', `/admin/montadores/${id}`),
    deleteAdmin: (id) => apiRequest('DELETE', `/admin/admins/${id}`),
  },

  // ══ SERVIÇOS ══
  services: {
    list: () => apiRequest('GET', '/services'),
    create: (dados) => apiRequest('POST', '/services', dados),
    get: (id) => apiRequest('GET', `/services/${id}`),
    accept: (id) => apiRequest('PATCH', `/services/${id}/accept`),
    confirm: (id) => apiRequest('PATCH', `/services/${id}/confirm`),
    cancel: (id) => apiRequest('PATCH', `/services/${id}/cancel`),
    available: () => apiRequest('GET', '/services/available'),
  },

  // ══ MONTADORES ══
  montadores: {
    list: (params = '') => apiRequest('GET', `/montadores${params}`),
    get: (id) => apiRequest('GET', `/montadores/${id}`),
  },
};
