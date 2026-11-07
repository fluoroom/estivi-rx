import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatLabel } from "../www/js/engine.js";
import { STRINGS, detectLocale, setLocale, t } from "../www/js/i18n.js";

test("English and Spanish carry the same keys", () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.es).sort());
});

test("every key used by the page exists in both languages", () => {
  const root = new URL("../www/", import.meta.url);
  const files = ["index.html", "js/app.js", "js/engine.js", "js/store.js"];
  const keys = new Set(["dow.0", "dow.1", "dow.2", "dow.3", "dow.4", "dow.5", "dow.6"]);
  for (const file of files) {
    const text = readFileSync(new URL(file, root), "utf8");
    for (const m of text.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/\bt\("([^"]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/(?:keyedError|storeError)\("([^"]+)"/g)) keys.add(m[1]);
  }
  for (const key of keys) {
    assert.ok(key in STRINGS.en, `missing English string: ${key}`);
    assert.ok(key in STRINGS.es, `missing Spanish string: ${key}`);
  }
});

test("Spanish and English labels and mark names", () => {
  try {
    setLocale("es");
    assert.equal(t("action.save"), "Guardar");
    assert.equal(t("mark.open", { name: "Noticias", time: "14:30" }), "Abrir Noticias, recibida a las 14:30");
    assert.equal(formatLabel("Noticias", "WELCOME"), "Noticias · Bienvenida");
    assert.equal(formatLabel("Noticias", "BUMPER POST"), "Noticias · Cortinilla posterior");

    setLocale("en");
    assert.equal(t("action.save"), "Save");
    assert.equal(t("mark.open", { name: "Noticias", time: "14:30" }), "Open Noticias received at 14:30");
    assert.equal(formatLabel("Noticias", "WELCOME"), "Noticias · Welcome");
  } finally {
    setLocale("en");
  }
});

test("auto detection returns a supported language", () => {
  assert.ok(["en", "es"].includes(detectLocale()));
});
