import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';
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
const PREPARE_LIST_NFT_DISCRIMINATOR = Uint8Array.from([35, 214, 106, 153, 248, 118, 244, 222]);
const FINALIZE_LIST_NFT_DISCRIMINATOR = Uint8Array.from([64, 9, 0, 144, 204, 203, 72, 180]);
const PREPARE_BUY_NFT_DISCRIMINATOR = Uint8Array.from([28, 238, 76, 162, 81, 137, 48, 141]);
const FINALIZE_BUY_NFT_DISCRIMINATOR = Uint8Array.from([206, 31, 84, 174, 58, 237, 178, 173]);
const PREPARE_CANCEL_NFT_LISTING_DISCRIMINATOR = Uint8Array.from([191, 66, 14, 20, 41, 170, 157, 25]);
const FINALIZE_CANCEL_NFT_LISTING_DISCRIMINATOR = Uint8Array.from([56, 66, 126, 229, 204, 252, 192, 182]);
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const USDC_DECIMALS = 6;
const NFT_DECIMALS = 0;

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

function calculateFeeBaseUnits(amount, feeBps) {
  const rawAmount = typeof amount === 'bigint' ? amount : BigInt(String(amount ?? '').trim());
  const rawFeeBps = BigInt(String(feeBps ?? 0));
  return (rawAmount * rawFeeBps) / 10000n;
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
  const rawTransaction = signed.serialize();
  const signedSignature = signed.signature ? bs58.encode(signed.signature) : null;
  let signature;

  try {
    signature = await connection.sendRawTransaction(rawTransaction);
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('already been processed') || !signedSignature) {
      throw error;
    }
    signature = signedSignature;
  }

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
  const programId = new PublicKey(marketConfig.programId);

  const prepareIx = new TransactionInstruction({
    programId,
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
      PREPARE_LIST_NFT_DISCRIMINATOR,
      encodeU64(priceBaseUnits),
      encodeU64(quantity),
      encodeU64(listingNonce),
    ),
  });

  const transferIx = createTransferCheckedInstruction(
    sellerNftAta,
    mint,
    vaultPda,
    publicKey,
    quantity,
    NFT_DECIMALS,
    [],
    TOKEN_PROGRAM_ID,
  );

  const finalizeIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: listingPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: sellerNftAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: concatBytes(
      FINALIZE_LIST_NFT_DISCRIMINATOR,
      encodeU64(priceBaseUnits),
      encodeU64(quantity),
      encodeU64(listingNonce),
    ),
  });

  return signAndSend(connection, provider, [prepareIx, transferIx, finalizeIx]);
}

export async function buyNftWithPhantom({ nftMint, seller, listing, vault, priceBaseUnits, quantity }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const mint = new PublicKey(nftMint);
  const sellerPk = new PublicKey(seller);
  const listingPda = new PublicKey(listing);
  const vaultPda = new PublicKey(vault);
  const grossPrice = typeof priceBaseUnits === 'bigint'
    ? priceBaseUnits
    : BigInt(String(priceBaseUnits ?? '').trim());
  const listingQuantity = typeof quantity === 'bigint'
    ? quantity
    : BigInt(String(quantity ?? '').trim());
  const feeAmount = calculateFeeBaseUnits(grossPrice, marketConfig.platformFeeBps ?? 0);
  const sellerAmount = grossPrice - feeAmount;

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
  const sellerUsdcAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: sellerPk,
    mint: marketConfig.usdcMint,
  });
  const platformFeeAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: new PublicKey(marketConfig.treasury),
    mint: marketConfig.usdcMint,
  });

  const instructions = [];
  if (buyerNftAtaResult.instruction) instructions.push(buyerNftAtaResult.instruction);
  if (buyerUsdcAtaResult.instruction) instructions.push(buyerUsdcAtaResult.instruction);
  if (sellerUsdcAtaResult.instruction) instructions.push(sellerUsdcAtaResult.instruction);
  if (platformFeeAtaResult.instruction) instructions.push(platformFeeAtaResult.instruction);

  if (sellerAmount > 0n) {
    instructions.push(
      createTransferCheckedInstruction(
        buyerUsdcAtaResult.ata,
        new PublicKey(marketConfig.usdcMint),
        sellerUsdcAtaResult.ata,
        publicKey,
        sellerAmount,
        USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  if (feeAmount > 0n) {
    instructions.push(
      createTransferCheckedInstruction(
        buyerUsdcAtaResult.ata,
        new PublicKey(marketConfig.usdcMint),
        platformFeeAtaResult.ata,
        publicKey,
        feeAmount,
        USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(marketConfig.programId),
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: sellerPk, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(marketConfig.configPda), isSigner: false, isWritable: false },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: buyerUsdcAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: sellerUsdcAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: platformFeeAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(marketConfig.usdcMint), isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: PREPARE_BUY_NFT_DISCRIMINATOR,
    }),
  );

  instructions.push(
    createTransferCheckedInstruction(
      vaultPda,
      mint,
      buyerNftAtaResult.ata,
      publicKey,
      listingQuantity,
      NFT_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(marketConfig.programId),
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: sellerPk, isSigner: false, isWritable: true },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: buyerNftAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: FINALIZE_BUY_NFT_DISCRIMINATOR,
    }),
  );

  return signAndSend(connection, provider, instructions);
}

export async function cancelNftListingWithPhantom({ nftMint, listing, vault, quantity }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const mint = new PublicKey(nftMint);
  const listingPda = new PublicKey(listing);
  const vaultPda = new PublicKey(vault);
  const listingQuantity = typeof quantity === 'bigint'
    ? quantity
    : BigInt(String(quantity ?? '').trim());
  const sellerNftAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: publicKey,
    mint,
  });

  const instructions = [];
  if (sellerNftAtaResult.instruction) instructions.push(sellerNftAtaResult.instruction);

  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(marketConfig.programId),
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: PREPARE_CANCEL_NFT_LISTING_DISCRIMINATOR,
    }),
  );

  instructions.push(
    createTransferCheckedInstruction(
      vaultPda,
      mint,
      sellerNftAtaResult.ata,
      publicKey,
      listingQuantity,
      NFT_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(marketConfig.programId),
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: listingPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: sellerNftAtaResult.ata, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: FINALIZE_CANCEL_NFT_LISTING_DISCRIMINATOR,
    }),
  );

  return signAndSend(connection, provider, instructions);
}
