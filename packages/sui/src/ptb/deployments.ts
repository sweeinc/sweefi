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
 * This is the 10th testnet iteration. Full deployment history is in git log.
 * Contract semver follows Move.toml (currently 0.1.0, pre-mainnet).
 */

/** Current Sui Testnet deployment */
export const TESTNET_PACKAGE_ID =
  "0xbdbe26305de40e8168daf4b5c3142ebfa1d3e88a96c23d78f0116ad3b59e1833";

/** AdminCap — owned by deployer, required for pause/unpause */
export const TESTNET_ADMIN_CAP =
  "0xdac8d5126fc92fd1e7c39d17979d92118e63677d3e60010a079b99a9f648ee79";

/** ProtocolState — shared object for pause guard */
export const TESTNET_PROTOCOL_STATE =
  "0x4a4b29cb4b1821fc30a3f8fd513cfb8028a2c565fe17e244685176345f0fb7e4";

/** UpgradeCap — owned by deployer, required for contract upgrades */
export const TESTNET_UPGRADE_CAP =
  "0x5e3bbc8ee4d2ec737c1ab62a9c3a2abc8635e7259f1e78bee8c1c794363e329e";

/** Sui Testnet config — ready to use with PTB builders */
export const testnetConfig: SweefiConfig = {
  packageId: TESTNET_PACKAGE_ID,
  protocolStateId: TESTNET_PROTOCOL_STATE,
};

// Mainnet TBD — will be set after mainnet deployment
// export const MAINNET_PACKAGE_ID = "0x...";
// export const mainnetConfig: SweefiConfig = { packageId: MAINNET_PACKAGE_ID };
