// The clean picture YONIQ stores for DGT YQ. The name is `@` + callsign +
// `ddmmyyyyhhnnss` + `.BMP`. The stamp is the sender's local clock: day, month,
// year, then 24-hour time, with the slashes and colons removed.

const CALL = /^[A-Za-z0-9]{1,12}(?:\/[A-Za-z0-9]{1,4})?$/;

export function stampOf(date) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    p(date.getDate()) +
    p(date.getMonth() + 1) +
    String(date.getFullYear()) +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds())
  );
}

export function remoteName(call, stamp) {
  const c = String(call || "").trim();
  if (!CALL.test(c) || !/^\d{14}$/.test(stamp || "")) return "";
  return `@${c}${stamp}.BMP`;
}

/** Newest first, one name per second, ending at `endMs`. */
export function searchNames(call, endMs, seconds) {
  const names = [];
  const n = Math.max(0, Math.min(240, seconds));
  for (let i = 0; i <= n; i++) {
    const name = remoteName(call, stampOf(new Date(endMs - i * 1000)));
    if (name) names.push(name);
  }
  return names;
}
