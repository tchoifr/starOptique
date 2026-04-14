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
  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      // Ignore non-JSON error responses and keep the HTTP fallback message.
    }
    throw new Error(message);
  }
  return response.json();
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
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
  prepareMarketplaceListing(payload) {
    return post('/marketplace/listings/prepare', payload);
  },
  confirmMarketplaceListing(payload) {
    return post('/marketplace/listings/confirm', payload);
  },
  prepareMarketplaceCancel(payload) {
    return post('/marketplace/cancel/prepare', payload);
  },
  confirmMarketplaceCancel(payload) {
    return post('/marketplace/cancel/confirm', payload);
  },
  prepareMarketplacePurchase(payload) {
    return post('/marketplace/purchase/prepare', payload);
  },
  confirmMarketplacePurchase(payload) {
    return post('/marketplace/purchase/confirm', payload);
  },
  getWalletNfts(address) {
    return request(`/wallet/${encodeURIComponent(address)}/nfts`);
  },
  getDevnetWalletNfts(address) {
    return request(`/wallet/${encodeURIComponent(address)}/devnet-nfts`);
  },
};
