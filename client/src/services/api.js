function resolveApiBase() {
  const rawBase = String(import.meta.env.VITE_API_BASE || '/api').trim();

  if (!rawBase) {
    return '/api';
  }

  if (/^https?:\/\//i.test(rawBase)) {
    return rawBase.replace(/\/+$/, '');
  }

  const normalizedPath = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
  return normalizedPath.replace(/\/+$/, '');
}

const API_BASE = resolveApiBase();

async function request(path, init = undefined) {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

export const api = {
  getShips(sort = 'name') {
    return request(`/ships?sort=${encodeURIComponent(sort)}`);
  },
  getShip(mint, sort = 'name') {
    return request(`/ships/${encodeURIComponent(mint)}?sort=${encodeURIComponent(sort)}`);
  },
  getSellers(page = 1, perPage = 25, mode = 'all') {
    return request(`/orders/sellers?page=${page}&perPage=${perPage}&mode=${encodeURIComponent(mode)}`);
  },
  getMarketplaceConfig() {
    return request('/marketplace/config');
  },
  getMarketplaceListings(owner = '') {
    const suffix = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    return request(`/marketplace/listings${suffix}`);
  },
  getWalletNfts(address) {
    return request(`/wallet/${encodeURIComponent(address)}/nfts`);
  },
};
