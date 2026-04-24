// IST month-key helpers (GMT+5:30). Month resets at 00:00 IST on the 1st.
const IST_OFFSET_MIN = 5 * 60 + 30;

export function istMonthKey(d: Date = new Date()): string {
  const istMs = d.getTime() + IST_OFFSET_MIN * 60_000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MIN * 60_000);
}
