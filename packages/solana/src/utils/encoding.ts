/**
 * Cross-platform base64 utilities.
 *
 * Uses the global `btoa`/`atob` functions available in:
 *   - Node.js 16.4+ (as globals, no polyfill needed)
 *   - All modern browsers
 *
 * Do NOT use Buffer.from(bytes, 'base64') here — Buffer is a Node.js global
 * that is not available in browsers without a polyfill (e.g., Vite does not
 * include one by default). btoa/atob are part of the Web Platform standard.
 */

/** Encode a Uint8Array to a base64 string. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Decode a base64 string to a Uint8Array. */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
