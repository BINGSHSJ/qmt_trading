const API_BASE = '/api/v1';

// API Key: 优先 Vite 环境变量，回退到服务端注入
const API_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY)
  || window.__QMT_API_KEY__
  || '';

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {
      code: response.status,
      message: `HTTP ${response.status}`,
      data: null,
    };
  }

  return data;
}

export function apiGet(path) {
  return request(path, { method: 'GET' });
}

export function apiPost(path, body = {}) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export function initSession() {
  return apiPost('/auth/session', {});
}

export async function getWsTicket() {
  const result = await apiGet('/auth/ws-ticket');
  if (result.code === 0 && result.data?.ticket) {
    return result.data.ticket;
  }
  return '';
}
