// Preserve the provider's capture time. Convert epoch units only when the
// resulting fix is actually recent; never replace a stale fix with Date.now().
export function gpsTimestamp(value, now = Date.now()) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return [value, value * 1000, value / 1000]
    .find(candidate => candidate >= now - 20000 && candidate <= now + 5000) ?? null;
}
