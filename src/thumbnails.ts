// 사이트 스크린샷(썸네일) 저장소. 서비스 워커와 관리 페이지가 같은 확장 origin의
// IndexedDB를 공유하므로 양쪽에서 이 모듈을 그대로 사용한다.
// 키는 normalizeUrlForDedup(url) 이라서 같은 주소의 북마크들은 썸네일을 공유한다.

const DB_NAME = "bookmarks-manager";
const DB_VERSION = 1;
const STORE = "thumbnails";

/** 서비스 워커 → 관리 페이지: 썸네일이 새로 저장되었음을 알리는 메시지 */
export const THUMBNAIL_UPDATED = "thumbnail-updated";

export interface ThumbnailUpdatedMessage {
  type: typeof THUMBNAIL_UPDATED;
  key: string;
}

/**
 * 관리 페이지 안에서 썸네일을 바꿨을 때 화면에 반영하도록 알린다.
 * (runtime 메시지는 보낸 페이지 자신에게는 전달되지 않으므로 window 이벤트를 쓴다.)
 */
export function notifyThumbnailsChanged(keys: string[]): void {
  for (const key of keys) {
    window.dispatchEvent(
      new CustomEvent<ThumbnailUpdatedMessage>(THUMBNAIL_UPDATED, {
        detail: { type: THUMBNAIL_UPDATED, key },
      }),
    );
  }
}

export interface ThumbnailRecord {
  blob: Blob;
  /** 캡처 시각 (epoch ms) */
  capturedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getThumbnail(
  key: string,
): Promise<ThumbnailRecord | undefined> {
  const db = await openDb();
  return promisify(db.transaction(STORE).objectStore(STORE).get(key));
}

export async function putThumbnail(
  key: string,
  record: ThumbnailRecord,
): Promise<void> {
  const db = await openDb();
  await promisify(
    db.transaction(STORE, "readwrite").objectStore(STORE).put(record, key),
  );
}

export async function deleteThumbnail(key: string): Promise<void> {
  const db = await openDb();
  await promisify(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
}

export async function getAllThumbnails(): Promise<Map<string, ThumbnailRecord>> {
  const db = await openDb();
  const store = db.transaction(STORE).objectStore(STORE);
  const [keys, values] = await Promise.all([
    promisify(store.getAllKeys()),
    promisify(store.getAll()),
  ]);
  return new Map(keys.map((k, i) => [String(k), values[i] as ThumbnailRecord]));
}

export interface ThumbnailMove {
  from: string;
  to: string;
}

/**
 * 북마크 주소가 바뀌었을 때 썸네일을 옛 키에서 새 키로 옮긴다.
 * - 새 키에 이미 썸네일이 있으면 더 최근에 찍은 쪽을 남긴다.
 * - keep에 있는 옛 키(아직 그 주소를 쓰는 북마크가 있음)는 지우지 않고 복사만 한다.
 * 실제로 새 키에 저장한 항목만 돌려준다.
 */
export async function moveThumbnails(
  moves: ThumbnailMove[],
  keep: Set<string>,
): Promise<ThumbnailMove[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const moved: ThumbnailMove[] = [];
  const seen = new Set<string>();
  for (const { from, to } of moves) {
    const id = `${from}\n${to}`;
    if (from === to || seen.has(id)) continue;
    seen.add(id);

    const source: ThumbnailRecord | undefined = await promisify(store.get(from));
    if (!source) continue;
    const target: ThumbnailRecord | undefined = await promisify(store.get(to));
    if (!keep.has(from)) store.delete(from);
    if (target && target.capturedAt >= source.capturedAt) continue;

    const record: ThumbnailRecord = { blob: source.blob, capturedAt: source.capturedAt };
    store.put(record, to);
    moved.push({ from, to });
  }

  await done;
  return moved;
}
