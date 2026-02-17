/**
 * Observability metrics interface — seam for Prometheus, OpenTelemetry, etc.
 *
 * Phase 1: NoopMetrics (below) — zero overhead, all methods are no-ops.
 * Phase 2: Plug in a real implementation (PrometheusMetrics, OtelMetrics)
 * by passing it to createApp() config.
 */

export interface IMetrics {
  /** Increment a counter (e.g., "settlement_count", "verify_count") */
  increment(name: string, tags?: Record<string, string>): void;
  /** Record a histogram observation (e.g., latency in ms) */
  observe(name: string, value: number, tags?: Record<string, string>): void;
  /** Set a gauge value (e.g., "active_streams") */
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

/** No-op metrics implementation — zero overhead default. */
export class NoopMetrics implements IMetrics {
  increment(): void {}
  observe(): void {}
  gauge(): void {}
}
