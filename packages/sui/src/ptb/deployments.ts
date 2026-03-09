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
 * This is the 10th testnet iteration (v8-audit hardening). Full deployment history is in git log.
 * Contract semver follows Move.toml (currently 0.1.0, pre-mainnet).
 */

/** Current Sui Testnet deployment */
export const TESTNET_PACKAGE_ID =
  "0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef";

/** AdminCap — owned by deployer, required for pause/unpause */
export const TESTNET_ADMIN_CAP =
  "0xc54ec6846273170565e3eec1836bb48363413fb4b7b2592ee342cc3d0363f5e5";

/** ProtocolState — shared object for pause guard */
export const TESTNET_PROTOCOL_STATE =
  "0x9eae2fa9f298927230d8fdf2e525cab0f7894874d94ecedec4df2ae7a4f3df15";

/** UpgradeCap — owned by deployer, required for contract upgrades */
export const TESTNET_UPGRADE_CAP =
  "0x2472fdc1bbfe8958d776bf80baa7e7e50fcc146f4c4c91cdd61f0e2970ba98e9";

/** Sui Testnet config — ready to use with PTB builders */
export const testnetConfig: SweefiConfig = {
  packageId: TESTNET_PACKAGE_ID,
  protocolStateId: TESTNET_PROTOCOL_STATE,
};

// Mainnet TBD — will be set after mainnet deployment
// export const MAINNET_PACKAGE_ID = "0x...";
// export const mainnetConfig: SweefiConfig = { packageId: MAINNET_PACKAGE_ID };
