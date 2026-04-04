const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`);
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
};
