// Program guide built from Estivi info frames.
// The frame has no date and no timezone. Weekday names are the English
// abbreviations the transmitter sends. A horizon covers daysleft 0.

export const HORIZON_DAYS = 14;
export const MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayIndex(heardAt, date) {
  const a = startOfDay(new Date(heardAt));
  const b = startOfDay(date);
  return Math.round((b - a) / 86400000);
}

function weekday(d) {
  return WD[d.getDay()];
}

function upsert(list, item) {
  const key = `${item.name}|${item.range}|${item.days.join(",")}`;
  const i = list.findIndex((p) => `${p.name}|${p.range}|${p.days.join(",")}` === key);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

export function ingest(state, packet, now) {
  if (!packet || packet.kind !== "info") return state;
  const call = packet.call || (packet.src && packet.src.call) || "";
  if (!call) return state;
  const st = state.stations[call] || { programs: [], commons: [], currentCommon: null, heardAt: 0 };
  st.heardAt = now.getTime();
  const pr = parseRange(packet.range);
  if (packet.name && pr && packet.days && packet.days.length) {
    upsert(st.programs, {
      name: packet.name,
      range: packet.range,
      start: pr.start,
      end: pr.end,
      crosses: pr.crosses,
      days: packet.days.slice(),
      daysleft: packet.daysleft == null ? 0 : packet.daysleft,
      heardAt: now.getTime(),
    });
    st.currentCommon = null;
  } else if (packet.name && pr) {
    st.currentCommon = {
      name: packet.name,
      range: packet.range,
      start: pr.start,
      end: pr.end,
      crosses: pr.crosses,
      heardAt: now.getTime(),
      onDate: dateKey(now),
    };
  }
  const commons = [];
  for (const n of packet.next || []) {
    const nr = parseRange(n.range);
    if (!nr || !n.name) continue;
    if (n.days && n.days.length) {
      upsert(st.programs, {
        name: n.name,
        range: n.range,
        start: nr.start,
        end: nr.end,
        crosses: nr.crosses,
        days: n.days.slice(),
        daysleft: n.daysleft == null ? 0 : n.daysleft,
        heardAt: now.getTime(),
      });
    } else {
      commons.push({
        call,
        name: n.name,
        range: n.range,
        start: nr.start,
        end: nr.end,
        crosses: nr.crosses,
      });
    }
  }
  st.commons = commons;
  state.stations[call] = st;
  return state;
}

function fresh(heardAt, now) {
  return now.getTime() - heardAt <= MEMORY_MS;
}

function ruleActive(rule, date) {
  const i = dayIndex(rule.heardAt, date);
  if (i < 0) return false;
  if (rule.daysleft > 0) return i < rule.daysleft;
  return i < HORIZON_DAYS;
}

function programIntervals(rule, date) {
  const out = [];
  if (rule.days.includes(weekday(date)) && ruleActive(rule, date)) {
    out.push({
      start: rule.start,
      end: rule.crosses ? 1440 : rule.end,
      range: rule.range,
      name: rule.name,
    });
  }
  const prev = addDays(date, -1);
  if (rule.crosses && rule.days.includes(weekday(prev))) {
    const i = dayIndex(rule.heardAt, prev);
    const life = rule.daysleft > 0 ? rule.daysleft : HORIZON_DAYS;
    if (i >= -1 && i < life) {
      out.push({ start: 0, end: rule.end, range: rule.range, name: rule.name });
    }
  }
  return out;
}

function commonIntervals(common, date) {
  const key = dateKey(date);
  const out = [];
  if (key === common.onDate) {
    out.push({
      start: common.start,
      end: common.crosses ? 1440 : common.end,
      range: common.range,
      name: common.name,
    });
  }
  if (common.crosses && key === dateKey(addDays(parseKey(common.onDate), 1))) {
    out.push({ start: 0, end: common.end, range: common.range, name: common.name });
  }
  return out;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function pack(blocks) {
  let cross = false;
  for (let i = 0; i < blocks.length && !cross; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[i].call !== blocks[j].call && overlaps(blocks[i], blocks[j])) {
        cross = true;
        break;
      }
    }
  }
  const calls = [...new Set(blocks.map((b) => b.call))].sort((a, b) => a.localeCompare(b));
  if (!cross) {
    const items = blocks.slice().sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
    return [{ call: calls.length === 1 ? calls[0] : "", blocks: items }];
  }
  return calls.map((call) => ({
    call,
    blocks: blocks.filter((b) => b.call === call).sort((a, b) => a.start - b.start),
  }));
}

