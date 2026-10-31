const IMAGES = "estivi-rx-images";
const GUIDE = "estivi-rx-guide";
const PREFS = "estivi-rx-prefs";
const MAX_CHARS = 4_000_000;
const MAX_ITEMS = 40;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadImages() {
  const data = read(IMAGES, null);
  return data && Array.isArray(data.items) ? data.items : [];
}

export function saveImages(items) {
  let list = items.slice(0, MAX_ITEMS);
  while (list.length) {
    try {
      const json = JSON.stringify({ v: 1, items: list });
      if (json.length > MAX_CHARS) {
        list.pop();
        continue;
      }
      localStorage.setItem(IMAGES, json);
      return list;
    } catch {
      list.pop();
    }
  }
  try {
    localStorage.removeItem(IMAGES);
  } catch {
    /* private mode */
  }
  return [];
}

export function rememberImage(item) {
  const items = loadImages();
  items.unshift(item);
  return saveImages(items);
}

export function clearImages() {
  try {
    localStorage.removeItem(IMAGES);
  } catch {
    /* private mode */
  }
}

export function loadGuide() {
  const data = read(GUIDE, null);
  if (!data || !data.stations) return { stations: {} };
  return data;
}

export function saveGuide(state) {
  try {
    write(GUIDE, state);
  } catch {
    /* quota or private mode */
  }
}

export function loadPrefs() {
  return read(PREFS, {});
}

export function savePrefs(prefs) {
  try {
    write(PREFS, prefs);
  } catch {
    /* private mode */
  }
}
