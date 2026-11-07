// Everything the page remembers lives in IndexedDB, under the database name
// "estivi rx": the pictures as lossless PNG blobs, the guide, and the
// preferences. Pictures are newest first, capped at MAX_ITEMS.

const DB_NAME = "estivi rx";
const DB_VERSION = 1;
const IMAGES = "images";
const META = "meta";
const GUIDE_KEY = "guide";
const PREFS_KEY = "prefs";
const MAX_ITEMS = 40;

let dbPromise = null;
const urls = new Map();

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("This browser has no IndexedDB"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMAGES)) {
          const store = db.createObjectStore(IMAGES, { keyPath: "id" });
          store.createIndex("at", "at");
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB could not be opened"));
      req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
    });
  }
  return dbPromise;
}

// Resolve when the request succeeds and the transaction commits.
function requestAndDone(tx, req) {
  return new Promise((resolve, reject) => {
    let value;
    let failed = false;
    req.onsuccess = () => {
      value = req.result;
    };
    req.onerror = () => {
      failed = true;
      reject(req.error || new Error("IndexedDB request failed"));
    };
    tx.oncomplete = () => {
      if (!failed) resolve(value);
    };
    tx.onabort = () => {
      if (!failed) reject(tx.error || new Error("IndexedDB transaction aborted"));
    };
  });
}

function finish(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

async function metaGet(key) {
  const db = await openDb();
  const tx = db.transaction(META, "readonly");
  return requestAndDone(tx, tx.objectStore(META).get(key));
}

async function metaSet(key, value) {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  await requestAndDone(tx, tx.objectStore(META).put(value, key));
}

async function metaDelete(key) {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  await requestAndDone(tx, tx.objectStore(META).delete(key));
}

function imageUrl(record) {
  if (!record || !record.png) return "";
  if (typeof record.png === "string") return record.png;
  let url = urls.get(record.id);
  if (!url) {
    url = URL.createObjectURL(record.png);
    urls.set(record.id, url);
  }
  return url;
}

function withUrl(record) {
  return { ...record, url: imageUrl(record) };
}

function pruneUrls(keep) {
  for (const [id, url] of urls) {
    if (keep.has(id)) continue;
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

async function readRecords() {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readonly");
  const records = await requestAndDone(tx, tx.objectStore(IMAGES).getAll());
  return (records || []).sort((a, b) => b.at - a.at);
}

export async function loadImages() {
  const records = await readRecords();
  const visible = records.slice(0, MAX_ITEMS);
  pruneUrls(new Set(visible.map((r) => r.id)));
  return visible.map(withUrl);
}

export async function rememberImage(item) {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readwrite");
  const record = {
    id: item.id,
    png: item.png,
    name: item.name || "",
    w: item.w,
    h: item.h,
    mode: item.mode || "",
    call: item.call || "",
    at: item.at,
  };
  await requestAndDone(tx, tx.objectStore(IMAGES).put(record));

  const records = await readRecords();
  const extra = records.slice(MAX_ITEMS);
  if (extra.length) {
    const tx2 = db.transaction(IMAGES, "readwrite");
    for (const old of extra) tx2.objectStore(IMAGES).delete(old.id);
    await finish(tx2);
    for (const old of extra) {
      const url = urls.get(old.id);
      if (url) {
        URL.revokeObjectURL(url);
        urls.delete(old.id);
      }
    }
  }
  return loadImages();
}

export async function forgetImage(id) {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readwrite");
  await requestAndDone(tx, tx.objectStore(IMAGES).delete(id));
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

export async function clearImages() {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readwrite");
  await requestAndDone(tx, tx.objectStore(IMAGES).clear());
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

export async function loadGuide() {
  const data = await metaGet(GUIDE_KEY);
  if (!data || !data.stations) return { stations: {} };
  return data;
}

export async function saveGuide(state) {
  await metaSet(GUIDE_KEY, state);
}

export async function clearGuide() {
  await metaDelete(GUIDE_KEY);
}

export async function loadPrefs() {
  const data = await metaGet(PREFS_KEY);
  return data && typeof data === "object" ? data : {};
}

export async function savePrefs(prefs) {
  await metaSet(PREFS_KEY, prefs);
}
