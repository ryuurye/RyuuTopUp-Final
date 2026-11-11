const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function api(path, { token, method = 'GET', body } = {}) {
  if (!API_BASE) throw new Error('VITE_API_BASE_URL belum diatur di Netlify.');
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
  return data;
}

export function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}
