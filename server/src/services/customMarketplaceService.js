import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { getItemsCatalog } from './catalogService.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const LISTING_ACCOUNT_SIZE = 130;
const LISTING_STATUS_ACTIVE = 0;
const LISTING_DISCRIMINATOR = Uint8Array.from([88, 16, 97, 53, 198, 205, 24, 41]);
const CONFIG_ACCOUNT_DISCRIMINATOR = Uint8Array.from([155, 12, 170, 224, 30, 250, 204, 130]);
const CONFIG_ACCOUNT_SIZE = 139;

function readUnsignedLittleEndian64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const low = view.getUint32(0, true);
  const high = view.getUint32(4, true);
  return low + (high * 4294967296);
}

function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  return bs58.encode(bytes);
}

async function callRpc(rpcEndpoint, method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;

  try {
    response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error.message || 'RPC error');
  return payload?.result ?? null;
}

function parseListingAccount(account) {
  const payload = account?.account?.data;
  const encoded = Array.isArray(payload) ? payload[0] : null;
  if (typeof encoded !== 'string') return null;

  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < LISTING_ACCOUNT_SIZE) return null;
  if (!raw.subarray(0, 8).equals(Buffer.from(LISTING_DISCRIMINATOR))) return null;

  return {
    listing: typeof account?.pubkey === 'string' ? account.pubkey : null,
    seller: base58Encode(raw.subarray(8, 40)),
    nftMint: base58Encode(raw.subarray(40, 72)),
    vault: base58Encode(raw.subarray(72, 104)),
    priceBaseUnits: readUnsignedLittleEndian64(raw.subarray(104, 112)),
    quantity: readUnsignedLittleEndian64(raw.subarray(112, 120)),
    listingNonce: readUnsignedLittleEndian64(raw.subarray(120, 128)),
    status: raw[128],
    bump: raw[129],
  };
}

function parseConfigAccount(raw) {
  if (!(raw instanceof Buffer) || raw.length < CONFIG_ACCOUNT_SIZE) return null;
  if (!raw.subarray(0, 8).equals(Buffer.from(CONFIG_ACCOUNT_DISCRIMINATOR))) return null;

  return {
    authority: base58Encode(raw.subarray(8, 40)),
    backendAuthority: base58Encode(raw.subarray(40, 72)),
    treasury: base58Encode(raw.subarray(72, 104)),
    usdcMint: base58Encode(raw.subarray(104, 136)),
    platformFeeBps: raw.readUInt16LE(136),
    bump: raw[138],
  };
}

function deriveConfigPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(programId))[0].toBase58();
}

async function fetchCustomMarketplaceConfig() {
  const programId = config.customMarketplaceProgramId;
  const rpcUrl = config.customMarketplaceRpcEndpoint;
  const configPda = deriveConfigPda(programId);

  const result = await callRpc(rpcUrl, 'getAccountInfo', [
    configPda,
    { commitment: 'confirmed', encoding: 'base64' },
  ]);

  const encoded = result?.value?.data?.[0];
  const raw = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
  const decoded = raw ? parseConfigAccount(raw) : null;

  return {
    rpcUrl,
    programId,
    configPda,
    usdcMint: decoded?.usdcMint || config.customMarketplaceUsdcMint,
    treasury: decoded?.treasury || config.customMarketplaceTreasury,
    platformFeeBps: decoded?.platformFeeBps ?? 500,
    quoteSymbol: 'USDC',
    usdcDecimals: 6,
  };
}

async function fetchListingAccounts() {
  const bytes = bs58.encode(Buffer.from(LISTING_DISCRIMINATOR));
  const result = await callRpc(config.customMarketplaceRpcEndpoint, 'getProgramAccounts', [
    config.customMarketplaceProgramId,
    {
      commitment: 'confirmed',
      encoding: 'base64',
      filters: [
        { dataSize: LISTING_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes } },
      ],
    },
  ]);

  return Array.isArray(result) ? result : [];
}

function toPrice(baseUnits, decimals = 6) {
  if (typeof baseUnits !== 'number' || !Number.isFinite(baseUnits)) return null;
  return Number((baseUnits / (10 ** decimals)).toFixed(decimals));
}

function deriveAssociatedTokenAddress(owner, mint) {
  try {
    return PublicKey.findProgramAddressSync([
      new PublicKey(owner).toBuffer(),
      new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID))[0].toBase58();
  } catch {
    return null;
  }
}

