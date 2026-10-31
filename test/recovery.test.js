import assert from "node:assert/strict";
import test from "node:test";
import { parseEstivi } from "../www/js/ax25.js";
import { remoteName, searchNames, stampOf } from "../www/js/recovery.js";

test("the recovery name is callsign then day month year then time", () => {
  const date = new Date(2026, 9, 31, 14, 5, 9);
  assert.equal(stampOf(date), "31102026140509");
  assert.equal(remoteName("LU1AQY", "31102026140509"), "@LU1AQY31102026140509.BMP");
  assert.equal(remoteName("W1AW/P", "31102026140509"), "@W1AW/P31102026140509.BMP");
  assert.equal(remoteName("", "31102026140509"), "");
  assert.equal(remoteName("../x", "31102026140509"), "");
  assert.equal(remoteName("LU1AQY", "31102026"), "");
});

test("a search walks backward one second at a time", () => {
  const end = new Date(2026, 9, 31, 14, 5, 9).getTime();
  const names = searchNames("LU1AQY", end, 2);
  assert.deepEqual(names, [
    "@LU1AQY31102026140509.BMP",
    "@LU1AQY31102026140508.BMP",
    "@LU1AQY31102026140507.BMP",
  ]);
  assert.equal(searchNames("LU1AQY", end, 500).length, 241);
});

test("a YoniQ mode frame keeps its mark and its stamp", () => {
  const plain = parseEstivi("ESTIVI MODE YQ\n");
  assert.equal(plain.short, "YQ");
  assert.equal(plain.mark, "");
  assert.equal(plain.stamp, "");
  const stamped = parseEstivi("ESTIVI MODE YQ WELCOME 31102026140509\n");
  assert.equal(stamped.mark, "WELCOME");
  assert.equal(stamped.stamp, "31102026140509");
  const other = parseEstivi("ESTIVI MODE R36 WELCOME\n");
  assert.equal(other.mark, "WELCOME");
  assert.equal(other.stamp, "");
});
