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

async function anchorDiscriminator(name) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(`global:${name}`));
  return new Uint8Array(digest).slice(0, 8);
}

async function buildInstructionData(name) {
  return anchorDiscriminator(name);
}

function deriveListingPdas(programId, seller, nftMint) {
  const programPk = new PublicKey(programId);
  const sellerPk = new PublicKey(seller);
  const mintPk = new PublicKey(nftMint);

  const [listingPda] = PublicKey.findProgramAddressSync(
    [textEncoder.encode('listing'), sellerPk.toBuffer(), mintPk.toBuffer()],
    programPk,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [textEncoder.encode('vault'), listingPda.toBuffer()],
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

async function ensureAta({ connection, payer, owner, mint, allowOwnerOffCurve = false }) {
  const ata = await getAssociatedTokenAddress(
    new PublicKey(mint),
    new PublicKey(owner),
    allowOwnerOffCurve,
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
  sellerTokenAccount = null,
}) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const seller = publicKey.toBase58();
  const mint = new PublicKey(nftMint);
  const sellerNftAta = await resolveSellerTokenAccount({
    mint,
    owner: publicKey,
    sellerTokenAccount,
  });

  const prepared = await api.prepareMarketplaceListing({
    seller,
    nftMint: mint.toBase58(),
    priceBaseUnits: String(priceBaseUnits),
    quantity: String(quantity),
    sellerTokenAccount: sellerNftAta.toBase58(),
  });

  const { listingPda, vaultPda } = deriveListingPdas(
    marketConfig.programId,
    prepared.seller,
    prepared.nftMint,
  );

  if (listingPda.toBase58() !== prepared.listing || vaultPda.toBase58() !== prepared.vault) {
    throw new Error('Les PDAs calcules localement ne correspondent pas au backend.');
  }

  const listIx = new TransactionInstruction({
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
    data: await buildInstructionData('list_nft'),
  });

  const signature = await signAndSend(connection, provider, [listIx]);
  await api.confirmMarketplaceListing({
    ...prepared,
    signature,
  });
  return signature;
}

export async function buyNftWithPhantom({ listing }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const buyer = publicKey.toBase58();
  const prepared = await api.prepareMarketplacePurchase({ buyer, listing });
  const mint = new PublicKey(prepared.nftMint);
  const usdcMint = new PublicKey(prepared.usdcMint);

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
    mint: usdcMint,
  });
  const sellerUsdcAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: new PublicKey(prepared.seller),
    mint: usdcMint,
  });
  const treasuryAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: new PublicKey(prepared.treasury),
    mint: usdcMint,
  });

  if (sellerUsdcAtaResult.ata.toBase58() !== prepared.sellerUsdcAta) {
    throw new Error('Le token account USDC vendeur ne correspond pas au backend.');
  }

  if (treasuryAtaResult.ata.toBase58() !== prepared.treasuryUsdcAta) {
    throw new Error('Le token account USDC plateforme ne correspond pas au backend.');
  }

  const instructions = [];
  if (buyerNftAtaResult.instruction) instructions.push(buyerNftAtaResult.instruction);
  if (buyerUsdcAtaResult.instruction) instructions.push(buyerUsdcAtaResult.instruction);
  if (sellerUsdcAtaResult.instruction) instructions.push(sellerUsdcAtaResult.instruction);
  if (treasuryAtaResult.instruction) instructions.push(treasuryAtaResult.instruction);

  const sellerAmount = BigInt(prepared.sellerAmountBaseUnits);
  const feeAmount = BigInt(prepared.feeAmountBaseUnits);

  if (sellerAmount > 0n) {
    instructions.push(createTransferCheckedInstruction(
      buyerUsdcAtaResult.ata,
      usdcMint,
      sellerUsdcAtaResult.ata,
      publicKey,
      sellerAmount,
      Number(prepared.usdcDecimals),
      [],
      TOKEN_PROGRAM_ID,
    ));
  }

  if (feeAmount > 0n) {
    instructions.push(createTransferCheckedInstruction(
      buyerUsdcAtaResult.ata,
      usdcMint,
      treasuryAtaResult.ata,
      publicKey,
      feeAmount,
      Number(prepared.usdcDecimals),
      [],
      TOKEN_PROGRAM_ID,
    ));
  }

  instructions.push(new TransactionInstruction({
    programId: new PublicKey(marketConfig.programId),
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(prepared.seller), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(prepared.listing), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(prepared.vault), isSigner: false, isWritable: true },
      { pubkey: buyerNftAtaResult.ata, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: await buildInstructionData('buy_nft'),
  }));

  const signature = await signAndSend(connection, provider, instructions);
  await api.confirmMarketplacePurchase({
    buyer,
    listing: prepared.listing,
    signature,
  });
  return signature;
}

export async function cancelNftListingWithPhantom({ listing }) {
  const { provider, publicKey, marketConfig, connection } = await resolveContext();
  const seller = publicKey.toBase58();
  const prepared = await api.prepareMarketplaceCancel({ seller, listing });
  const sellerNftAtaResult = await ensureAta({
    connection,
    payer: publicKey,
    owner: publicKey,
    mint: new PublicKey(prepared.nftMint),
  });

  const instructions = [];
  if (sellerNftAtaResult.instruction) instructions.push(sellerNftAtaResult.instruction);

  instructions.push(new TransactionInstruction({
    programId: new PublicKey(marketConfig.programId),
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(prepared.listing), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(prepared.vault), isSigner: false, isWritable: true },
      { pubkey: sellerNftAtaResult.ata, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(prepared.nftMint), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: await buildInstructionData('cancel_nft'),
  }));

  const signature = await signAndSend(connection, provider, instructions);
  await api.confirmMarketplaceCancel({
    seller,
    listing: prepared.listing,
    signature,
  });
  return signature;
}
