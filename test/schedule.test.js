import assert from "node:assert/strict";
import test from "node:test";
import { buildGuide, dateKey, emptyGuide, extendSpan, ingest, lanesInSpan } from "../www/js/schedule.js";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

test("two calls at the same time split the hour row and the day", () => {
  const now = new Date(2026, 9, 30, 21, 7, 0);
  const today = WD[now.getDay()];
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noticias",
      range: "21:00-22:00",
      days: [today],
      daysleft: 3,
      next: [{ name: "Noche", range: "22:10-23:00", days: [today], daysleft: 3 }],
    },
    now,
  );
  ingest(
    state,
    {
      kind: "info",
      call: "LU2ZZZ",
      name: "Clima",
      range: "21:30-22:30",
      days: [today],
      daysleft: 3,
      next: [],
    },
    now,
  );
  const guide = buildGuide(state, now);
  assert.ok(Math.abs(guide.end - 23 * 60) < 0.01);
  assert.ok(guide.start > 21 * 60);
  assert.equal(guide.lanes.length, 2);
  const day = guide.days[0];
  assert.equal(dateKey(day.date), dateKey(now));
  assert.equal(day.columns.length, 2);
  assert.deepEqual(
    day.columns.map((c) => c.call),
    ["LU1AQY", "LU2ZZZ"],
  );
});

test("daysleft stops the program and a common block stays on the heard date", () => {
  const now = new Date(2026, 9, 30, 15, 0, 0);
  const today = WD[now.getDay()];
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noticias",
      range: "18:00-19:00",
      days: WD.slice(),
      daysleft: 1,
      next: [{ name: "Bloque", range: "23:00-23:30", days: [], daysleft: 0 }],
    },
    now,
  );
  const guide = buildGuide(state, now);
  assert.equal(guide.days.length, 1);
  assert.equal(guide.days[0].columns[0].blocks.some((b) => b.name === "Noticias"), true);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
  const later = buildGuide(state, tomorrow);
  assert.equal(later.days[0].columns.some((c) => c.blocks.some((b) => b.name === "Noticias")), false);
  assert.equal(guide.undated.length, 1);
  assert.equal(guide.undated[0].name, "Bloque");
  assert.equal(guide.lanes.some((lane) => lane.blocks.some((b) => b.name === "Bloque")), false);
});

test("a midnight block leaves a tail on the next morning", () => {
  const now = new Date(2026, 9, 30, 23, 10, 0);
  const today = WD[now.getDay()];
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noche",
      range: "22:00-01:00",
      days: [today],
      daysleft: 2,
      next: [],
    },
    now,
  );
  const tonight = buildGuide(state, now);
  assert.equal(tonight.end, 1440);
  assert.ok(tonight.lanes[0].blocks.some((b) => b.name === "Noche"));
  const morning = new Date(2026, 9, 31, 0, 20, 0);
  const tail = buildGuide(state, morning);
  assert.ok(tail.lanes.some((lane) => lane.blocks.some((b) => b.name === "Noche" && b.end === 60)));
});

test("the hour row runs 12 hours past the last program and keeps its start", () => {
  const now = new Date(2026, 9, 30, 21, 7, 0);
  const today = WD[now.getDay()];
  const state = emptyGuide();
  ingest(
    state,
    {
      kind: "info",
      call: "LU1AQY",
      name: "Noticias",
      range: "21:00-22:00",
      days: [today],
      daysleft: 3,
      next: [{ name: "Noche", range: "22:10-23:00", days: [today], daysleft: 3 }],
    },
    now,
  );
  const guide = buildGuide(state, now);
  const span = extendSpan(now, guide.end, guide.start, null);
  const hour = new Date(2026, 9, 30, 21, 0, 0).getTime();
  const end = new Date(2026, 9, 31, 11, 0, 0).getTime();
  assert.equal(span.start, hour);
  assert.equal(span.end, end);
  const later = extendSpan(new Date(2026, 9, 30, 22, 0, 0), guide.end, guide.start, span);
  assert.equal(later.start, hour);
  assert.equal(later.end, end);
  const lanes = lanesInSpan(guide.days, span.start, span.end);
  assert.equal(lanes.length, 1);
  assert.ok(lanes[0].blocks.some((b) => b.name === "Noticias"));
  assert.ok(lanes[0].blocks.some((b) => b.name === "Noche"));
});
