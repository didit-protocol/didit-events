// Door performance counters for the operator panel (dev builds): detector frames per second and recognition
// latency percentiles. Pure: timestamps are passed in.

export class FpsMeter {
  private times: number[] = [];
  constructor(private readonly windowMs = 1000) {}
  tick(t: number): void {
    this.times.push(t);
    while (this.times.length && this.times[0]! < t - this.windowMs) this.times.shift();
  }
  fps(t: number): number {
    const recent = this.times.filter((x) => x >= t - this.windowMs);
    return Math.round((recent.length * 1000) / this.windowMs);
  }
}

/** Nearest-rank percentile of `values` (0 when empty). */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export class LatencyStats {
  private samples: number[] = [];
  constructor(private readonly size = 50) {}
  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }
  get count(): number {
    return this.samples.length;
  }
  summary(): { p50: number; p95: number; n: number } {
    return { p50: Math.round(percentile(this.samples, 50)), p95: Math.round(percentile(this.samples, 95)), n: this.samples.length };
  }
}

/**
 * Minimum gap between detector frames: as fast as the detector goes while visible, 10 fps on a low battery, and a
 * crawl when the tab is hidden (nobody sees the door; the camera stays warm).
 */
export function frameIntervalMs(s: { hidden: boolean; lowBattery: boolean; slowDetector: boolean }): number {
  if (s.hidden) return 1000;
  if (s.lowBattery) return 100;
  return s.slowDetector ? 66 : 33;
}
