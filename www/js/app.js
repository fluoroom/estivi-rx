import { Engine } from "./engine.js";
import { detectLocale, getLocale, setLocale, t } from "./i18n.js";
import { MODES, modeByShort } from "./modes.js";
import { buildGuide, extendSpan, ingest, layoutBlocks, layoutInSpan } from "./schedule.js";
import {
  clearGuide,
  clearImages,
  forgetImage,
  loadGuide,
  loadImages,
  loadPrefs,
  rememberImage,
  saveGuide,
  savePrefs,
} from "./store.js";

const $ = (id) => document.getElementById(id);

let prefs = {};
let guideState = { stations: {} };
let images = [];
let pinned = null;
let showing = "live";
let selectedId = null;
let liveName = "";
let receivingPicture = false;
let heldPicture = false;
let receiving = false;
let engine = null;
let audio = null;
let seq = 0;
let rxSeq = 0;
let imageSeq = 0;
let fillingDevices = false;
let channelMode = "mono";
let theme = "dark";
let scaleMode = "bicubic";
let scaleChosen = false;
let langPref = "auto";
let lastError = null;
let lastMode = "";
let vu = 0;
let pictureAr = 320 / 256;
let revealedRow = 0;
let noiseTimer = 0;
let noiseFrames = [];
let noiseFrame = 0;
let noiseSize = "";

function dbToGain(v) {
  return 10 ** (Number(v) / 20);
}

