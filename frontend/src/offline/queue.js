/**
 * Offline photo queue (IndexedDB, on this device only). Photos taken while
 * offline wait here and are sent for the full server analysis (Grad-CAM,
 * RAG, explanation) when the connection returns, then deleted.
 */
const DB = "agrisight-offline";
const STORE = "photos";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error);
      })
  );
}

export const enqueuePhoto = (blob, language, offlineResult = null) =>
  tx("readwrite", (s) => s.add({ blob, language, offlineResult, createdAt: new Date().toISOString() }));
export const listQueued = () => tx("readonly", (s) => s.getAll());
export const removeQueued = (id) => tx("readwrite", (s) => s.delete(id));

/** Sends every queued photo with `predict(blob, language)`; returns [{id, result|error}]. */
export async function flushQueue(predict) {
  const items = await listQueued();
  const results = [];
  for (const item of items) {
    try {
      const result = await predict(item.blob, item.language);
      await removeQueued(item.id);
      results.push({ id: item.id, createdAt: item.createdAt, result });
    } catch (error) {
      results.push({ id: item.id, error: String(error?.message || error) });
      if (error?.status === 429) break; // rate limited: try the rest later
    }
  }
  return results;
}
