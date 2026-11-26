export interface ItemMeta {
    id: string;
    text: string;
    name: string;
    createdAt: number;
    attempts: number;
    bestScore: number;
    bestStars: number;
    /** Sentences cut from one long recording share a group. */
    group?: string;
    order?: number;
}

interface AudioRecord {
    id: string;
    mime: string;
    data: ArrayBuffer;
}

const DB_NAME = 'pronunciation';
const ITEMS = 'items';
const AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(ITEMS, { keyPath: 'id' });
            req.result.createObjectStore(AUDIO, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

export async function listItems(): Promise<ItemMeta[]> {
    const db = await openDb();
    const items = await wrap(db.transaction(ITEMS).objectStore(ITEMS).getAll() as IDBRequest<ItemMeta[]>);
    return items.sort((a, b) => a.createdAt - b.createdAt || (a.order ?? 0) - (b.order ?? 0));
}

export async function addItem(
    text: string,
    name: string,
    mime: string,
    data: ArrayBuffer,
    extra: { group?: string; order?: number } = {},
): Promise<ItemMeta> {
    const db = await openDb();
    const item: ItemMeta = {
        id: crypto.randomUUID(),
        text,
        name,
        createdAt: Date.now(),
        attempts: 0,
        bestScore: 0,
        bestStars: 0,
        ...extra,
    };
    const tx = db.transaction([ITEMS, AUDIO], 'readwrite');
    tx.objectStore(ITEMS).put(item);
    tx.objectStore(AUDIO).put({ id: item.id, mime, data } satisfies AudioRecord);
    await done(tx);
    return item;
}

export async function getAudioBlob(id: string): Promise<Blob> {
    const db = await openDb();
    const rec = await wrap(db.transaction(AUDIO).objectStore(AUDIO).get(id) as IDBRequest<AudioRecord | undefined>);
    if (!rec) throw new Error('Audio not found');
    return new Blob([rec.data], { type: rec.mime });
}

export async function recordAttempt(id: string, score: number, stars: number): Promise<ItemMeta> {
    const db = await openDb();
    const tx = db.transaction(ITEMS, 'readwrite');
    const store = tx.objectStore(ITEMS);
    const item = await wrap(store.get(id) as IDBRequest<ItemMeta>);
    item.attempts += 1;
    item.bestScore = Math.max(item.bestScore, score);
    item.bestStars = Math.max(item.bestStars, stars);
    store.put(item);
    await done(tx);
    return item;
}

export async function deleteItem(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([ITEMS, AUDIO], 'readwrite');
    tx.objectStore(ITEMS).delete(id);
    tx.objectStore(AUDIO).delete(id);
    await done(tx);
}

export async function requestPersistence(): Promise<void> {
    await navigator.storage?.persist?.();
}