function blocksOn(state, date, now) {
  const blocks = [];
  for (const [call, st] of Object.entries(state.stations)) {
    if (!fresh(st.heardAt, now)) continue;
    for (const rule of st.programs) {
      if (!fresh(rule.heardAt, now)) continue;
      for (const iv of programIntervals(rule, date)) {
        blocks.push({ call, name: iv.name, range: iv.range, start: iv.start, end: iv.end });
      }
    }
    if (st.currentCommon) {
      for (const iv of commonIntervals(st.currentCommon, date)) {
        blocks.push({ call, name: iv.name, range: iv.range, start: iv.start, end: iv.end });
      }
    }
  }
  return blocks;
}

export function buildGuide(state, now) {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const todayBlocks = blocksOn(state, now, now).filter((b) => b.end > nowMin + 0.05);
  let end = 1440;
  if (todayBlocks.length) end = Math.max(...todayBlocks.map((b) => b.end));
  const lanes = pack(todayBlocks).map((lane) => ({
    call: lane.call,
    blocks: lane.blocks
      .map((b) => ({
        ...b,
        viewStart: Math.max(b.start, nowMin),
        viewEnd: Math.min(b.end, end),
      }))
      .filter((b) => b.viewEnd > b.viewStart + 0.15),
  })).filter((lane) => lane.blocks.length);

  let last = 0;
  const dayBlocks = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(now, i);
    const blocks = blocksOn(state, date, now);
    dayBlocks.push({ date, blocks });
    if (blocks.length) last = i;
  }
  const days = dayBlocks.slice(0, Math.max(1, last + 1)).map(({ date, blocks }) => ({
    date,
    columns: blocks.length ? pack(blocks) : [{ call: "", blocks: [] }],
  }));

  const undated = [];
  for (const [call, st] of Object.entries(state.stations)) {
    if (!fresh(st.heardAt, now)) continue;
    for (const c of st.commons) undated.push({ call, name: c.name, range: c.range });
  }
  undated.sort((a, b) => a.range.localeCompare(b.range) || a.call.localeCompare(b.call));

  return { start: nowMin, end, lanes, days, undated };
}

export const EXTRA_SPAN_MS = 12 * 60 * 60 * 1000;

// The hour row keeps a stable clock span so the current-time mark can travel.
// It begins at the top of the hour and runs until 12 hours past the last program.
export function extendSpan(now, guideEndMin, guideStartMin, pinned) {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let endMin = guideEndMin;
  if (!(endMin > guideStartMin)) endMin = Math.min(1440, guideStartMin + 30);
  const endMs = day0 + endMin * 60000 + EXTRA_SPAN_MS;
  const nowMs = now.getTime();
  let start = pinned && pinned.start;
  let end = pinned && pinned.end;
  if (start == null || nowMs < start || nowMs >= end) {
    const hour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
    start = hour;
    end = Math.max(endMs, start + EXTRA_SPAN_MS);
  } else if (endMs > end) {
    end = endMs;
  }
  return { start, end };
}

export function lanesInSpan(days, startMs, endMs) {
  const blocks = [];
  for (const day of days) {
    const day0 = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate()).getTime();
    if (day0 + 86400000 <= startMs || day0 >= endMs) continue;
    for (const col of day.columns) {
      for (const b of col.blocks) {
        const bStart = day0 + b.start * 60000;
        const bEnd = day0 + b.end * 60000;
        if (bEnd <= startMs || bStart >= endMs) continue;
        blocks.push({
          call: b.call || col.call || "",
          name: b.name,
          start: Math.max(bStart, startMs),
          end: Math.min(bEnd, endMs),
        });
      }
    }
  }
  return pack(blocks);
}
