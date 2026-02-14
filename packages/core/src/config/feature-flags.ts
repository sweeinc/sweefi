/**
 * Feature flags for alpha dependency codepaths.
 * Read from environment variables. Defaults to stable codepaths.
 * Used by both SuiAgent and SealChat.
 */

function envBool(key: string, defaultValue: boolean): boolean {
  const val = typeof process !== 'undefined' ? process.env[key] : undefined;
  if (val === undefined) return defaultValue;
  return val === 'true' || val === '1';
}

export const FeatureFlags = {
  get SEAL_ENCRYPTION(): boolean {
    return envBool('SWEE_SEAL_ENCRYPTION', true);
  },
  get SEAL_POLICY_EVALUATION(): boolean {
    return envBool('SWEE_SEAL_POLICY_EVALUATION', true);
  },
  get SUI_STACK_MESSAGING(): boolean {
    return envBool('SWEE_SUI_STACK_MESSAGING', false);
  },
  get NAUTILUS_TEE(): boolean {
    return envBool('SWEE_NAUTILUS_TEE', false);
  },
  get ATOMA_INFERENCE(): boolean {
    return envBool('SWEE_ATOMA_INFERENCE', false);
  },
} as const;
