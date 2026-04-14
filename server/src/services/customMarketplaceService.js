import fs from 'node:fs/promises';
import path from 'node:path';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { getItemsCatalog } from './catalogService.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const LISTING_ACCOUNT_SIZE = 73;
const LISTING_DISCRIMINATOR = Uint8Array.from([88, 16, 97, 53, 198, 205, 24, 41]);
const MAX_U64 = (1n << 64n) - 1n;

function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  return bs58.encode(bytes);
}

function normalizeWalletAddress(walletAddress) {
  try {
    return new PublicKey(String(walletAddress).trim()).toBase58();
  } catch {
    return null;
  }
}

function normalizePositiveBaseUnits(value, fieldName = 'priceBaseUnits') {
  let raw;
  try {
    raw = BigInt(String(value ?? '').trim());
  } catch {
    throw new Error(`${fieldName} invalide.`);
  }

  if (raw <= 0n || raw > MAX_U64) {
    throw new Error(`${fieldName} invalide.`);
  }

  return raw;
}

function normalizePositiveInteger(value, fieldName = 'quantity') {
  const raw = Number(value);
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`${fieldName} invalide.`);
  }
  return raw;
}

function deriveAssociatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync([
    new PublicKey(owner).toBuffer(),
    new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
    new PublicKey(mint).toBuffer(),
  ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID))[0].toBase58();
}

function deriveListingPda(programId, seller, nftMint) {
  return PublicKey.findProgramAddressSync([
    Buffer.from('listing'),
    new PublicKey(seller).toBuffer(),
    new PublicKey(nftMint).toBuffer(),
  ], new PublicKey(programId))[0].toBase58();
}

function deriveVaultPda(programId, listing) {
  return PublicKey.findProgramAddressSync([
    Buffer.from('vault'),
    new PublicKey(listing).toBuffer(),
  ], new PublicKey(programId))[0].toBase58();
}

function parseListingAccountFromBuffer(raw, pubkey) {
  if (!(raw instanceof Buffer) || raw.length < LISTING_ACCOUNT_SIZE) return null;
  if (!raw.subarray(0, 8).equals(Buffer.from(LISTING_DISCRIMINATOR))) return null;

  const seller = base58Encode(raw.subarray(8, 40));
  const nftMint = base58Encode(raw.subarray(40, 72));

  if (!seller || !nftMint) return null;

  return {
    listing: typeof pubkey === 'string' ? pubkey : null,
    seller,
    nftMint,
    bump: raw[72],
    vault: deriveVaultPda(config.customMarketplaceProgramId, pubkey),
  };
}

function normalizeRegistryRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const listing = normalizeWalletAddress(record.listing);
  const seller = normalizeWalletAddress(record.seller);
  const nftMint = normalizeWalletAddress(record.nftMint || record.shipMint);
  const vault = normalizeWalletAddress(record.vault);
  const sellerTokenAccount = normalizeWalletAddress(record.sellerTokenAccount);
  const priceBaseUnits = normalizePositiveBaseUnits(record.priceBaseUnits, 'priceBaseUnits').toString();
  const quantity = normalizePositiveInteger(record.quantity ?? 1, 'quantity');

  if (!listing || !seller || !nftMint || !vault || !sellerTokenAccount) {
    return null;
  }

  return {
    listing,
    seller,
    nftMint,
    vault,
    sellerTokenAccount,
    priceBaseUnits,
    quantity,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    lastSignature: typeof record.lastSignature === 'string' ? record.lastSignature : '',
  };
}

async function ensureRegistryFile() {
  await fs.mkdir(path.dirname(config.customMarketplaceListingsPath), { recursive: true });
  try {
    await fs.access(config.customMarketplaceListingsPath);
  } catch {
    await fs.writeFile(config.customMarketplaceListingsPath, JSON.stringify({ listings: [] }, null, 2));
  }
}

