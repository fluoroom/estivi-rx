import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuide,
  emptyGuide,
  extendSpan,
  ingest,
  layoutBlocks,
  layoutInSpan,
} from "../www/js/schedule.js";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function utcRange(start, end) {
  const sm = start.getUTCHours() * 60 + start.getUTCMinutes();
  const em = end.getUTCHours() * 60 + end.getUTCMinutes();
  return `${pad(Math.floor(sm / 60))}:${pad(sm % 60)}-${pad(Math.floor(em / 60))}:${pad(em % 60)}`;
}

function around(date) {
  const before = new Date(date.getTime() - 5 * 60000);
  if (before.getDate() === date.getDate() && before.getMonth() === date.getMonth()) return before;
  return new Date(date.getTime() + 5 * 60000);
}

test("UTC clock times and weekdays are placed on the local calendar", () => {
  const utcStart = Date.UTC(2026, 9, 31, 0, 30);
  const localStart = new Date(utcStart);
  const localEnd = new Date(utcStart + 30 * 60000);
  const now = around(localStart);
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noticias",
      range: utcRange(localStart, localEnd),
      days: [WD[new Date(utcStart).getUTCDay()]],
      daysleft: 0,
      next: [],
    },
    now,
  );

  const guide = buildGuide(state, now);
  const day = guide.days[0];
  assert.equal(day.date.getDate(), localStart.getDate());
  assert.equal(day.date.getDay(), localStart.getDay());
  const block = day.blocks.find((b) => b.name === "Noticias");
  assert.ok(block, "the UTC occurrence was not placed on its local day");
  assert.equal(block.start, localStart.getHours() * 60 + localStart.getMinutes());
  assert.equal(block.end, block.start + 30);
});

test("common blocks with no DAYS line are dropped", () => {
  const now = new Date(2026, 9, 30, 15, 0, 0);
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Suelto",
      range: "18:00-19:00",
      days: null,
      daysleft: 0,
      next: [{ name: "Bloque", range: "23:00-23:30", days: [], daysleft: 0 }],
    },
    now,
  );
  assert.deepEqual(state.stations, {});
  const guide = buildGuide(state, now);
  assert.equal(guide.blocks.length, 0);
  assert.equal(guide.days[0].blocks.length, 0);
});

test("DAYSLEFT 0 is infinite and a positive value stops after that many days", () => {
  const heard = new Date(2026, 0, 5, 10, 0, 0);
  const start = new Date(2026, 0, 5, 12, 0, 0);
  const end = new Date(2026, 0, 5, 13, 0, 0);
  const packet = {
    kind: "info",
    call: "LU1AQY",
    name: "Siempre",
    range: utcRange(start, end),
    days: WD.slice(),
    daysleft: 0,
    next: [],
  };

  const forever = emptyGuide();
  ingest(forever, packet, heard);
  const yearLater = buildGuide(forever, new Date(2027, 0, 5, 10, 0, 0));
  assert.ok(yearLater.blocks.some((b) => b.name === "Siempre"), "infinite rule was dropped");

  const finite = emptyGuide();
  ingest(finite, { ...packet, name: "Dos dias", daysleft: 2 }, heard);
  assert.ok(buildGuide(finite, new Date(2026, 0, 5, 10, 0, 0)).blocks.some((b) => b.name === "Dos dias"));
  assert.ok(buildGuide(finite, new Date(2026, 0, 6, 10, 0, 0)).blocks.some((b) => b.name === "Dos dias"));
  const thirdDay = buildGuide(finite, new Date(2026, 0, 7, 10, 0, 0));
  assert.equal(thirdDay.days[0].blocks.some((b) => b.name === "Dos dias"), false);

  const capped = emptyGuide();
  ingest(capped, { ...packet, name: "Largo", daysleft: 500 }, heard);
  assert.equal(capped.stations.LU1AQY.programs[0].daysleft, 99);
});

