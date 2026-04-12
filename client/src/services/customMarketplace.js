import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { api } from './api.js';
import { connectPhantom } from './phantom.js';

const textEncoder = new TextEncoder();
const LIST_NFT_DISCRIMINATOR = Uint8Array.from([88, 221, 93, 166, 63, 220, 106, 232]);
const BUY_NFT_DISCRIMINATOR = Uint8Array.from([96, 0, 28, 190, 49, 107, 83, 222]);
const CANCEL_NFT_LISTING_DISCRIMINATOR = Uint8Array.from([146, 116, 90, 64, 207, 127, 251, 28]);

function concatBytes(...arrays) {
  const length = arrays.reduce((sum, bytes) => sum + bytes.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const bytes of arrays) {
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

function encodeU64(value) {
  const raw = typeof value === 'bigint' ? value : BigInt(String(value ?? '').trim());
  if (raw <= 0n) throw new Error('Expected positive u64 value.');
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, raw, true);
  return bytes;
}

function deriveListingPdas(programId, seller, nftMint, listingNonce) {
  const programPk = new PublicKey(programId);
  const sellerPk = new PublicKey(seller);
  const mintPk = new PublicKey(nftMint);
  const nonceBytes = encodeU64(listingNonce);

  const [listingPda] = PublicKey.findProgramAddressSync(
    [textEncoder.encode('listing'), sellerPk.toBuffer(), mintPk.toBuffer(), nonceBytes],
    programPk,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [textEncoder.encode('listing-vault'), listingPda.toBuffer()],
    programPk,
  );

  return { listingPda, vaultPda };
}

async function resolveContext() {
  const { provider, publicKey } = await connectPhantom();
  if (!publicKey) throw new Error('Unable to retrieve Phantom public key.');

  const marketConfig = await api.getMarketplaceConfig();
  const connection = new Connection(marketConfig.rpcUrl, 'confirmed');

  return {
    provider,
    publicKey,
    marketConfig,
    connection,
  };
}

async function signAndSend(connection, provider, instructions) {
  const tx = new Transaction();
  instructions.forEach((instruction) => tx.add(instruction));
  tx.feePayer = provider.publicKey;

  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;

  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  return signature;
}

async function ensureAta({ connection, payer, owner, mint }) {
  const ata = await getAssociatedTokenAddress(
    new PublicKey(mint),
    new PublicKey(owner),
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (info) {
    return { ata, instruction: null };
  }

  const instruction = createAssociatedTokenAccountInstruction(
    new PublicKey(payer),
    ata,
    new PublicKey(owner),
    new PublicKey(mint),
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return { ata, instruction };
}

async function resolveSellerTokenAccount({ mint, owner, sellerTokenAccount = null }) {
  if (sellerTokenAccount) {
    return new PublicKey(sellerTokenAccount);
  }

  return getAssociatedTokenAddress(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export async function listNftWithPhantom({
  nftMint,
  priceBaseUnits,
  quantity,
  listingNonce = BigInt(Date.now()),
  sellerTokenAccount = null,
}) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const seller = publicKey.toBase58();
  const mint = new PublicKey(nftMint);
  const { listingPda, vaultPda } = deriveListingPdas(
    marketConfig.programId,
    seller,
    mint.toBase58(),
    listingNonce,
  );
  const sellerNftAta = await resolveSellerTokenAccount({
    mint,
    owner: publicKey,
    sellerTokenAccount,
  });

  const instruction = new TransactionInstruction({
    programId: new PublicKey(marketConfig.programId),
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: sellerNftAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: concatBytes(
      LIST_NFT_DISCRIMINATOR,
      encodeU64(priceBaseUnits),
      encodeU64(quantity),
      encodeU64(listingNonce),
    ),
  });

  return signAndSend(connection, provider, [instruction]);
}

export async function buyNftWithPhantom({ nftMint, seller, listing, vault }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const mint = new PublicKey(nftMint);
  const sellerPk = new PublicKey(seller);
  const listingPda = new PublicKey(listing);
  const vaultPda = new PublicKey(vault);

  const buyerNftAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: publicKey,
    mint,
  });
  const buyerUsdcAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: publicKey,
    mint: marketConfig.usdcMint,
  });
  const sellerUsdcAta = await getAssociatedTokenAddress(
    new PublicKey(marketConfig.usdcMint),
    sellerPk,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const platformFeeAccount = await getAssociatedTokenAddress(
    new PublicKey(marketConfig.usdcMint),
    new PublicKey(marketConfig.treasury),
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const instructions = [];
  if (buyerNftAtaResult.instruction) instructions.push(buyerNftAtaResult.instruction);
  if (buyerUsdcAtaResult.instruction) instructions.push(buyerUsdcAtaResult.instruction);
  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(marketConfig.programId),
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: sellerPk, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(marketConfig.configPda), isSigner: false, isWritable: false },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: buyerNftAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: buyerUsdcAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: sellerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: platformFeeAccount, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(marketConfig.usdcMint), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: BUY_NFT_DISCRIMINATOR,
    }),
  );

  return signAndSend(connection, provider, instructions);
}

export async function cancelNftListingWithPhantom({ nftMint, listing, vault }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const mint = new PublicKey(nftMint);
  const listingPda = new PublicKey(listing);
  const vaultPda = new PublicKey(vault);
  const sellerNftAta = await getAssociatedTokenAddress(mint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const instruction = new TransactionInstruction({
    programId: new PublicKey(marketConfig.programId),
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: sellerNftAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CANCEL_NFT_LISTING_DISCRIMINATOR,
  });

  return signAndSend(connection, provider, [instruction]);
}
