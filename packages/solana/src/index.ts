/**
 * @module @sweefi/solana — Solana-native payment protocol implementation
 *
 * Provides the Solana-specific implementation of the s402 payment protocol,
 * mirroring @sweefi/sui's design with SPL token transfers and Solana's
 * sub-second finality.
 *
 * Quick start (agent / Node.js):
 *   import { SolanaPaymentAdapter, SolanaKeypairSigner } from '@sweefi/solana';
 *   import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
 *
 *   const signer = new SolanaKeypairSigner(Keypair.fromSecretKey(secretKey));
 *   const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
 *   const adapter = new SolanaPaymentAdapter({ wallet: signer, connection, network: 'solana:devnet' });
 *
 * Quick start (browser wallet):
 *   import { SolanaPaymentAdapter, SolanaWalletSigner } from '@sweefi/solana';
 *   const signer = new SolanaWalletSigner(wallet); // e.g. useWallet() from @solana/wallet-adapter-react
 *   const adapter = new SolanaPaymentAdapter({ wallet: signer, connection, network: 'solana:mainnet-beta' });
 */

// ─── Signer utilities ────────────────────────────────────────────────────────

export {
  SolanaKeypairSigner,
  SolanaWalletSigner,
  toFacilitatorSolanaSigner,
} from './signer.js';
export type {
  ClientSolanaSigner,
  FacilitatorSolanaSigner,
  FacilitatorSolanaSignerConfig,
  SolanaWalletAdapter,
  SolanaSimulateResult,
} from './signer.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export {
  SOLANA_MAINNET_CAIP2,
  SOLANA_DEVNET_CAIP2,
  SOLANA_TESTNET_CAIP2,
  NATIVE_SOL_MINT,
  USDC_MAINNET_MINT,
  USDC_DEVNET_MINT,
  USDC_DECIMALS,
  SOL_DECIMALS,
  LAMPORTS_PER_SOL,
  BASE_FEE_LAMPORTS,
  ATA_RENT_LAMPORTS,
  // SweeFi Anchor program IDs (for custom facilitator configurations)
  SWEEFI_PREPAID_PROGRAM_ID,
  SWEEFI_STREAM_PROGRAM_ID,
  SWEEFI_ESCROW_PROGRAM_ID,
  SWEEFI_UPTO_PROGRAM_ID,
  // Type guard
  isSolanaNetwork,
} from './constants.js';
export type { SolanaNetwork } from './constants.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

export { createSolanaConnection, networkToCluster, getDefaultUsdcMint } from './utils/connection.js';
export { uint8ArrayToBase64, base64ToUint8Array } from './utils/encoding.js';

// ─── s402 scheme implementations ─────────────────────────────────────────────

export * from './s402/index.js';

// ─── Anchor program clients ──────────────────────────────────────────────────

export * from './programs/index.js';

// ─── PaymentAdapter for @sweefi/ui-core ──────────────────────────────────────

export { SolanaPaymentAdapter } from './adapter/SolanaPaymentAdapter.js';
export type { SolanaPaymentAdapterConfig } from './adapter/SolanaPaymentAdapter.js';