test("a range crossing local midnight stays one block", () => {
  const start = new Date(2026, 9, 30, 23, 30, 0);
  const end = new Date(2026, 9, 31, 0, 30, 0);
  const now = around(start);
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noche",
      range: utcRange(start, end),
      days: [WD[start.getUTCDay()]],
      daysleft: 0,
      next: [],
    },
    now,
  );

  const guide = buildGuide(state, now);
  const block = guide.days[0].blocks.find((b) => b.name === "Noche");
  assert.ok(block, "crossing block missing");
  assert.equal(block.start, 23 * 60 + 30);
  assert.equal(block.end, 24 * 60 + 30, "the range was cut at midnight");
  assert.equal(
    guide.days[1]?.blocks.some((b) => b.name === "Noche"),
    false,
    "the crossing block was duplicated on the next day",
  );
});

test("a block still running after midnight keeps its range on today's card", () => {
  const start = new Date(2026, 9, 30, 23, 30, 0);
  const end = new Date(2026, 9, 31, 0, 30, 0);
  const heard = new Date(2026, 9, 30, 22, 0, 0);
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noche",
      range: utcRange(start, end),
      days: [WD[start.getUTCDay()]],
      daysleft: 0,
      next: [],
    },
    heard,
  );

  const guide = buildGuide(state, new Date(2026, 9, 31, 0, 20, 0));
  const block = guide.days[0].blocks.find((b) => b.name === "Noche");
  assert.ok(block, "the running overnight block was missing");
  assert.equal(block.start, -30);
  assert.equal(block.end, 30);
});

test("only overlapping blocks share lanes", () => {
  const clusters = layoutBlocks([
    { call: "LU1AQY", name: "A", start: 0, end: 60 },
    { call: "LU1AQY", name: "B", start: 30, end: 90 },
    { call: "LU2ZZZ", name: "C", start: 120, end: 180 },
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].lanes.length, 2, "same-callsign overlap did not split");
  assert.equal(clusters[0].blocks.find((b) => b.name === "A").laneCount, 2);
  assert.equal(clusters[1].lanes.length, 1);
  assert.equal(clusters[1].blocks[0].laneCount, 1);
  assert.equal(clusters[1].blocks[0].lane, 0);

  const mixed = layoutBlocks([
    { call: "LU1AQY", name: "A", start: 0, end: 60 },
    { call: "LU2ZZZ", name: "B", start: 30, end: 90 },
  ]);
  assert.equal(mixed[0].lanes.length, 2, "different callsigns overlap should split");
});

test("the hour row runs 12 hours past the last program and keeps its start", () => {
  const now = new Date(2026, 9, 30, 21, 7, 0);
  const first = new Date(2026, 9, 30, 21, 0, 0);
  const second = new Date(2026, 9, 30, 22, 10, 0);
  const secondEnd = new Date(2026, 9, 30, 23, 0, 0);
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noticias",
      range: utcRange(first, new Date(2026, 9, 30, 22, 0, 0)),
      days: [WD[first.getUTCDay()]],
      daysleft: 3,
      next: [
        {
          name: "Noche",
          range: utcRange(second, secondEnd),
          days: [WD[second.getUTCDay()]],
          daysleft: 3,
        },
      ],
    },
    now,
  );

  const guide = buildGuide(state, now);
  assert.ok(Math.abs(guide.end - 23 * 60) < 0.01);
  assert.ok(guide.start > 21 * 60);
  const span = extendSpan(now, guide.end, guide.start, null);
  const hour = new Date(2026, 9, 30, 21, 0, 0).getTime();
  const end = new Date(2026, 9, 31, 11, 0, 0).getTime();
  assert.equal(span.start, hour);
  assert.equal(span.end, end);
  const later = extendSpan(new Date(2026, 9, 30, 22, 0, 0), guide.end, guide.start, span);
  assert.equal(later.start, hour);
  assert.equal(later.end, end);

  const clusters = layoutInSpan(guide.blocks, span.start, span.end);
  const names = clusters.flatMap((c) => c.blocks).map((b) => b.name);
  assert.ok(names.includes("Noticias"));
  assert.ok(names.includes("Noche"));
});