function normalizeWalletNfts(owner, tokenAccounts, itemsByMint, activeListingsBySellerMint) {
  const aggregated = new Map();

  for (const account of Array.isArray(tokenAccounts) ? tokenAccounts : []) {
    const tokenAccountAddress = typeof account?.pubkey === 'string' ? account.pubkey : null;
    const parsed = account?.account?.data?.parsed?.info;
    const mint = parsed?.mint;
    const tokenAmount = parsed?.tokenAmount;
    const amount = Number(tokenAmount?.amount || 0);
    const decimals = Number(tokenAmount?.decimals || 0);

    if (typeof mint !== 'string' || !mint.trim()) continue;
    if (typeof tokenAccountAddress !== 'string' || !tokenAccountAddress.trim()) continue;
    if (amount < 1 || decimals !== 0) continue;

    const current = aggregated.get(mint) || { quantity: 0, tokenAccounts: [] };
    current.quantity += amount;
    current.tokenAccounts.push({ address: tokenAccountAddress, quantity: amount });
    aggregated.set(mint, current);
  }

  const items = [];

  for (const [mint, aggregate] of aggregated.entries()) {
    const quantity = aggregate.quantity;
    const item = itemsByMint.get(mint) || null;
    const listing = activeListingsBySellerMint.get(mint) || null;
    const associatedTokenAccount = deriveAssociatedTokenAddress(owner, mint);
    const tokenAccounts = aggregate.tokenAccounts
      .map((entry) => ({
        ...entry,
        isAssociated: associatedTokenAccount === entry.address,
      }))
      .sort((left, right) =>
        Number(right.isAssociated) - Number(left.isAssociated) ||
        right.quantity - left.quantity ||
        left.address.localeCompare(right.address),
      );
    const preferredSource = tokenAccounts[0] || null;
    const maxListableQuantity = tokenAccounts.reduce(
      (max, entry) => Math.max(max, entry.quantity || 0),
      0,
    );

    items.push({
      mint,
      quantity,
      tokenAccounts,
      sourceTokenAccount: preferredSource?.address || null,
      sourceQuantity: preferredSource?.quantity || 0,
      maxListableQuantity,
      name: item?.name || 'NFT inconnu',
      image: item?.image || '',
      description: item?.description || '',
      faction: item?.faction || null,
      rarity: item?.rarity || null,
      manufacturer: item?.manufacturer || null,
      category: item?.category || null,
      itemType: item?.itemType || null,
      spec: item?.spec || null,
      size: item?.size || null,
      market: item?.market || null,
      listed: Boolean(listing),
      listing: listing
        ? {
            listing: listing.listing,
            vault: listing.vault,
            price: listing.price,
            priceBaseUnits: listing.priceBaseUnits,
            quantity: listing.quantity,
            listingNonce: listing.listingNonce,
            quoteSymbol: 'USDC',
          }
        : null,
    });
  }

  return items.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeWalletAddress(walletAddress) {
  try {
    return new PublicKey(String(walletAddress).trim()).toBase58();
  } catch {
    return null;
  }
}

async function fetchWalletTokenAccounts(owner, rpcEndpoint = config.walletNftsRpcEndpoint) {
  const result = await callRpc(rpcEndpoint, 'getTokenAccountsByOwner', [
    owner,
    { programId: TOKEN_PROGRAM_ID },
    { commitment: 'confirmed', encoding: 'jsonParsed' },
  ]);

  return Array.isArray(result?.value) ? result.value : [];
}

export async function getCustomMarketplaceConfigView() {
  return fetchCustomMarketplaceConfig();
}

export async function getCustomListings({ owner = null } = {}) {
  const [items, cfg, accounts] = await Promise.all([
    getItemsCatalog(),
    fetchCustomMarketplaceConfig(),
    fetchListingAccounts(),
  ]);

  const itemsByMint = new Map(items.map((item) => [item.mint, item]));
  const ownerFilter = typeof owner === 'string' && owner.trim() ? owner.trim() : null;

  const rows = accounts
    .map(parseListingAccount)
    .filter(Boolean)
    .filter((listing) => listing.status === LISTING_STATUS_ACTIVE)
    .filter((listing) => !ownerFilter || listing.seller === ownerFilter)
    .map((listing) => {
      const item = itemsByMint.get(listing.nftMint) || null;
      return {
        listing: listing.listing,
        vault: listing.vault,
        seller: listing.seller,
        shipMint: listing.nftMint,
        shipName: item?.name || 'NFT inconnu',
        shipImage: item?.image || '',
        description: item?.description || '',
        rarity: item?.rarity || null,
        manufacturer: item?.manufacturer || null,
        spec: item?.spec || null,
        size: item?.size || null,
        category: item?.category || null,
        itemType: item?.itemType || null,
        priceBaseUnits: listing.priceBaseUnits,
        quantity: listing.quantity,
        listingNonce: listing.listingNonce,
        price: toPrice(listing.priceBaseUnits, cfg.usdcDecimals),
        quoteSymbol: cfg.quoteSymbol,
        externalFloor: item?.market?.floor ?? null,
        externalFloorQuoteSymbol: item?.market?.floorQuoteSymbol ?? 'USDC',
      };
    })
    .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER) || left.shipName.localeCompare(right.shipName));

  return { rows, config: cfg };
}

async function getWalletNftsForRpc(walletAddress, rpcEndpoint) {
  const owner = normalizeWalletAddress(walletAddress);
  if (!owner) {
    return { wallet: String(walletAddress || ''), items: [] };
  }

  const [itemsResult, listingsResult, tokenAccountsResult] = await Promise.allSettled([
    getItemsCatalog(),
    getCustomListings({ owner }),
    fetchWalletTokenAccounts(owner, rpcEndpoint),
  ]);

  const items = itemsResult.status === 'fulfilled' ? itemsResult.value : [];
  const listings = listingsResult.status === 'fulfilled' ? listingsResult.value : { rows: [] };
  const tokenAccounts = tokenAccountsResult.status === 'fulfilled' ? tokenAccountsResult.value : [];

  const itemsByMint = new Map(items.map((item) => [item.mint, item]));
  const activeListingsBySellerMint = new Map((listings?.rows || []).map((row) => [row.shipMint, row]));

  return {
    wallet: owner,
    items: normalizeWalletNfts(owner, tokenAccounts, itemsByMint, activeListingsBySellerMint),
    partial: itemsResult.status !== 'fulfilled' || listingsResult.status !== 'fulfilled' || tokenAccountsResult.status !== 'fulfilled',
  };
}

export async function getWalletNfts(walletAddress) {
  return getWalletNftsForRpc(walletAddress, config.walletNftsRpcEndpoint);
}

export async function getDevnetWalletNfts(walletAddress) {
  return getWalletNftsForRpc(walletAddress, config.customMarketplaceRpcEndpoint);
}
