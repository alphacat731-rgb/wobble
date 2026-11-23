import type { CustomPreset, ProjectFile } from "@/lib/jiggle/types";

const PRESET_KEY = "wobble-presets-v1";
const DB_NAME = "wobble";
const STORE = "kv";

export function loadCustomPresets(): CustomPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && item.params);
  } catch {
    return [];
  }
}

export function saveCustomPresets(list: CustomPreset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(list));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(project: ProjectFile) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(project, "session");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSession(): Promise<ProjectFile | null> {
  const db = await openDb();
  const value = await new Promise<ProjectFile | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("session");
    req.onsuccess = () => resolve((req.result as ProjectFile | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!value || value.app !== "wobble" || value.version !== 1) return null;
  return value;
}

export async function clearSession() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("session");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
