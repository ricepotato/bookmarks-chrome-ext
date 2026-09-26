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

export async function getAllThumbnails(): Promise<Map<string, ThumbnailRecord>> {
  const db = await openDb();
  const store = db.transaction(STORE).objectStore(STORE);
  const [keys, values] = await Promise.all([
    promisify(store.getAllKeys()),
    promisify(store.getAll()),
  ]);
  return new Map(keys.map((k, i) => [String(k), values[i] as ThumbnailRecord]));
}
