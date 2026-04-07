import { Router } from 'express';
import { getShipDetail, getShipsSummary, getSellersPage } from '../services/marketService.js';
import {
  getCustomListings,
  getCustomMarketplaceConfigView,
  getWalletNfts,
} from '../services/customMarketplaceService.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.get('/ships', async (req, res, next) => {
  try {
    const sort = req.query.sort === 'rarity' ? 'rarity' : 'name';
    res.json(await getShipsSummary(sort));
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/ships/:mint', async (req, res, next) => {
  try {
    const sort = req.query.sort === 'rarity' ? 'rarity' : 'name';
    const data = await getShipDetail(req.params.mint, sort);
    if (!data) return res.status(404).json({ error: 'Ship not found' });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/orders/sellers', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const perPage = Number(req.query.perPage || 25);
    const mode = req.query.mode === 'lowest-per-ship' ? 'lowest-per-ship' : 'all';
    res.json(await getSellersPage(page, perPage, mode));
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/marketplace/config', async (_req, res, next) => {
  try {
    res.json(await getCustomMarketplaceConfigView());
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/marketplace/listings', async (req, res, next) => {
  try {
    const owner = typeof req.query.owner === 'string' ? req.query.owner : null;
    res.json(await getCustomListings({ owner }));
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/wallet/:address/nfts', async (req, res, next) => {
  try {
    res.json(await getWalletNfts(req.params.address));
  } catch (error) {
    next(error);
  }
});
