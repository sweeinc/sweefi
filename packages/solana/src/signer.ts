/**
 * @sweefi/solana — Signer abstractions
 *
 * Two-sided signer model (mirrors @sweefi/sui/src/signer.ts):
 *   - ClientSolanaSigner / SolanaKeypairSigner / SolanaWalletSigner
 *     Used by ExactSolanaClientScheme to sign transactions before sending.
 *   - FacilitatorSolanaSigner / toFacilitatorSolanaSigner()
 *     Used by ExactSolanaFacilitatorScheme to verify, simulate, and execute.
 *
 * BROWSER SAFETY: All binary ↔ base64 conversions use btoa/atob (Web Platform
 * globals available in Node.js 16.4+ and all modern browsers). Buffer.from() is
 * intentionally avoided — it is a Node.js global absent in browsers without a
 * polyfill (e.g., Vite does not include one by default).
 */

// Transaction imported as a value — needed by toFacilitatorSolanaSigner which
// calls Transaction.from() to deserialize client-submitted bytes.
import { Transaction } from '@solana/web3.js';
import type { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { createSolanaConnection } from './utils/connection.js';
import { uint8ArrayToBase64, base64ToUint8Array } from './utils/encoding.js';
import type { SolanaNetwork } from './constants.js';

// ─── Shared types ─────────────────────────────────────────────────────────────

/** Result of a Solana transaction simulation, augmented with account key mapping. */
export interface SolanaSimulateResult {
  success: boolean;
  err?: unknown;
  /**
   * Public keys (base58) of all accounts in the transaction, in account-index order.
   * Use to map preBalances[i] / postBalances[i] → address[i].
   */
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: Array<{
    accountIndex: number;
    mint: string;
    /** Wallet address that owns this token account. Present on modern RPC nodes. */
    owner?: string;
    uiTokenAmount: { amount: string; decimals: number };
  }>;
  postTokenBalances?: Array<{
    accountIndex: number;
    mint: string;
    owner?: string;
    uiTokenAmount: { amount: string; decimals: number };
  }>;
  /**
   * Transaction logs. Used for extracting Anchor events via parseAnchorEvent().
   * Anchor emits events as "Program data: <base64>" log entries.
   */
  logs?: string[];
  unitsConsumed?: number;
}

// ─── ClientSolanaSigner ───────────────────────────────────────────────────────

/**
 * Client-side signer used by the exact scheme's createPayment().
 * Accepts a pre-connected keypair (Node.js agents) or a browser wallet adapter.
 *
 * signTransaction returns the blockhash and lastValidBlockHeight so callers
 * can use the SAME blockhash for confirmTransaction — avoiding the mismatch
 * that occurs when a fresh blockhash is fetched after sendRawTransaction.
 */
export interface ClientSolanaSigner {
  /** Base58-encoded public key (the signer's Solana address). */
  readonly address: string;

  /**
   * Set recent blockhash, set fee payer, sign, and serialize the transaction.
   *
   * @returns serialized          - base64-encoded raw signed transaction bytes
   * @returns signature           - base64-encoded Ed25519 signature bytes
   * @returns blockhash           - the blockhash embedded in the transaction
   * @returns lastValidBlockHeight - block height after which this tx expires;
   *                                pass to confirmTransaction alongside blockhash
   */
  signTransaction(
    transaction: Transaction,
    connection: Connection,
  ): Promise<{
    serialized: string;
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
}

// ─── FacilitatorSolanaSigner ──────────────────────────────────────────────────

/**
 * Facilitator-side signer. Receives signed transaction bytes (base64),
 * verifies the signature, simulates, and executes on-chain.
 */
export interface FacilitatorSolanaSigner {
  /**
   * Cryptographically verify the payer's signature over the transaction message.
   * Returns the payer's base58 address if valid; throws if invalid.
   *
   * Uses the Web Crypto API (Ed25519) — requires Node.js 18+ or any modern browser.
   */
  verifyAndGetPayer(serializedTx: string, network: SolanaNetwork): Promise<string>;

  /**
   * Simulate the transaction on the network without committing.
   * Includes pre/post SOL and SPL token balances, keyed by account index.
   * accountKeys maps those indices to base58 addresses.
   */
  simulateTransaction(
    serializedTx: string,
    network: SolanaNetwork,
  ): Promise<SolanaSimulateResult>;

  /** Submit raw signed transaction bytes; returns the transaction signature (txid). */
  executeTransaction(serializedTx: string, network: SolanaNetwork): Promise<string>;

  /** Wait for the given signature to reach 'confirmed' finality; throws on failure. */
  confirmTransaction(signature: string, network: SolanaNetwork): Promise<void>;
}

// ─── SolanaKeypairSigner ──────────────────────────────────────────────────────

/**
 * Wraps a @solana/web3.js Keypair for use in Node.js agents and CLI tools.
 *
 * Usage:
 *   const signer = new SolanaKeypairSigner(Keypair.fromSecretKey(secretKeyBytes));
 *   const adapter = new SolanaPaymentAdapter({ wallet: signer, connection, network });
 */
export class SolanaKeypairSigner implements ClientSolanaSigner {
  readonly address: string;

  constructor(private readonly keypair: Keypair) {
    this.address = keypair.publicKey.toBase58();
  }

  async signTransaction(
    transaction: Transaction,
    connection: Connection,
  ): Promise<{
    serialized: string;
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = this.keypair.publicKey;
    transaction.sign(this.keypair);

    const rawBytes = transaction.serialize();
    const serialized = uint8ArrayToBase64(new Uint8Array(rawBytes));

    const sig = transaction.signatures[0]?.signature;
    if (!sig) throw new Error('Transaction signing failed: no signature produced');
    const signature = uint8ArrayToBase64(new Uint8Array(sig));

    return {
      serialized,
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };
  }
}

// ─── SolanaWalletSigner ───────────────────────────────────────────────────────

/**
 * Minimal wallet adapter interface — compatible with @solana/wallet-adapter-base.
 * Allows browser wallets (Phantom, Backpack, etc.) to sign SweeFi transactions.
 */
export interface SolanaWalletAdapter {
  publicKey: PublicKey | null;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

/**
 * Wraps a browser wallet adapter (Phantom, Backpack, etc.) as a ClientSolanaSigner.
 * Call `new SolanaWalletSigner(wallet)` inside your React/Vue wallet connect handler.
 */
export class SolanaWalletSigner implements ClientSolanaSigner {
  get address(): string {
    if (!this.wallet.publicKey) throw new Error('Wallet not connected');
    return this.wallet.publicKey.toBase58();
  }

  constructor(private readonly wallet: SolanaWalletAdapter) {}

  async signTransaction(
    transaction: Transaction,
    connection: Connection,
  ): Promise<{
    serialized: string;
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    if (!this.wallet.publicKey) throw new Error('Wallet not connected');

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = this.wallet.publicKey;

    const signed = await this.wallet.signTransaction(transaction);
    const rawBytes = signed.serialize();
    const serialized = uint8ArrayToBase64(new Uint8Array(rawBytes));

    const sig = signed.signatures[0]?.signature;
    if (!sig) throw new Error('Wallet signing failed: no signature produced');
    const signature = uint8ArrayToBase64(new Uint8Array(sig));

    return {
      serialized,
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };
  }
}

// ─── FacilitatorSolanaSigner factory ─────────────────────────────────────────

export interface FacilitatorSolanaSignerConfig {
  /** Single custom RPC URL (all networks) */
  rpcUrl?: string;
  /** Per-network custom RPC URLs (takes precedence over rpcUrl) */
  rpcUrls?: Record<string, string>;
}

/**
 * Create a FacilitatorSolanaSigner that reads from the network via Connection.
 * Connections are lazily initialized and cached per network.
 *
 * @param config - Optional RPC URL overrides
 */
export function toFacilitatorSolanaSigner(
  config?: FacilitatorSolanaSignerConfig,
): FacilitatorSolanaSigner {
  const connectionCache = new Map<string, Connection>();

  const getConnection = (network: SolanaNetwork): Connection => {
    const cached = connectionCache.get(network);
    if (cached) return cached;
    const rpcUrl = config?.rpcUrls?.[network] ?? config?.rpcUrl;
    const conn = createSolanaConnection(network, rpcUrl);
    connectionCache.set(network, conn);
    return conn;
  };

  return {
    async verifyAndGetPayer(
      serializedTx: string,
      _network: SolanaNetwork,
    ): Promise<string> {
      const txBytes = base64ToUint8Array(serializedTx);
      const tx = Transaction.from(txBytes);

      const payerPubKey = tx.feePayer ?? tx.signatures[0]?.publicKey;
      if (!payerPubKey) throw new Error('Cannot determine payer from transaction');

      const sig = tx.signatures[0]?.signature;
      if (!sig) throw new Error('Transaction carries no signature');

      // Ed25519 verification via Web Crypto API (Node.js 18+, all modern browsers).
      // No extra dependencies — @solana/web3.js already requires the Crypto global.
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        payerPubKey.toBytes(),
        { name: 'Ed25519' },
        false,
        ['verify'],
      );

      const messageBytes = tx.serializeMessage();
      const isValid = await crypto.subtle.verify(
        'Ed25519',
        cryptoKey,
        sig,
        messageBytes,
      );

      if (!isValid) throw new Error('Invalid transaction signature — payer mismatch');

      return payerPubKey.toBase58();
    },

    async simulateTransaction(
      serializedTx: string,
      network: SolanaNetwork,
    ): Promise<SolanaSimulateResult> {
      const conn = getConnection(network);
      const txBytes = base64ToUint8Array(serializedTx);
      const tx = Transaction.from(txBytes);

      // Compile the message to extract the ordered account key list.
      // Essential for mapping preBalances[i] → address[i] in verification.
      const message = tx.compileMessage();
      const accountKeys = message.accountKeys.map((pk) => pk.toBase58());

      const result = await conn.simulateTransaction(tx);

      // Cast to access balance fields — present at runtime but not in @solana/web3.js types
      const simValue = result.value as Record<string, unknown>;
      const preBalances = (simValue.preBalances as number[] | undefined) ?? [];
      const postBalances = (simValue.postBalances as number[] | undefined) ?? [];
      const preTokenBalances = simValue.preTokenBalances as Array<{
        accountIndex: number; mint: string; owner: string;
        uiTokenAmount: { amount: string; decimals: number };
      }> | undefined;
      const postTokenBalances = simValue.postTokenBalances as Array<{
        accountIndex: number; mint: string; owner: string;
        uiTokenAmount: { amount: string; decimals: number };
      }> | undefined;

      return {
        success: result.value.err === null,
        err: result.value.err ?? undefined,
        accountKeys,
        preBalances,
        postBalances,
        preTokenBalances: preTokenBalances?.map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: {
            amount: b.uiTokenAmount.amount,
            decimals: b.uiTokenAmount.decimals,
          },
        })),
        postTokenBalances: postTokenBalances?.map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: {
            amount: b.uiTokenAmount.amount,
            decimals: b.uiTokenAmount.decimals,
          },
        })),
        logs: result.value.logs ?? undefined,
        unitsConsumed: result.value.unitsConsumed,
      };
    },

    async executeTransaction(
      serializedTx: string,
      network: SolanaNetwork,
    ): Promise<string> {
      const conn = getConnection(network);
      const txBytes = base64ToUint8Array(serializedTx);
      return conn.sendRawTransaction(txBytes, { skipPreflight: false });
    },

    async confirmTransaction(signature: string, network: SolanaNetwork): Promise<void> {
      const conn = getConnection(network);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const result = await conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (result.value.err) {
        throw new Error(
          `Transaction confirmation failed: ${JSON.stringify(result.value.err)}`,
        );
      }
    },
  };
}
