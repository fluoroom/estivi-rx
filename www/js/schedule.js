// Program guide built from Estivi info frames.
// A frame has no date and no timezone: HH:MM is UTC and weekdays are the
// English abbreviations the transmitter sends. Programs are kept as UTC rules
// and placed on the local calendar when the guide is built.
//
// A common block is a program with no DAYS line. It has no day, so it is
// dropped. A rule with DAYSLEFT 0 is infinite; 1..99 lasts that many days from
// the local day it was heard. Rules stay in storage until the calendar is
// cleared.

// Today plus 30 days ahead, so the calendar always reaches the same day next
// month instead of stopping at the end of the current one.
export const GUIDE_DAYS = 31;
export const MAX_DAYSLEFT = 99;
export const EXTRA_SPAN_MS = 12 * 60 * 60 * 1000;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = new Map(WD.map((d) => [d.toLowerCase(), d]));
const DAY_ORDER = new Map(WD.map((d, i) => [d, i]));
const DAY_MS = 86400000;
const TINY_MS = 9000;

export function emptyGuide() {
  return { stations: {} };
}

export function parseRange(range) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range || "");
  if (!m) return null;
  const sh = Number(m[1]);
  const sm = Number(m[2]);
  const eh = Number(m[3]);
  const em = Number(m[4]);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return { start, end, crosses: end <= start };
}

export function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d, n) {
  const x = startOfLocalDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Calendar-day distance, immune to the 23/25 hour days around DST.
function civilDayDiff(a, b) {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      DAY_MS,
  );
}

function normalizeDays(days) {
  const set = new Set();
  for (const raw of days || []) {
    const name = DAY_NAMES.get(String(raw).trim().toLowerCase());
    if (name) set.add(name);
  }
  return [...set].sort((a, b) => DAY_ORDER.get(a) - DAY_ORDER.get(b));
}

function readDaysleft(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_DAYSLEFT, Math.trunc(v)));
}

function upsert(list, item) {
  const key = `${item.name}|${item.range}|${item.days.join(",")}`;
  const i = list.findIndex((p) => `${p.name}|${p.range}|${p.days.join(",")}` === key);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function makeRule(name, range, parsed, days, daysleft, now) {
  return {
    name,
    range,
    start: parsed.start,
    end: parsed.end,
    crosses: parsed.crosses,
    days: normalizeDays(days),
    daysleft: readDaysleft(daysleft),
    heardAt: now.getTime(),
  };
}

export function ingest(state, packet, now) {
  if (!packet || packet.kind !== "info") return state;
  const call = packet.call || (packet.src && packet.src.call) || "";
  if (!call) return state;

  const st = state.stations[call] || null;
  const programs = st && Array.isArray(st.programs) ? st.programs : [];
  let changed = false;

  const pr = parseRange(packet.range);
  if (packet.name && pr) {
    const days = normalizeDays(packet.days);
    // No DAYS line is a common block: it is dropped.
    if (days.length) {
      upsert(programs, makeRule(packet.name, packet.range, pr, days, packet.daysleft, now));
      changed = true;
    }
  }

  for (const n of packet.next || []) {
    const nr = parseRange(n.range);
    const days = normalizeDays(n.days);
    if (!n.name || !nr || !days.length) continue;
    upsert(programs, makeRule(n.name, n.range, nr, days, n.daysleft, now));
    changed = true;
  }

  if (!changed && !st) return state;
  if (st) st.heardAt = now.getTime();
  else state.stations[call] = { programs, heardAt: now.getTime() };
  return state;
}

function ruleMinutes(rule) {
  return rule.crosses ? 1440 - rule.start + rule.end : rule.end - rule.start;
}

function activeOn(rule, localDate) {
  const i = civilDayDiff(new Date(rule.heardAt), localDate);
  if (i < 0) return false;
  return rule.daysleft === 0 || i < rule.daysleft;
}

// Every rule occurrence whose interval intersects [fromMs, toMs). The weekday
// and clock in the packet are UTC; the local day at the start of the occurrence
// is what DAYSLEFT counts from.
function occurrences(state, fromMs, toMs) {
  const rules = [];
  for (const [call, st] of Object.entries(state.stations || {})) {
    for (const rule of st.programs || []) rules.push({ call, rule });
  }
  if (!rules.length) return [];

  const out = [];
  const first = new Date(fromMs);
  const last = new Date(toMs);
  let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - 2 * DAY_MS;
  const limit = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()) + 2 * DAY_MS;
  for (; cursor <= limit; cursor += DAY_MS) {
    const utcDay = new Date(cursor);
    const wd = WD[utcDay.getUTCDay()];
    for (const { call, rule } of rules) {
      if (!rule.days.includes(wd)) continue;
      const startMs = cursor + rule.start * 60000;
      const endMs = startMs + ruleMinutes(rule) * 60000;
      if (endMs <= fromMs || startMs >= toMs) continue;
      if (!activeOn(rule, new Date(startMs))) continue;
      out.push({ call, name: rule.name, range: rule.range, startMs, endMs });
    }
  }
  out.sort(
    (a, b) =>
      a.startMs - b.startMs ||
      a.call.localeCompare(b.call) ||
      a.name.localeCompare(b.name),
  );
  return out;
}