function formatDb(v) {
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${n > 0 ? "+" : ""}${s} dB`;
}

function paintGainTrack() {
  const el = $("gain");
  const span = Number(el.max) - Number(el.min) || 1;
  const pct = ((Number(el.value) - Number(el.min)) / span) * 100;
  const zero = ((0 - Number(el.min)) / span) * 100;
  el.style.setProperty("--fill", `${pct}%`);
  el.style.setProperty("--zero", `${zero}%`);
  $("gain-out").classList.toggle("hot", Number(el.value) > 0);
}

// Display local HH:MM for a minute count; values past 1440 wrap, so a range
// 23:30-00:30 is shown whole and never cut at midnight.
function hhmm(mins) {
  const total = Math.round(Number(mins) || 0);
  const m = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function clock(ms) {
  const d = new Date(ms);
  return hhmm(d.getHours() * 60 + d.getMinutes());
}

function clockRange(startMs, endMs) {
  return `${clock(startMs)}–${clock(endMs)}`;
}

function two(n) {
  return String(n).padStart(2, "0");
}

function updateClock() {
  const now = new Date();
  $("clock-local").textContent = `${two(now.getHours())}:${two(now.getMinutes())}:${two(
    now.getSeconds(),
  )}`;
  $("clock-utc").textContent = `UTC ${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(
    now.getUTCSeconds(),
  )}`;
}

function selectedMode() {
  const v = $("mode").value;
  if (!v || v === "auto") return null;
  return MODES.find((m) => m.short === v) || null;
}

function setAspect(w, h) {
  if (!(w > 0 && h > 0)) return;
  pictureAr = w / h;
  $("picture").style.aspectRatio = `${w} / ${h}`;
  fitPicture();
}

function fitPicture() {
  const stage = $("stage");
  const pic = $("picture");
  if (!stage || !pic) return;
  const bar = document.querySelector(".bar");
  if (window.matchMedia("(max-width: 720px)").matches) {
    pic.style.width = "100%";
    pic.style.height = "auto";
    if (bar) bar.style.width = "100%";
    present();
    return;
  }
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (sw < 2 || sh < 2) return;
  let w = sw;
  let h = w / pictureAr;
  if (h > sh) {
    h = sh;
    w = h * pictureAr;
  }
  pic.style.width = `${Math.floor(w)}px`;
  pic.style.height = `${Math.floor(h)}px`;
  if (bar) bar.style.width = `${Math.floor(w)}px`;
  present();
}

function makeNoiseFrame(w, h) {
  const frame = document.createElement("canvas");
  frame.width = w;
  frame.height = h;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = 6 + ((Math.random() * 26) | 0);
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  frame.getContext("2d").putImageData(new ImageData(data, w, h), 0, 0);
  return frame;
}

function noiseFor(w, h) {
  const key = `${w}x${h}`;
  if (noiseSize === key && noiseFrames.length === 5) return noiseFrames;
  noiseFrames = Array.from({ length: 5 }, () => makeNoiseFrame(w, h));
  noiseFrame = 0;
  noiseSize = key;
  return noiseFrames;
}

function paintNoise() {
  if (heldPicture) return;
  const live = $("live");
  const noise = $("noise");
  if (!live.width || !live.height) return;
  if (noise.width !== live.width || noise.height !== live.height) {
    noise.width = live.width;
    noise.height = live.height;
  }
  const y0 = receivingPicture ? revealedRow : 0;
  const y1 = live.height;
  if (y1 <= y0) return;
  const frames = noiseFor(live.width, live.height);
  const frame = frames[noiseFrame];
  noiseFrame = (noiseFrame + 1) % frames.length;
  const ctx = noise.getContext("2d");
  ctx.clearRect(0, 0, noise.width, noise.height);
  ctx.drawImage(frame, 0, y0, live.width, y1 - y0, 0, y0, live.width, y1 - y0);
  paintThumb();
  present();
}

function startNoise() {
  if (heldPicture || document.hidden) return;
  $("noise").hidden = false;
  paintNoise();
  if (noiseTimer) return;
  noiseTimer = setInterval(paintNoise, 1000 / 15);
}

function stopNoise() {
  if (noiseTimer) {
    clearInterval(noiseTimer);
    noiseTimer = 0;
  }
}

function hideNoise() {
  stopNoise();
  const noise = $("noise");
  if (!noise) return;
  noise.hidden = true;
  if (noise.width) noise.getContext("2d").clearRect(0, 0, noise.width, noise.height);
  paintThumb();
  present();
}

function setName(text) {
  $("name").textContent = text || "";
}

function applyScale() {
  const pic = $("picture");
  pic.dataset.scale = scaleMode;
  const btn = $("scale-mode");
  btn.textContent = scaleMode === "bicubic" ? t("scale.pixels") : t("scale.blur");
  btn.title = t("scale.title");
  btn.setAttribute("aria-label", t("scale.title"));
  btn.setAttribute("aria-pressed", scaleMode === "bicubic" ? "true" : "false");
  present();
}

function paintRun() {
  const btn = $("run");
  btn.textContent = receiving ? t("run.stop") : t("run.start");
  btn.classList.toggle("on", receiving);
}

function applyLanguage() {
  document.documentElement.lang = getLocale();
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
  $("lang").value = langPref;
  applyTheme(theme);
  applyScale();
  paintRun();
  if (!$("err").hidden && lastError) $("err").textContent = describeError(lastError);
}

function present() {
  const scale = $("scale");
  const pic = $("picture");
  if (!scale || !pic) return;
  if (scaleMode !== "bicubic") {
    scale.hidden = true;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(pic.clientWidth * dpr));
  const h = Math.max(1, Math.round(pic.clientHeight * dpr));
  if (scale.width !== w || scale.height !== h) {
    scale.width = w;
    scale.height = h;
  }
  scale.hidden = false;
  const ctx = scale.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  const still = $("still");
  if (showing === "still" && still.complete && still.naturalWidth) {
    ctx.drawImage(still, 0, 0, w, h);
    return;
  }
  const live = $("live");
  if (live.width) ctx.drawImage(live, 0, 0, w, h);
  const noise = $("noise");
  if (!heldPicture && noise && !noise.hidden && noise.width) ctx.drawImage(noise, 0, 0, w, h);
}

function reveal() {
  const live = $("live");
  const still = $("still");
  live.hidden = showing !== "live";
  still.hidden = showing !== "still";
}

function applyIdleAspect() {
  if (showing !== "live" || receivingPicture) return;
  const m = selectedMode();
  setAspect(m ? m.w : 320, m ? m.h : 256);
}

function markSelection() {
  const root = $("timeline");
  if (!root) return;
  const want = selectedId == null ? "" : String(selectedId);
  for (const el of root.querySelectorAll("button.thumb")) {
    const on = el.classList.contains("live-thumb") ? showing === "live" : el.dataset.id === want;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function showLive() {
  showing = "live";
  selectedId = null;
  $("delete").hidden = true;
  reveal();
  if (receivingPicture) {
    const live = $("live");
    setAspect(live.width, live.height);
  } else applyIdleAspect();
  setName(liveName);
  markSelection();
  present();
}

function stillSrc(item) {
  if (!item) return "";
  if (item.url) return item.url;
  if (item.png) {
    item.url = URL.createObjectURL(item.png);
    return item.url;
  }
  return "";
}

function showStill(item) {
  const pic = item || images.find((it) => it.id === selectedId) || images[0];
  if (!pic) {
    showLive();
    return;
  }
  selectedId = pic.id;
  showing = "still";
  $("delete").hidden = false;
  const still = $("still");
  still.onload = () => present();
  still.src = stillSrc(pic);
  still.alt = pic.name || t("picture.one");
  setAspect(pic.w || 320, pic.h || 256);
  setName(pic.name || "");
  reveal();
  markSelection();
  present();
}

function paintThumb() {
  const thumb = $("thumb");
  const live = $("live");
  if (!thumb || !live.width) return;
  thumb.width = live.width;
  thumb.height = live.height;
  const liveBtn = thumb.closest("button");
  if (liveBtn) liveBtn.style.aspectRatio = `${live.width} / ${live.height}`;
  const ctx = thumb.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  if (heldPicture || receivingPicture) ctx.drawImage(live, 0, 0);
  const noise = $("noise");
  if (!heldPicture && noise && !noise.hidden && noise.width) ctx.drawImage(noise, 0, 0);
}

function renderTimeline() {
  const root = $("timeline");
  root.replaceChildren();
  const live = $("live");
  const liveBtn = document.createElement("button");
  liveBtn.type = "button";
  liveBtn.className = "thumb live-thumb";
  liveBtn.setAttribute("aria-label", t("live"));
  if (live.width && live.height) liveBtn.style.aspectRatio = `${live.width} / ${live.height}`;
  const thumb = document.createElement("canvas");
  thumb.id = "thumb";
  thumb.width = live.width;
  thumb.height = live.height;
  liveBtn.append(thumb);
  liveBtn.addEventListener("click", () => showLive());
  root.append(liveBtn);
  paintThumb();
  for (const item of images) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb";
    btn.dataset.id = String(item.id);
    btn.setAttribute("aria-pressed", "false");
    const img = document.createElement("img");
    const src = stillSrc(item);
    if (src) img.src = src;
    img.alt = item.name || t("picture.one");
    if (item.w && item.h) btn.style.aspectRatio = `${item.w} / ${item.h}`;
    btn.append(img);
    btn.addEventListener("click", () => showStill(item));
    root.append(btn);
  }
  markSelection();
}

function tick(parent, frac, text, edge) {
  const el = document.createElement("span");
  el.textContent = text;
  el.style.left = `${frac * 100}%`;
  if (edge) el.className = edge;
  parent.append(el);
}

function renderHours(guide, span) {
  const duration = Math.max(1, span.end - span.start);
  const clusters = layoutInSpan(guide.blocks, span.start, span.end);
  const blocks = clusters.flatMap((c) => c.blocks);
  const maxLanes = Math.max(1, ...clusters.map((c) => c.lanes.length));
  const mixed = new Set(blocks.map((b) => b.call).filter(Boolean)).size > 1;

  const axis = $("axis");
  axis.replaceChildren();
  tick(axis, 0, clock(span.start), "start");
  tick(axis, 1, clock(span.end), "end");
  const width = axis.clientWidth;
  if (width >= 48) {
    const labelW = 36;
    let lastRight = labelW;
    const endLeft = width - labelW;
    const first = new Date(span.start);
    first.setMinutes(0, 0, 0);
    first.setHours(first.getHours() + 1);
    for (let t = first.getTime(); t < span.end; t += 60 * 60 * 1000) {
      const frac = (t - span.start) / duration;
      const center = frac * width;
      const left = center - labelW / 2;
      const right = center + labelW / 2;
      if (left < lastRight + 8) continue;
      if (right > endLeft - 8) continue;
      tick(axis, frac, clock(t));
      lastRight = right;
    }
  }

  const root = $("lanes");
  root.replaceChildren();
  const track = document.createElement("div");
  track.className = "track hour-track";
  track.style.height = `${Math.round(maxLanes * 1.35 * 10) / 10}rem`;
  for (const b of blocks) {
    const el = document.createElement("div");
    el.className = "block";
    const left = Math.max(0, (b.start - span.start) / duration);
    const size = Math.max(0, (b.end - b.start) / duration);
    el.style.left = `${left * 100}%`;
    el.style.width = `${size * 100}%`;
    el.style.top = `calc(${(b.lane / b.laneCount) * 100}% + 2px)`;
    el.style.height = `calc(${(1 / b.laneCount) * 100}% - 4px)`;
    const label = document.createElement("span");
    label.textContent = mixed && b.call ? `${b.name} · ${b.call}` : b.name;
    el.append(label);
    el.title = `${b.name}${b.call ? ` · ${b.call}` : ""} · ${clockRange(b.startMs, b.endMs)}`;
    track.append(el);
  }
  root.append(track);
  drawMarks(span);
}

function drawMarks(span) {
  const host = $("marks");
  host.replaceChildren();
  const now = document.createElement("div");
  now.id = "now-line";
  now.className = "now-line";
  host.append(now);
  for (const item of images) {
    if (!(item.at >= span.start && item.at <= span.end)) continue;
    const line = document.createElement("button");
    line.type = "button";
    line.className = "rx-line";
    line.dataset.at = String(item.at);
    line.title = `${item.name || t("picture.one")} · ${clock(item.at)}`;
    line.setAttribute(
      "aria-label",
      t("mark.open", { name: item.name || t("picture.lower"), time: clock(item.at) }),
    );
    line.addEventListener("click", () => showStill(item));
    host.append(line);
  }
  placeMarks();
}

function placeMarks() {
  if (!pinned) return;
  const axis = $("axis");
  const nowLine = $("now-line");
  if (!axis || !nowLine) return;
  const hours = axis.closest(".hours");
  const width = axis.clientWidth;
  if (width < 2) return;
  const left = axis.getBoundingClientRect().left - hours.getBoundingClientRect().left;
  const duration = pinned.end - pinned.start;
  const put = (el, ms) => {
    const frac = Math.min(1, Math.max(0, (ms - pinned.start) / duration));
    el.style.left = `${left + frac * width}px`;
  };
  put(nowLine, Date.now());
  for (const line of $("marks").querySelectorAll(".rx-line")) put(line, Number(line.dataset.at));
}

function renderCalendar(guide) {
  const body = $("cal-body");
  body.replaceChildren();
  const days = document.createElement("div");
  days.className = "days";
  for (const day of guide.days) {
    const card = document.createElement("section");
    card.className = "day";
    const h = document.createElement("h3");
    h.textContent = `${t(`dow.${day.date.getDay()}`)} ${day.date.getDate()}`;
    card.append(h);
    const inner = document.createElement("div");
    inner.className = "day-body";
    const clusters = layoutBlocks(day.blocks.map((b) => ({ ...b })));
    for (const cluster of clusters) {
      const wrap = document.createElement("div");
      wrap.className = cluster.lanes.length > 1 ? "cluster split" : "cluster";
      for (const lane of cluster.lanes) {
        const column = document.createElement("div");
        column.className = "col";
        for (const b of lane) {
          const prog = document.createElement("p");
          prog.className = "prog";
          const time = document.createElement("time");
          time.textContent = `${hhmm(b.start)}–${hhmm(b.end)}`;
          prog.append(time);
          prog.append(document.createTextNode(b.name));
          if (b.call) {
            const call = document.createElement("span");
            call.className = "prog-call";
            call.textContent = b.call;
            prog.append(call);
          }
          column.append(prog);
        }
        wrap.append(column);
      }
      inner.append(wrap);
    }
    card.append(inner);
    days.append(card);
  }
  body.append(days);
}

function renderGuide() {
  const now = new Date();
  const guide = buildGuide(guideState, now);
  pinned = extendSpan(now, guide.end, guide.start, pinned);
  renderHours(guide, pinned);
  if ($("calendar").open) renderCalendar(guide);
  updateClock();
}

function pngOfVisor() {
  if (showing === "still" && $("still").src) {
    const img = $("still");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || images[0]?.w || 320;
    c.height = img.naturalHeight || images[0]?.h || 256;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }
  return $("live").toDataURL("image/png");
}

function pngBlob(rgba, w, h) {
  return new Promise((resolve, reject) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(keyedError("error.png"))),
      "image/png",
    );
  });
}

async function finishReception(ev) {
  const my = rxSeq;
  receivingPicture = false;
  // Hold the finished frame while the lossless copy is encoded and written,
  // so the live noise does not paint over it in the meantime.
  heldPicture = true;
  hideNoise();
  const at = Date.now();
  let png;
  try {
    png = await pngBlob(ev.rgba, ev.width, ev.height);
  } catch (err) {
    fail(err);
    if (ev.lost && my === rxSeq) {
      heldPicture = false;
      showLive();
      startNoise();
    }
    return;
  }
  const item = {
    id: `${at}-${++imageSeq}`,
    png,
    name: ev.name || liveName || "",
    w: ev.width,
    h: ev.height,
    mode: ev.mode || "",
    call: ev.call || "",
    at,
  };
  try {
    images = await rememberImage(item);
  } catch (err) {
    fail(err);
    item.url = URL.createObjectURL(png);
    images = [item, ...images].slice(0, 40);
  }
  renderTimeline();
  renderGuide();
  if (my !== rxSeq) return;
  if (ev.lost) {
    // The picture had already lost its signal. The copy is in the timeline;
    // the visor goes back to the live decoder instead of holding it.
    heldPicture = false;
    showLive();
    startNoise();
    return;
  }
  const shown = images.find((it) => it.id === item.id) || images[0];
  if (shown) showStill(shown);
}

function onEvent(ev) {
  if (ev.type === "info") {
    guideState = ingest(guideState, ev.packet, new Date());
    void saveGuide(guideState).catch((err) => fail(err));
    renderGuide();
    return;
  }
  if (ev.type === "label") {
    liveName = ev.name || liveName;
    if (showing === "live") setName(liveName);
    return;
  }
  if (ev.type === "rx") {
    rxSeq++;
    heldPicture = false;
    receivingPicture = true;
    if (ev.mode && ev.mode !== lastMode) {
      lastMode = ev.mode;
      saveCurrentPrefs();
    }
    liveName = ev.name || liveName;
    const live = $("live");
    live.width = ev.width;
    live.height = ev.height;
    revealedRow = 0;
    const ctx = live.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, live.width, live.height);
    setAspect(ev.width, ev.height);
    showLive();
    startNoise();
    return;
  }
  if (ev.type === "rows") {
    revealedRow = Math.max(revealedRow, ev.y + ev.count);
    const data = new Uint8ClampedArray(ev.rgba);
    $("live").getContext("2d").putImageData(new ImageData(data, ev.width, ev.count), 0, ev.y);
    const noise = $("noise");
    if (noise.width) noise.getContext("2d").clearRect(0, 0, noise.width, revealedRow);
    paintThumb();
    present();
    return;
  }
  if (ev.type === "rx-end") {
    void finishReception(ev);
  }
}

function saveCurrentPrefs() {
  void savePrefs({
    device: $("device").value,
    channel: channelMode,
    gain: Number($("gain").value),
    mode: $("mode").value,
    lastMode,
    theme,
    scale: scaleMode,
    scaleChosen,
    lang: langPref,
  }).catch((err) => fail(err));
}

function resetVu() {
  vu = 0;
  for (const cell of $("vu-bar").children) cell.classList.remove("on");
  $("vu-read").textContent = "—";
}

function paintLevel(rms) {
  const db = 20 * Math.log10(Math.max(rms, 1e-8));
  const target = Math.min(1, Math.max(0, (db + 42) / 42));
  vu = Math.max(target, vu * 0.8);
  const cells = $("vu-bar").children;
  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.toggle("on", (i + 1) / cells.length <= vu + 0.001);
  }
  $("vu-read").textContent = db < -60 ? "—" : `${db.toFixed(0)} dB`;
}

async function loadTap(ctx) {
  const base = import.meta.url;
  const [dsp, tap] = await Promise.all([
    fetch(new URL("./dsp.js", base)).then((res) => res.text()),
    fetch(new URL("./tap-worklet.js", base)).then((res) => res.text()),
  ]);
  const code = `${dsp.replace(/^export /gm, "")}\n${tap}`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function keyedError(key, cause) {
  const err = new Error(t(key));
  err.key = key;
  if (cause !== undefined) err.cause = cause;
  return err;
}

function describeError(err) {
  if (err && err.key) return t(err.key);
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "SecurityError") return t("error.micDenied");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return t("error.micMissing");
  if (name === "NotReadableError" || name === "TrackStartError") return t("error.micBusy");
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return t("error.micConstraint");
  }
  if (name === "AbortError") return t("error.micAbort");
  return err && err.message ? err.message : t("error.mic");
}

function fail(err) {
  lastError = err || keyedError("error.mic");
  const el = $("err");
  el.hidden = false;
  el.textContent = describeError(lastError);
}

function clearErr() {
  lastError = null;
  $("err").hidden = true;
  $("err").textContent = "";
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  fillingDevices = true;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const inputs = list.filter((d) => d.kind === "audioinput");
    const sel = $("device");
    const cur = sel.value;
    sel.replaceChildren();
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.dataset.i18n = "device.default";
    fallback.textContent = t("device.default");
    sel.append(fallback);
    for (const d of inputs) {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      if (d.label) opt.textContent = d.label;
      else {
        opt.dataset.i18n = "device.audioInput";
        opt.textContent = t("device.audioInput");
      }
      sel.append(opt);
    }
    if (cur && ![...sel.options].some((o) => o.value === cur)) {
      const keep = document.createElement("option");
      keep.value = cur;
      keep.dataset.i18n = "device.saved";
      keep.textContent = t("device.saved");
      sel.append(keep);
    }
    if (cur) sel.value = cur;
  } finally {
    fillingDevices = false;
  }
}

async function shutdown() {
  receiving = false;
  const stoppedMid = receivingPicture;
  receivingPicture = false;
  if (stoppedMid) {
    heldPicture = true;
    hideNoise();
  }
  paintRun();
  resetVu();
  const cur = audio;
  audio = null;
  engine = null;
  if (!cur) return;
  cur.node.port.onmessage = null;
  cur.stream.getTracks().forEach((t) => t.stop());
  try {
    await cur.ctx.close();
  } catch {
    /* already closed */
  }
}

async function openStream(deviceId) {
  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audioConstraints.deviceId = { exact: deviceId };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...audioConstraints, channelCount: 2 },
      video: false,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
  }
}

function applyTheme(next) {
  theme = next === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  $("theme").textContent = theme === "dark" ? t("theme.toLight") : t("theme.toDark");
}

async function start(opts = {}) {
  const my = ++seq;
  await shutdown();
  if (my !== seq) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    fail(keyedError("error.noMicAccess"));
    return;
  }
  let stream = null;
  let ctx = null;
  try {
    stream = await openStream($("device").value);
    if (my !== seq) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    ctx = new AudioContext();
    await ctx.resume();
    await loadTap(ctx);
    if (my !== seq) {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
      return;
    }
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = dbToGain($("gain").value);
    const node = new AudioWorkletNode(ctx, "tap");
    node.port.postMessage({ channel: channelMode });
    const eng = new Engine(ctx.sampleRate, { demod: false });
    eng.setLastMode(lastMode);
    eng.setMode($("mode").value);
    eng.onEvent = onEvent;
    node.port.onmessage = (msg) => {
      if (engine !== eng) return;
      eng.pushFreq(msg.data.freq);
      paintLevel(msg.data.rms);
    };
    src.connect(gain);
    gain.connect(node);
    engine = eng;
    audio = { ctx, stream, node, gain };
    receiving = true;
    paintRun();
    clearErr();
    await refreshDevices();
  } catch (err) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        /* already closed */
      }
    }
    if (my !== seq) return;
    await shutdown();
    const blocked = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
    if (!(opts.quiet && blocked)) fail(err);
  }
}

function stop() {
  seq++;
  shutdown();
}

function initControls() {
  const bar = $("vu-bar");
  for (let i = 0; i < 16; i++) bar.append(document.createElement("i"));
  for (const m of MODES) {
    const opt = document.createElement("option");
    opt.value = m.short;
    opt.textContent = m.name;
    $("mode").append(opt);
  }
  if (prefs.mode && [...$("mode").options].some((o) => o.value === prefs.mode)) $("mode").value = prefs.mode;
  $("channel").value = channelMode;
  if (Number.isFinite(prefs.gain)) $("gain").value = String(prefs.gain);
  $("gain-out").textContent = formatDb($("gain").value);
  paintGainTrack();
  if (prefs.device) {
    const opt = document.createElement("option");
    opt.value = prefs.device;
    opt.dataset.i18n = "device.saved";
    opt.textContent = t("device.saved");
    $("device").append(opt);
    $("device").value = prefs.device;
  }
  $("lang").value = langPref;

  $("gain").addEventListener("input", () => {
    $("gain-out").textContent = formatDb($("gain").value);
    paintGainTrack();
    if (audio) audio.gain.gain.value = dbToGain($("gain").value);
    saveCurrentPrefs();
  });
  $("channel").addEventListener("change", () => {
    channelMode = $("channel").value;
    if (audio) audio.node.port.postMessage({ channel: channelMode });
    saveCurrentPrefs();
  });
  $("mode").addEventListener("change", () => {
    if (engine) engine.setMode($("mode").value);
    applyIdleAspect();
    saveCurrentPrefs();
  });
  $("device").addEventListener("change", () => {
    if (fillingDevices) return;
    saveCurrentPrefs();
    if (receiving) start();
  });
  $("lang").addEventListener("change", () => {
    const value = $("lang").value;
    langPref = value === "en" || value === "es" ? value : "auto";
    setLocale(langPref === "auto" ? detectLocale() : langPref);
    applyLanguage();
    renderTimeline();
    renderGuide();
    saveCurrentPrefs();
  });
  $("run").addEventListener("click", () => {
    if (receiving) stop();
    else start();
  });
  $("theme").addEventListener("click", () => {
    applyTheme(theme === "dark" ? "light" : "dark");
    saveCurrentPrefs();
  });
  $("scale-mode").addEventListener("click", () => {
    scaleChosen = true;
    scaleMode = scaleMode === "bicubic" ? "neighbor" : "bicubic";
    applyScale();
    saveCurrentPrefs();
  });
  $("save").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = pngOfVisor();
    a.download = "estivi-rx.png";
    a.click();
  });
  $("delete").addEventListener("click", async () => {
    if (showing !== "still" || selectedId == null) return;
    if (!window.confirm(t("confirm.deleteImage"))) return;
    const id = selectedId;
    const item = images.find((it) => it.id === id);
    try {
      await forgetImage(id);
    } catch (err) {
      fail(err);
      return;
    }
    if (item && item.url) URL.revokeObjectURL(item.url);
    $("still").removeAttribute("src");
    images = images.filter((it) => it.id !== id);
    selectedId = null;
    heldPicture = false;
    renderTimeline();
    renderGuide();
    showLive();
    startNoise();
  });
  $("full").addEventListener("click", () => {
    const pic = $("picture");
    if (document.fullscreenElement) document.exitFullscreen();
    else pic.requestFullscreen();
  });
  $("reset").addEventListener("click", () => showLive());
  $("clear").addEventListener("click", async () => {
    if (!window.confirm(t("confirm.clearImages"))) return;
    try {
      await clearImages();
    } catch (err) {
      fail(err);
      return;
    }
    for (const item of images) if (item.url) URL.revokeObjectURL(item.url);
    images = [];
    renderTimeline();
    renderGuide();
    if (showing === "still") showLive();
  });
  $("clear-cal").addEventListener("click", async () => {
    if (!window.confirm(t("confirm.clearCalendar"))) return;
    try {
      await clearGuide();
    } catch (err) {
      fail(err);
      return;
    }
    guideState = { stations: {} };
    pinned = null;
    renderGuide();
    if ($("calendar").open) renderCalendar(buildGuide(guideState, new Date()));
  });
  $("cal").addEventListener("click", () => {
    renderCalendar(buildGuide(guideState, new Date()));
    $("calendar").showModal();
  });
  $("close-cal").addEventListener("click", () => $("calendar").close());
  $("calendar").addEventListener("click", (ev) => {
    if (ev.target === $("calendar")) $("calendar").close();
  });
}

async function boot() {
  try {
    prefs = await loadPrefs();
  } catch (err) {
    fail(err);
  }
  langPref = prefs.lang === "en" || prefs.lang === "es" ? prefs.lang : "auto";
  setLocale(langPref === "auto" ? detectLocale() : langPref);
  try {
    guideState = await loadGuide();
  } catch (err) {
    fail(err);
  }
  try {
    images = await loadImages();
  } catch (err) {
    fail(err);
  }

  channelMode = prefs.channel === "left" || prefs.channel === "right" ? prefs.channel : "mono";
  theme = prefs.theme === "light" ? "light" : "dark";
  scaleChosen = prefs.scaleChosen === true;
  scaleMode = scaleChosen && prefs.scale === "neighbor" ? "neighbor" : "bicubic";
  lastMode = modeByShort(prefs.lastMode) ? prefs.lastMode : "";
  showing = images.length ? "still" : "live";

  initControls();
  applyLanguage();
  renderTimeline();
  if (images.length) showStill();
  else showLive();
  fitPicture();
  startNoise();
  renderGuide();
  updateClock();
  setInterval(renderGuide, 20000);
  setInterval(updateClock, 1000);
  setInterval(() => {
    if (pinned && Date.now() >= pinned.end) renderGuide();
    else placeMarks();
  }, 1000);
  window.addEventListener("resize", () => {
    fitPicture();
    renderGuide();
  });
  new ResizeObserver(() => fitPicture()).observe($("stage"));
  requestAnimationFrame(() => requestAnimationFrame(() => fitPicture()));
  document.addEventListener("fullscreenchange", () => requestAnimationFrame(() => present()));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopNoise();
      return;
    }
    startNoise();
    renderGuide();
  });
  refreshDevices();
  start({ quiet: true });
}

boot();
