/**
 * Minimal type stub for @mysten/walrus — an optional lazy dependency.
 * Consumers who use createWalrusClient() must install @mysten/walrus themselves.
 */
declare module '@mysten/walrus' {
  export class WalrusClient {
    constructor(opts: { network: string; suiClient: unknown });
  }
}
