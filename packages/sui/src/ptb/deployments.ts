import type { SweefiConfig } from "./types";

/** Well-known Sui Clock shared object (0x6 on all networks) */
export const SUI_CLOCK = "0x6";

/**
 * Deployed SweeFi package IDs by network.
 *
 * NOTE on Sui publishing: Each `sui client publish` creates a new immutable
 * package at a new address. Objects created under previous packages still work
 * via Sui's upgrade linkage. Always use the latest package ID for new PTB calls.
 *
 * This is the 11th testnet iteration (auto-unpause + MC/DC). Full deployment history is in git log.
 * Contract semver follows Move.toml (currently 0.1.0, pre-mainnet).
 */

/** Current Sui Testnet deployment */
export const TESTNET_PACKAGE_ID =
  "0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5";

/** AdminCap — owned by deployer, required for pause/unpause */
export const TESTNET_ADMIN_CAP =
  "0xdba70844f06c46dd4f4a331bcf9ffa234cfd1b9c9d7449719a5311112fa946dc";

/** ProtocolState — shared object for pause guard (includes paused_at_ms for auto-unpause) */
export const TESTNET_PROTOCOL_STATE =
  "0x75f4eef7ad9cdffda4278c9677a15d4993393e16cc901dc2fe26befe9e79808b";

/** UpgradeCap — owned by deployer, required for contract upgrades */
export const TESTNET_UPGRADE_CAP =
  "0xb160234f12c12e4c1a98010569e18fcd9a444a5eec3c15e3b2eedb0f691d000f";

/** Sui Testnet config — ready to use with PTB builders */
export const testnetConfig: SweefiConfig = {
  packageId: TESTNET_PACKAGE_ID,
  protocolStateId: TESTNET_PROTOCOL_STATE,
};

// Mainnet TBD — will be set after mainnet deployment
// export const MAINNET_PACKAGE_ID = "0x...";
// export const mainnetConfig: SweefiConfig = { packageId: MAINNET_PACKAGE_ID };
