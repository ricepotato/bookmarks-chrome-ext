// Google Drive 썸네일 백업. 서비스 워커(캡처 직후 업로드)와 관리 페이지(로그인, 설정,
// 전체 업로드)에서 함께 사용한다.
//
// 로그인은 chrome.identity.getAuthToken으로 한다 (Firebase 등 별도 인증 서비스 불필요).
// 권한 범위는 drive.file: 이 확장이 만든 폴더/파일에만 접근할 수 있고,
// 사용자의 다른 Drive 파일은 보거나 수정할 수 없다.

import {
  getAllThumbnails,
  getThumbnail,
  putThumbnail,
  type ThumbnailRecord,
} from "./thumbnails";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Drive 파일의 appProperties에 썸네일 키의 해시를 넣어 같은 썸네일 파일을 다시 찾는다. */
const PROP_KEY = "thumbKey";

export const DEFAULT_FOLDER_NAME = "Bookmark Thumbnails";

export interface DriveSettings {
  /** 캡처할 때마다 Drive에 업로드할지 여부 (로그인 시 켜짐) */
  enabled: boolean;
  /** 이미지를 저장할 Drive 폴더 이름 */
  folderName: string;
  /** folderName으로 찾거나 만든 폴더의 id (이름이 바뀌면 다시 찾는다) */
  folderId?: string;
}

const SETTINGS_KEY = "driveSettings";

export async function getDriveSettings(): Promise<DriveSettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return { enabled: false, folderName: DEFAULT_FOLDER_NAME, ...stored };
}

export async function setDriveSettings(
  changes: Partial<DriveSettings>,
): Promise<DriveSettings> {
  const next = { ...(await getDriveSettings()), ...changes };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** manifest에 OAuth 클라이언트 ID가 설정되어 빌드되었는지 */
export function isDriveConfigured(): boolean {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id;
  return !!clientId;
}

async function getToken(interactive: boolean): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive });
  if (!result.token) throw new Error("Google 로그인 토큰을 받지 못했습니다.");
  return result.token;
}

/** 로그인 창을 띄워 권한을 받고 Drive 백업을 켠다. */
export async function signIn(): Promise<void> {
  await getToken(true);
  await setDriveSettings({ enabled: true });
}

/** 백업을 끄고, 캐시된 토큰을 폐기(revoke)해 확장의 Drive 접근 권한을 해제한다. */
export async function signOut(): Promise<void> {
  await setDriveSettings({ enabled: false, folderId: undefined });
  try {
    const token = await getToken(false);
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token }),
    });
  } catch {
    // 이미 로그아웃된 상태면 할 일이 없다.
  }
  await chrome.identity.clearAllCachedAuthTokens();
}