async function loadListingRegistry() {
  await ensureRegistryFile();
  const raw = await fs.readFile(config.customMarketplaceListingsPath, 'utf8');
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { listings: [] };
  }

  const source = Array.isArray(parsed) ? parsed : parsed?.listings;
  if (!Array.isArray(source)) return [];

  return source
    .map((record) => {
      try {
        return normalizeRegistryRecord(record);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function saveListingRegistry(records) {
  const normalized = records
    .map((record) => {
      try {
        return normalizeRegistryRecord(record);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  await ensureRegistryFile();
  const tempPath = `${config.customMarketplaceListingsPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ listings: normalized }, null, 2));
  await fs.rename(tempPath, config.customMarketplaceListingsPath);
}

async function pruneRegistryAgainstOnChain(onChainListings) {
  const registry = await loadListingRegistry();
  const activeListings = new Set(onChainListings.map((listing) => listing.listing));
  const nextRegistry = registry.filter((record) => activeListings.has(record.listing));

  if (nextRegistry.length !== registry.length) {
    await saveListingRegistry(nextRegistry);
  }

  return nextRegistry;
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

async function fetchAccountInfo(address, encoding = 'base64', rpcEndpoint = config.customMarketplaceRpcEndpoint) {
  return callRpc(rpcEndpoint, 'getAccountInfo', [
    address,
    { commitment: 'confirmed', encoding },
  ]);
}

async function fetchParsedMintInfo(mint, rpcEndpoint = config.customMarketplaceRpcEndpoint) {
  const result = await fetchAccountInfo(mint, 'jsonParsed', rpcEndpoint);
  const info = result?.value?.data?.parsed?.info;
  if (!info) return null;

  return {
    mint: normalizeWalletAddress(mint),
    decimals: Number(info.decimals ?? 0),
    supply: String(info.supply ?? '0'),
  };
}

async function fetchParsedTokenAccount(address, rpcEndpoint = config.customMarketplaceRpcEndpoint) {
  const normalizedAddress = normalizeWalletAddress(address);
  if (!normalizedAddress) return null;

  const result = await fetchAccountInfo(normalizedAddress, 'jsonParsed', rpcEndpoint);
  const info = result?.value?.data?.parsed?.info;
  if (!info?.mint || !info?.owner || !info?.tokenAmount) return null;

  return {
    address: normalizedAddress,
    mint: normalizeWalletAddress(info.mint),
    owner: normalizeWalletAddress(info.owner),
    amount: BigInt(String(info.tokenAmount.amount ?? '0')),
    decimals: Number(info.tokenAmount.decimals ?? 0),
  };
}

async function fetchListingAccount(listing, rpcEndpoint = config.customMarketplaceRpcEndpoint) {
  const normalizedListing = normalizeWalletAddress(listing);
  if (!normalizedListing) return null;

  const result = await fetchAccountInfo(normalizedListing, 'base64', rpcEndpoint);
  const encoded = result?.value?.data?.[0];
  const raw = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
  return raw ? parseListingAccountFromBuffer(raw, normalizedListing) : null;
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

  return (Array.isArray(result) ? result : [])
    .map((account) => {
      const encoded = account?.account?.data?.[0];
      const raw = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
      return raw ? parseListingAccountFromBuffer(raw, account.pubkey) : null;
    })
    .filter(Boolean);
}

async function fetchWalletTokenAccounts(owner, rpcEndpoint = config.walletNftsRpcEndpoint) {
  const result = await callRpc(rpcEndpoint, 'getTokenAccountsByOwner', [
    owner,
    { programId: TOKEN_PROGRAM_ID },
    { commitment: 'confirmed', encoding: 'jsonParsed' },
  ]);

  return Array.isArray(result?.value) ? result.value : [];
}

async function fetchTransaction(signature, rpcEndpoint = config.customMarketplaceRpcEndpoint) {
  return callRpc(rpcEndpoint, 'getTransaction', [
    signature,
    { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ]);
}

async function assertConfirmedTransaction(signature) {
  const normalizedSignature = String(signature || '').trim();
  if (!normalizedSignature) throw new Error('Signature de transaction invalide.');

  const transaction = await fetchTransaction(normalizedSignature);
  if (!transaction) {
    throw new Error('Transaction introuvable ou non confirmee.');
  }

  return transaction;
}

function calculateFee(amount, feeBps) {
  return (amount * BigInt(feeBps)) / 10_000n;
}

function toPrice(baseUnits, decimals = 6) {
  try {
    const raw = BigInt(String(baseUnits ?? '0'));
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    return Number(`${whole}.${fraction.toString().padStart(decimals, '0')}`);
  } catch {
    return null;
  }
}

function extractParsedTokenAmount(info) {
  const direct = info?.tokenAmount?.amount;
  if (direct != null) return String(direct);
  if (info?.amount != null) return String(info.amount);
  return null;
}

function transactionContainsTransferChecked(transaction, { source, destination, authority, mint, amount }) {
  const instructions = transaction?.transaction?.message?.instructions;
  if (!Array.isArray(instructions)) return false;

  return instructions.some((instruction) => {
    const parsed = instruction?.parsed;
    const info = parsed?.info;
    if (parsed?.type !== 'transferChecked' || !info) return false;

    return String(info.source || '') === source
      && String(info.destination || '') === destination
      && String(info.authority || '') === authority
      && String(info.mint || '') === mint
      && extractParsedTokenAmount(info) === String(amount);
  });
}

function mapListingsByMint(rows) {
  const result = new Map();
  for (const row of rows) {
    if (row?.shipMint && !result.has(row.shipMint)) {
      result.set(row.shipMint, row);
    }
  }
  return result;
}

function deriveListingRow(onChainListing, metadata, itemsByMint, cfg) {
  const item = itemsByMint.get(onChainListing.nftMint) || null;
  const priceBaseUnits = metadata?.priceBaseUnits ?? null;

  return {
    listing: onChainListing.listing,
    vault: onChainListing.vault,
    seller: onChainListing.seller,
    shipMint: onChainListing.nftMint,
    shipName: item?.name || 'NFT inconnu',
    shipImage: item?.image || '',
    description: item?.description || '',
    rarity: item?.rarity || null,
    manufacturer: item?.manufacturer || null,
    spec: item?.spec || null,
    size: item?.size || null,
    category: item?.category || null,
    itemType: item?.itemType || null,
    priceBaseUnits,
    quantity: metadata?.quantity ?? 1,
    price: priceBaseUnits ? toPrice(priceBaseUnits, cfg.usdcDecimals) : null,
    quoteSymbol: cfg.quoteSymbol,
    externalFloor: item?.market?.floor ?? null,
    externalFloorQuoteSymbol: item?.market?.floorQuoteSymbol ?? 'USDC',
  };
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
        Number(right.isAssociated) - Number(left.isAssociated)
        || right.quantity - left.quantity
        || left.address.localeCompare(right.address),
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
            quoteSymbol: listing.quoteSymbol,
          }
        : null,
    });
  }

  return items.sort((left, right) => left.name.localeCompare(right.name));
}

function buildStaticMarketplaceConfig() {
  return {
    rpcUrl: config.customMarketplaceRpcEndpoint,
    programId: config.customMarketplaceProgramId,
    usdcMint: config.customMarketplaceUsdcMint,
    treasury: config.customMarketplaceTreasury,
    platformFeeBps: config.customMarketplacePlatformFeeBps,
    quoteSymbol: 'USDC',
    usdcDecimals: config.customMarketplaceUsdcDecimals,
    settlementMode: 'offchain-registry',
  };
}

async function getOnChainListingsAndRegistry() {
  const [onChainListings, registry] = await Promise.all([
    fetchListingAccounts(),
    loadListingRegistry(),
  ]);

  const activeListings = new Set(onChainListings.map((listing) => listing.listing));
  const filteredRegistry = registry.filter((record) => activeListings.has(record.listing));
  if (filteredRegistry.length !== registry.length) {
    await saveListingRegistry(filteredRegistry);
  }

  return { onChainListings, registry: filteredRegistry };
}

function ensureProgramSupportsSingleQuantity(quantity) {
  if (quantity !== 1) {
    throw new Error('Ce programme minimal ne supporte qu un NFT par listing.');
  }
}

export async function getCustomMarketplaceConfigView() {
  return buildStaticMarketplaceConfig();
}

export async function getCustomListings({ owner = null } = {}) {
  const [items, cfg, { onChainListings, registry }] = await Promise.all([
    getItemsCatalog(),
    getCustomMarketplaceConfigView(),
    getOnChainListingsAndRegistry(),
  ]);

  const itemsByMint = new Map(items.map((item) => [item.mint, item]));
  const metadataByListing = new Map(registry.map((record) => [record.listing, record]));
  const ownerFilter = typeof owner === 'string' && owner.trim() ? normalizeWalletAddress(owner) : null;

  const rows = onChainListings
    .filter((listing) => !ownerFilter || listing.seller === ownerFilter)
    .map((listing) => deriveListingRow(listing, metadataByListing.get(listing.listing), itemsByMint, cfg))
    .filter((row) => row.priceBaseUnits)
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
  const activeListingsBySellerMint = mapListingsByMint(listings?.rows || []);

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

export async function prepareCustomMarketplaceListing(payload) {
  const cfg = buildStaticMarketplaceConfig();
  const seller = normalizeWalletAddress(payload?.seller);
  const nftMint = normalizeWalletAddress(payload?.nftMint);
  const sellerTokenAccount = normalizeWalletAddress(payload?.sellerTokenAccount);
  const quantity = normalizePositiveInteger(payload?.quantity ?? 1, 'quantity');
  const priceBaseUnits = normalizePositiveBaseUnits(payload?.priceBaseUnits);

  if (!seller || !nftMint || !sellerTokenAccount) {
    throw new Error('Parametres listing invalides.');
  }

  ensureProgramSupportsSingleQuantity(quantity);

  const listing = deriveListingPda(cfg.programId, seller, nftMint);
  const vault = deriveVaultPda(cfg.programId, listing);

  const [mintInfo, sellerTokenInfo, existingListing, registry] = await Promise.all([
    fetchParsedMintInfo(nftMint, cfg.rpcUrl),
    fetchParsedTokenAccount(sellerTokenAccount, cfg.rpcUrl),
    fetchListingAccount(listing, cfg.rpcUrl),
    loadListingRegistry(),
  ]);

  if (!mintInfo || mintInfo.decimals !== 0) {
    throw new Error('Le mint NFT doit avoir 0 decimales.');
  }

  if (!sellerTokenInfo) {
    throw new Error('Token account vendeur introuvable.');
  }

  if (sellerTokenInfo.owner !== seller || sellerTokenInfo.mint !== nftMint || sellerTokenInfo.amount < 1n) {
    throw new Error('Le vendeur ne detient pas ce NFT sur le token account fourni.');
  }

  if (existingListing) {
    throw new Error('Un listing actif existe deja pour ce vendeur et ce mint.');
  }

  if (registry.some((record) => record.listing === listing)) {
    throw new Error('Le registre hors chaine contient deja ce listing. Nettoie-le avant de relister.');
  }

  return {
    seller,
    nftMint,
    sellerTokenAccount,
    listing,
    vault,
    quantity,
    priceBaseUnits: priceBaseUnits.toString(),
  };
}

export async function confirmCustomMarketplaceListing(payload) {
  const cfg = buildStaticMarketplaceConfig();
  const seller = normalizeWalletAddress(payload?.seller);
  const nftMint = normalizeWalletAddress(payload?.nftMint);
  const sellerTokenAccount = normalizeWalletAddress(payload?.sellerTokenAccount);
  const quantity = normalizePositiveInteger(payload?.quantity ?? 1, 'quantity');
  const priceBaseUnits = normalizePositiveBaseUnits(payload?.priceBaseUnits);

  if (!seller || !nftMint || !sellerTokenAccount) {
    throw new Error('Parametres listing invalides.');
  }

  ensureProgramSupportsSingleQuantity(quantity);

  const listing = deriveListingPda(cfg.programId, seller, nftMint);
  const vault = deriveVaultPda(cfg.programId, listing);
  const transaction = await assertConfirmedTransaction(payload?.signature);
  const [listingAccount, vaultAccount] = await Promise.all([
    fetchListingAccount(listing),
    fetchParsedTokenAccount(vault),
  ]);

  if (!listingAccount || listingAccount.seller !== seller || listingAccount.nftMint !== nftMint) {
    throw new Error('Le compte listing on-chain est absent ou invalide apres listing.');
  }

  if (!vaultAccount || vaultAccount.mint !== nftMint || vaultAccount.owner !== listing || vaultAccount.amount < 1n) {
    throw new Error('Le vault on-chain n a pas recu le NFT attendu.');
  }

  const registry = await loadListingRegistry();
  const nextRecord = normalizeRegistryRecord({
    listing,
    seller,
    nftMint,
    vault,
    sellerTokenAccount,
    quantity,
    priceBaseUnits: priceBaseUnits.toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSignature: String(payload?.signature || ''),
  });

  const nextRegistry = registry.filter((record) => record.listing !== listing);
  nextRegistry.push(nextRecord);
  await saveListingRegistry(nextRegistry);

  return {
    ok: true,
    signature: String(payload?.signature || ''),
    listing,
    vault,
    priceBaseUnits: priceBaseUnits.toString(),
    quantity,
    transactionSlot: transaction.slot ?? null,
  };
}

export async function prepareCustomMarketplaceCancel(payload) {
  const seller = normalizeWalletAddress(payload?.seller);
  const listing = normalizeWalletAddress(payload?.listing);

  if (!seller || !listing) {
    throw new Error('Parametres annulation invalides.');
  }

  const [listingAccount, registry] = await Promise.all([
    fetchListingAccount(listing),
    loadListingRegistry(),
  ]);

  if (!listingAccount) {
    throw new Error('Listing on-chain introuvable.');
  }

  if (listingAccount.seller !== seller) {
    throw new Error('Seul le vendeur peut annuler ce listing.');
  }

  const metadata = registry.find((record) => record.listing === listing) || null;

  return {
    seller,
    listing,
    vault: listingAccount.vault,
    nftMint: listingAccount.nftMint,
    quantity: metadata?.quantity ?? 1,
    priceBaseUnits: metadata?.priceBaseUnits ?? null,
  };
}

export async function confirmCustomMarketplaceCancel(payload) {
  const seller = normalizeWalletAddress(payload?.seller);
  const listing = normalizeWalletAddress(payload?.listing);

  if (!seller || !listing) {
    throw new Error('Parametres annulation invalides.');
  }

  await assertConfirmedTransaction(payload?.signature);

  const listingAccount = await fetchListingAccount(listing);
  if (listingAccount) {
    throw new Error('Le listing est encore actif apres la transaction d annulation.');
  }

  const registry = await loadListingRegistry();
  const existingRecord = registry.find((record) => record.listing === listing) || null;
  if (existingRecord && existingRecord.seller !== seller) {
    throw new Error('Le vendeur de la transaction ne correspond pas au registre du listing.');
  }

  const nextRegistry = registry.filter((record) => record.listing !== listing);
  await saveListingRegistry(nextRegistry);

  return {
    ok: true,
    signature: String(payload?.signature || ''),
    listing,
  };
}

export async function prepareCustomMarketplacePurchase(payload) {
  const cfg = buildStaticMarketplaceConfig();
  const buyer = normalizeWalletAddress(payload?.buyer);
  const listing = normalizeWalletAddress(payload?.listing);

  if (!buyer || !listing) {
    throw new Error('Parametres achat invalides.');
  }

  const [{ onChainListings, registry }, buyerUsdcAta] = await Promise.all([
    getOnChainListingsAndRegistry(),
    fetchParsedTokenAccount(deriveAssociatedTokenAddress(buyer, cfg.usdcMint), cfg.rpcUrl),
  ]);

  const listingAccount = onChainListings.find((entry) => entry.listing === listing) || null;
  const metadata = registry.find((entry) => entry.listing === listing) || null;

  if (!listingAccount || !metadata) {
    throw new Error('Listing actif introuvable ou metadonnees hors chaine manquantes.');
  }

  if (buyer === listingAccount.seller) {
    throw new Error('Le vendeur ne peut pas acheter son propre listing.');
  }

  const priceBaseUnits = normalizePositiveBaseUnits(metadata.priceBaseUnits);
  const quantity = normalizePositiveInteger(metadata.quantity ?? 1, 'quantity');
  ensureProgramSupportsSingleQuantity(quantity);

  if (!buyerUsdcAta || buyerUsdcAta.amount < priceBaseUnits) {
    throw new Error('Solde USDC insuffisant pour cet achat.');
  }

  const sellerUsdcAta = deriveAssociatedTokenAddress(listingAccount.seller, cfg.usdcMint);
  const treasuryUsdcAta = deriveAssociatedTokenAddress(cfg.treasury, cfg.usdcMint);
  const sellerAmountBaseUnits = priceBaseUnits - calculateFee(priceBaseUnits, cfg.platformFeeBps);
  const feeAmountBaseUnits = priceBaseUnits - sellerAmountBaseUnits;

  return {
    buyer,
    seller: listingAccount.seller,
    listing,
    vault: listingAccount.vault,
    nftMint: listingAccount.nftMint,
    quantity,
    priceBaseUnits: priceBaseUnits.toString(),
    buyerUsdcAta: buyerUsdcAta.address,
    sellerUsdcAta,
    treasuryUsdcAta,
    sellerAmountBaseUnits: sellerAmountBaseUnits.toString(),
    feeAmountBaseUnits: feeAmountBaseUnits.toString(),
    usdcMint: cfg.usdcMint,
    usdcDecimals: cfg.usdcDecimals,
    treasury: cfg.treasury,
  };
}

export async function confirmCustomMarketplacePurchase(payload) {
  const cfg = buildStaticMarketplaceConfig();
  const buyer = normalizeWalletAddress(payload?.buyer);
  const listing = normalizeWalletAddress(payload?.listing);

  if (!buyer || !listing) {
    throw new Error('Parametres achat invalides.');
  }

  const transaction = await assertConfirmedTransaction(payload?.signature);
  const registry = await loadListingRegistry();
  const metadata = registry.find((record) => record.listing === listing) || null;

  if (!metadata) {
    throw new Error('Le listing n existe pas dans le registre hors chaine.');
  }

  const priceBaseUnits = normalizePositiveBaseUnits(metadata.priceBaseUnits);
  const feeAmountBaseUnits = calculateFee(priceBaseUnits, cfg.platformFeeBps);
  const sellerAmountBaseUnits = priceBaseUnits - feeAmountBaseUnits;
  const buyerUsdcAta = deriveAssociatedTokenAddress(buyer, cfg.usdcMint);
  const sellerUsdcAta = deriveAssociatedTokenAddress(metadata.seller, cfg.usdcMint);
  const treasuryUsdcAta = deriveAssociatedTokenAddress(cfg.treasury, cfg.usdcMint);

  const hasSellerTransfer = transactionContainsTransferChecked(transaction, {
    source: buyerUsdcAta,
    destination: sellerUsdcAta,
    authority: buyer,
    mint: cfg.usdcMint,
    amount: sellerAmountBaseUnits.toString(),
  });

  const hasFeeTransfer = transactionContainsTransferChecked(transaction, {
    source: buyerUsdcAta,
    destination: treasuryUsdcAta,
    authority: buyer,
    mint: cfg.usdcMint,
    amount: feeAmountBaseUnits.toString(),
  });

  if (!hasSellerTransfer || (feeAmountBaseUnits > 0n && !hasFeeTransfer)) {
    throw new Error('La transaction ne contient pas les transferts USDC attendus vers le vendeur et la plateforme.');
  }

  const [listingAccount, buyerNftAta] = await Promise.all([
    fetchListingAccount(listing, cfg.rpcUrl),
    fetchParsedTokenAccount(deriveAssociatedTokenAddress(buyer, metadata.nftMint), cfg.rpcUrl),
  ]);

  if (listingAccount) {
    throw new Error('Le listing est encore actif apres la transaction d achat.');
  }

  if (!buyerNftAta || buyerNftAta.mint !== metadata.nftMint || buyerNftAta.amount < 1n) {
    throw new Error('Le NFT achete n a pas ete retrouve sur le wallet acheteur.');
  }

  const nextRegistry = registry.filter((record) => record.listing !== listing);
  await saveListingRegistry(nextRegistry);

  return {
    ok: true,
    signature: String(payload?.signature || ''),
    listing,
    slot: transaction.slot ?? null,
  };
}
