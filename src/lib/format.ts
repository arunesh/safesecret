const UNITS: [limitSeconds: number, perUnit: number, name: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86_400, 3600, "hour"],
  [Number.POSITIVE_INFINITY, 86_400, "day"],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "in 3 hours" / "in 7 days" — deliberately coarse; exact seconds help nobody. */
export function formatExpiry(expiresAtSeconds: number): string {
  const delta = expiresAtSeconds - Math.floor(Date.now() / 1000);
  if (delta <= 0) return "now";
  const unit = UNITS.find(([limit]) => delta < limit) ?? UNITS[UNITS.length - 1]!;
  return relative.format(Math.round(delta / unit[1]), unit[2]);
}

export const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** Bytes below 1 KiB, so a short password doesn't read as an unhelpful "0.0 KiB". */
export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