export function buildGuide(state, now) {
  const nowMs = now.getTime();
  const day0 = startOfLocalDay(now);
  const day0Ms = day0.getTime();
  const day1Ms = addLocalDays(day0, 1).getTime();
  const blocks = occurrences(
    state,
    addLocalDays(day0, -1).getTime(),
    addLocalDays(day0, GUIDE_DAYS + 1).getTime(),
  );

  // The hour row runs until the latest program that is still running or still
  // ahead on today's local calendar. With nothing left it runs to midnight.
  const todayBlocks = blocks.filter((b) => b.endMs > day0Ms && b.startMs < day1Ms);
  const later = todayBlocks.filter((b) => b.endMs > nowMs);
  let end = 1440;
  if (later.length) {
    end = Math.max(
      ...later.map((b) => Math.min(1440, (Math.min(b.endMs, day1Ms) - day0Ms) / 60000)),
    );
  }

  const days = [];
  let last = 0;
  for (let i = 0; i < GUIDE_DAYS; i++) {
    const date = addLocalDays(day0, i);
    const a = date.getTime();
    const z = addLocalDays(date, 1).getTime();
    const items = blocks
      .filter((b) => b.startMs >= a && b.startMs < z)
      .map((b) => ({
        call: b.call,
        name: b.name,
        range: b.range,
        // Local minutes from the start of this local day. A range that crosses
        // midnight keeps one block and its end goes past 1440.
        start: Math.round((b.startMs - a) / 60000),
        end: Math.round((b.endMs - a) / 60000),
        startMs: b.startMs,
        endMs: b.endMs,
      }));
    if (i === 0) {
      // A block that began before today and is still running keeps its whole
      // range on today's card too, with a negative start that wraps in local
      // time (23:30-00:30), instead of being cut at 00:00.
      for (const b of blocks) {
        if (b.startMs >= a || b.endMs <= nowMs) continue;
        items.push({
          call: b.call,
          name: b.name,
          range: b.range,
          start: Math.round((b.startMs - a) / 60000),
          end: Math.round((b.endMs - a) / 60000),
          startMs: b.startMs,
          endMs: b.endMs,
        });
      }
    }
    items.sort(
      (a, b) =>
        a.start - b.start ||
        a.call.localeCompare(b.call) ||
        a.name.localeCompare(b.name),
    );
    days.push({ date, blocks: items });
    if (items.length) last = i;
  }

  return {
    start: (nowMs - day0Ms) / 60000,
    end,
    days: days.slice(0, Math.max(1, last + 1)),
    blocks,
  };
}

// Only blocks that overlap share lanes. A cluster of overlapping blocks is
// colored with the smallest number of lanes; a block that does not overlap
// anything gets a single lane and the full height (row) or width (calendar).
// Same-callsign overlaps are split too.
export function layoutBlocks(blocks) {
  const sorted = blocks
    .slice()
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        (a.call || "").localeCompare(b.call || "") ||
        (a.name || "").localeCompare(b.name || ""),
    );
  const clusters = [];
  let cur = null;

  const close = () => {
    if (!cur) return;
    const lanes = [];
    for (const b of cur.blocks) {
      let lane = lanes.findIndex((l) => l.end <= b.start);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push({ end: b.end, blocks: [] });
      }
      lanes[lane].blocks.push(b);
      lanes[lane].end = Math.max(lanes[lane].end, b.end);
    }
    for (let i = 0; i < lanes.length; i++) {
      for (const b of lanes[i].blocks) {
        b.lane = i;
        b.laneCount = lanes.length;
      }
    }
    clusters.push({
      start: cur.start,
      end: cur.end,
      blocks: cur.blocks,
      lanes: lanes.map((l) => l.blocks),
    });
  };

  for (const b of sorted) {
    if (!cur || b.start >= cur.end) {
      close();
      cur = { start: b.start, end: b.end, blocks: [b] };
    } else {
      cur.blocks.push(b);
      cur.end = Math.max(cur.end, b.end);
    }
  }
  close();
  return clusters;
}

export function layoutInSpan(blocks, startMs, endMs) {
  const items = [];
  for (const b of blocks) {
    const start = Math.max(b.startMs, startMs);
    const end = Math.min(b.endMs, endMs);
    if (end - start < TINY_MS) continue;
    items.push({ ...b, start, end });
  }
  return layoutBlocks(items);
}

// The hour row keeps a stable clock span so the current-time mark can travel.
// It begins at the top of the hour and runs until 12 hours past the last program.
export function extendSpan(now, guideEndMin, guideStartMin, pinned) {
  let endMin = guideEndMin;
  if (!(endMin > guideStartMin)) endMin = Math.min(1440, guideStartMin + 30);
  const endBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, endMin);
  const endMs = endBase.getTime() + EXTRA_SPAN_MS;
  const nowMs = now.getTime();
  let start = pinned && pinned.start;
  let end = pinned && pinned.end;
  if (start == null || nowMs < start || nowMs >= end) {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
    end = Math.max(endMs, start + EXTRA_SPAN_MS);
  } else if (endMs > end) {
    end = endMs;
  }
  return { start, end };
}
