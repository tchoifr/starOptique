import {
  getShipDetail,
  getShipsSummary,
  getSellersPage,
} from '../../server/src/services/marketService.js';
import {
  confirmCustomMarketplaceCancel,
  confirmCustomMarketplaceListing,
  confirmCustomMarketplacePurchase,
  getCustomListings,
  getCustomMarketplaceConfigView,
  getWalletNfts,
  prepareCustomMarketplaceCancel,
  prepareCustomMarketplaceListing,
  prepareCustomMarketplacePurchase,
} from '../../server/src/services/customMarketplaceService.js';

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  };
}

function normalizePath(event) {
  const rawPath = event.path || '';
  return rawPath
    .replace(/^\/\.netlify\/functions\/api/, '/api')
    .replace(/\/+$/, '') || '/api';
}

function body(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch {
    return {};
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  const path = normalizePath(event);
  const query = event.queryStringParameters || {};

  try {
    if (event.httpMethod === 'GET' && path === '/api/health') {
      return json(200, { ok: true });
    }

    if (event.httpMethod === 'GET' && path === '/api/ships') {
      const sort = query.sort === 'rarity' ? 'rarity' : 'name';
      return json(200, await getShipsSummary(sort));
    }

    if (event.httpMethod === 'GET' && path.startsWith('/api/ships/')) {
      const sort = query.sort === 'rarity' ? 'rarity' : 'name';
      const mint = decodeURIComponent(path.slice('/api/ships/'.length));
      const data = await getShipDetail(mint, sort);
      return data ? json(200, data) : json(404, { error: 'Ship not found' });
    }

    if (event.httpMethod === 'GET' && path === '/api/orders/sellers') {
      const page = Number(query.page || 1);
      const perPage = Number(query.perPage || 25);
      const mode = query.mode === 'lowest-per-ship' ? 'lowest-per-ship' : 'all';
      return json(200, await getSellersPage(page, perPage, mode));
    }

    if (event.httpMethod === 'GET' && path === '/api/marketplace/config') {
      return json(200, await getCustomMarketplaceConfigView());
    }

    if (event.httpMethod === 'GET' && path === '/api/marketplace/listings') {
      const owner = typeof query.owner === 'string' ? query.owner : null;
      return json(200, await getCustomListings({ owner }));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/listings/prepare') {
      return json(200, await prepareCustomMarketplaceListing(body(event)));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/listings/confirm') {
      return json(200, await confirmCustomMarketplaceListing(body(event)));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/cancel/prepare') {
      return json(200, await prepareCustomMarketplaceCancel(body(event)));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/cancel/confirm') {
      return json(200, await confirmCustomMarketplaceCancel(body(event)));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/purchase/prepare') {
      return json(200, await prepareCustomMarketplacePurchase(body(event)));
    }

    if (event.httpMethod === 'POST' && path === '/api/marketplace/purchase/confirm') {
      return json(200, await confirmCustomMarketplacePurchase(body(event)));
    }

    const walletNftsMatch = path.match(/^\/api\/wallet\/([^/]+)\/nfts$/);
    if (event.httpMethod === 'GET' && walletNftsMatch) {
      return json(200, await getWalletNfts(decodeURIComponent(walletNftsMatch[1])));
    }

    return json(404, { error: 'API route not found' });
  } catch (error) {
    return json(500, { error: error.message || 'Internal Error' });
  }
}
