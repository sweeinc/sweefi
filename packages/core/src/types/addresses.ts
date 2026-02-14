/**
 * Branded types for Sui addresses and object IDs.
 *
 * These use TypeScript's branded type pattern to prevent accidental
 * mixing of raw strings with validated address/object ID strings.
 * Both are 0x-prefixed hex strings at runtime.
 */

declare const SuiAddressBrand: unique symbol;
declare const ObjectIdBrand: unique symbol;

/** A validated 0x-prefixed Sui address (32 bytes hex) */
export type SuiAddress = string & { readonly [SuiAddressBrand]: typeof SuiAddressBrand };

/** A validated 0x-prefixed Sui object ID (32 bytes hex) */
export type ObjectId = string & { readonly [ObjectIdBrand]: typeof ObjectIdBrand };

const SUI_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

/** Validate and brand a string as a SuiAddress */
export function toSuiAddress(address: string): SuiAddress {
  if (!SUI_ADDRESS_REGEX.test(address)) {
    throw new Error(`Invalid Sui address: ${address}`);
  }
  return address as SuiAddress;
}

/** Validate and brand a string as an ObjectId */
export function toObjectId(id: string): ObjectId {
  if (!SUI_ADDRESS_REGEX.test(id)) {
    throw new Error(`Invalid Sui object ID: ${id}`);
  }
  return id as ObjectId;
}

/** Check if a string looks like a valid Sui address (without branding) */
export function isValidSuiAddress(address: string): boolean {
  return SUI_ADDRESS_REGEX.test(address);
}