/** 토큰을 붙여 Drive API를 호출한다. 토큰이 만료되었으면(401) 한 번 새로 받아 재시도한다. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken(false);
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) {
      await chrome.identity.removeCachedAuthToken({ token });
      continue;
    }
    if (!res.ok) {
      throw new Error(`Drive API 오류 ${res.status}: ${await res.text()}`);
    }
    return res;
  }
}

/** Drive 검색 쿼리 문자열 안에 넣을 값을 이스케이프한다. */
const q = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export async function getAccountEmail(): Promise<string | null> {
  try {
    const res = await driveFetch(`${API}/about?fields=user(emailAddress)`);
    return (await res.json()).user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** 설정된 이름의 폴더를 찾고, 없으면 내 드라이브 최상위에 만든다. */
async function ensureFolder(settings: DriveSettings): Promise<string> {
  if (settings.folderId) {
    try {
      const res = await driveFetch(
        `${API}/files/${settings.folderId}?fields=id,name,trashed`,
      );
      const folder = await res.json();
      if (!folder.trashed && folder.name === settings.folderName) return folder.id;
    } catch {
      // 폴더가 삭제되었으면 아래에서 다시 찾거나 만든다.
    }
  }

  // drive.file 권한이라 이 확장이 만든 폴더만 검색된다.
  const query = [
    `mimeType = ${q(FOLDER_MIME)}`,
    `name = ${q(settings.folderName)}`,
    "trashed = false",
  ].join(" and ");
  const found = await driveFetch(
    `${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
  ).then((r) => r.json());

  let folderId: string = found.files?.[0]?.id;
  if (!folderId) {
    const created = await driveFetch(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: settings.folderName, mimeType: FOLDER_MIME }),
    }).then((r) => r.json());
    folderId = created.id;
  }
  await setDriveSettings({ folderId });
  return folderId;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 파일 이름. 쿼리스트링의 토큰 등 민감할 수 있는 정보가 드러나지 않도록 전체 URL 대신
 * 호스트명 + 해시 일부만 쓴다.
 */
function fileNameFor(key: string, hash: string): string {
  let host = "site";
  try {
    host = new URL(key).hostname;
  } catch {
    // 호스트를 알 수 없으면 기본값 사용
  }
  return `${host}_${hash.slice(0, 12)}.jpg`;
}

/** 썸네일 하나를 설정된 폴더에 올린다. 같은 키의 파일이 있으면 내용을 덮어쓴다. */
async function uploadThumbnail(
  key: string,
  blob: Blob,
  settings: DriveSettings,
): Promise<void> {
  const folderId = await ensureFolder(settings);
  const hash = await sha256Hex(key);

  const query = [
    `${q(folderId)} in parents`,
    `appProperties has { key=${q(PROP_KEY)} and value=${q(hash)} }`,
    "trashed = false",
  ].join(" and ");
  const found = await driveFetch(
    `${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
  ).then((r) => r.json());
  const existingId: string | undefined = found.files?.[0]?.id;

  if (existingId) {
    await driveFetch(`${UPLOAD_API}/files/${existingId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    return;
  }

  const metadata = {
    name: fileNameFor(key, hash),
    mimeType: "image/jpeg",
    parents: [folderId],
    appProperties: { [PROP_KEY]: hash },
  };
  const body = new FormData();
  body.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  body.append("file", blob);
  await driveFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    body,
  });
}

/**
 * Drive 백업이 켜져 있으면 썸네일을 업로드하고, 성공하면 로컬 기록에 업로드 시각을 남긴다.
 * 꺼져 있으면 아무것도 하지 않는다.
 */
export async function syncThumbnailToDrive(
  key: string,
  record: ThumbnailRecord,
): Promise<boolean> {
  const settings = await getDriveSettings();
  if (!settings.enabled || !isDriveConfigured()) return false;
  await uploadThumbnail(key, record.blob, settings);
  // 업로드하는 동안 새로 캡처되었으면 새 이미지를 덮어쓰지 않도록 같은 캡처일 때만 기록한다.
  const latest = await getThumbnail(key);
  if (latest?.capturedAt === record.capturedAt) {
    await putThumbnail(key, { ...latest, driveSyncedAt: Date.now() });
  }
  return true;
}

/** 아직 올라가지 않았거나 이후 다시 찍힌 썸네일을 모두 업로드한다. */
export async function syncAllThumbnailsToDrive(
  onProgress?: (done: number, total: number) => void,
): Promise<{ uploaded: number; failed: number }> {
  const all = await getAllThumbnails();
  const pending = [...all].filter(
    ([, r]) => !r.driveSyncedAt || r.driveSyncedAt < r.capturedAt,
  );
  let uploaded = 0;
  let failed = 0;
  onProgress?.(0, pending.length);
  for (const [key, record] of pending) {
    try {
      await syncThumbnailToDrive(key, record);
      uploaded++;
    } catch (e) {
      console.warn("[drive] 업로드 실패:", key, e);
      failed++;
    }
    onProgress?.(uploaded + failed, pending.length);
  }
  return { uploaded, failed };
}
