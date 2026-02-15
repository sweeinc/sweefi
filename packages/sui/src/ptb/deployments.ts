import type { SweepayConfig } from "./types";

/** Well-known Sui Clock shared object (0x6 on all networks) */
export const SUI_CLOCK = "0x6";

/**
 * Deployed SweePay package IDs by network.
 * Updated when new versions are published on-chain.
 *
 * NOTE on Sui upgrades: Each upgrade creates a new immutable package ID.
 * Objects created under v1 still work — Sui's upgrade system handles linkage.
 * Always use the latest package ID for new PTB calls.
 */

/** Sui Testnet v1 — payment + stream only (2026-02-13, epoch 1009) */
export const TESTNET_PACKAGE_ID_V1 =
  "0xefed863e2f46d4574569285dc3d8836829b93d62eab421d398d3a2638a2b4206";

/** Sui Testnet v2 — payment + stream + escrow (2026-02-13, epoch 1009) */
export const TESTNET_PACKAGE_ID_V2 =
  "0x3f46611b0d7f0f0ed9526b57159ca9a33a1ccf0a548f6cb0674e800ab39f7b0c";

/** Sui Testnet v3 — adds recipient_close for abandoned stream recovery (2026-02-13) */
export const TESTNET_PACKAGE_ID_V3 =
  "0x54c27347bcdf2672674a6405268f9967d249ef9e83783a86e136fc00f777cbec";

/** Sui Testnet v4 — adds seal_policy module for SEAL pay-to-decrypt (2026-02-13) */
export const TESTNET_PACKAGE_ID_V4 =
  "0xc2175d1ad5b1d2fc1d6ee7bc0bde27da78b66ec7b4592fb19ad323ec2cb1881f";

/** Sui Testnet v5 — security fixes: resume() accrual theft + escrow description cap (2026-02-13) */
export const TESTNET_PACKAGE_ID_V5 =
  "0x0c8b91c9b23e891a70457c416bd17bab3d51ae42738f9c193fa40947fee9a58e";

/** Sui Testnet v6 — configurable recipient_close timeout via dynamic fields (2026-02-13) */
export const TESTNET_PACKAGE_ID_V6 =
  "0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5";

/** Sui Testnet v7 — full suite: admin + payment + stream + escrow + seal + mandate + prepaid (2026-02-15) */
export const TESTNET_PACKAGE_ID =
  "0x242f22b9f8b3d77868f6cde06f294203d7c76afa0cd101f388a6cefa45b54c3d";

/** AdminCap — owned by deployer, required for pause/unpause */
export const TESTNET_ADMIN_CAP =
  "0x2094ced6e92ce7632ae40bf1292f272cf4caa7c3ab110f2edbfa9f4fdafd119b";

/** ProtocolState — shared object for pause guard */
export const TESTNET_PROTOCOL_STATE =
  "0xbfe77423523556fe038a3e83ad4e5be2eac03bc28c453f7345eef7636a547b09";

/** UpgradeCap — owned by deployer, required for contract upgrades */
export const TESTNET_UPGRADE_CAP =
  "0x77c484495113c9fbfe9bce9b482f6974e83402ac65853a99c6273de23f9672ad";

/** Sui Testnet config — ready to use with PTB builders */
export const testnetConfig: SweepayConfig = {
  packageId: TESTNET_PACKAGE_ID,
  protocolStateId: TESTNET_PROTOCOL_STATE,
};

// Mainnet TBD — will be set after mainnet deployment
// export const MAINNET_PACKAGE_ID = "0x...";
// export const mainnetConfig: SweepayConfig = { packageId: MAINNET_PACKAGE_ID };
