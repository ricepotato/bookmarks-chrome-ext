// 썸네일 파일 백업: 저장된 썸네일을 ZIP 파일 하나로 내보내고, 그 파일에서 다시 가져온다.
// 다른 PC/프로필로 옮길 때도 쓸 수 있다.
//
// ZIP 구성
//   manifest.json      { format, version, exportedAt, thumbnails: [{ key, file, capturedAt }] }
//   images/000001.jpg  썸네일 이미지 (키는 긴 URL이라 파일 이름 대신 manifest에 둔다)

import { unzipSync, zipSync, type Zippable } from "fflate";
import {
  getAllThumbnails,
  getThumbnail,
  putThumbnail,
  notifyThumbnailsChanged,
} from "./thumbnails";

const FORMAT = "bookmarks-manager-thumbnails";
const VERSION = 1;

interface BackupManifest {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  thumbnails: { key: string; file: string; capturedAt: number }[];
}

/** 저장된 모든 썸네일을 ZIP으로 묶는다. */
export async function exportThumbnailsZip(): Promise<{ blob: Blob; count: number }> {
  const all = await getAllThumbnails();
  const files: Zippable = {};
  const manifest: BackupManifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    thumbnails: [],
  };

  let n = 0;
  for (const [key, record] of all) {
    const file = `images/${String(++n).padStart(6, "0")}.jpg`;
    // JPEG는 이미 압축되어 있어 다시 압축해도 거의 줄지 않으므로 저장만 한다.
    files[file] = [new Uint8Array(await record.blob.arrayBuffer()), { level: 0 }];
    manifest.thumbnails.push({ key, file, capturedAt: record.capturedAt });
  }
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files);
  return { blob: new Blob([zipped], { type: "application/zip" }), count: n };
}

/** 내보낼 파일 이름. 예: bookmark-thumbnails-20260927-1530.zip */
export function exportFileName(date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`;
  return `bookmark-thumbnails-${stamp}.zip`;
}

export interface ImportResult {
  /** 없던 썸네일을 새로 추가한 수 */
  added: number;
  /** 파일 쪽이 더 최근이라 교체한 수 */
  replaced: number;
  /** 이미 같거나 더 최근 썸네일이 있어 건너뛴 수 */
  skipped: number;
}

/**
 * exportThumbnailsZip으로 만든 ZIP에서 썸네일을 가져온다.
 * 같은 주소의 썸네일이 이미 있으면 더 최근에 찍은 쪽을 남긴다.
 */
export async function importThumbnailsZip(file: File): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("ZIP 파일을 읽을 수 없습니다.");
  }

  const manifestBytes = entries["manifest.json"];
  let manifest: BackupManifest | undefined;
  try {
    manifest = manifestBytes && JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    // 아래에서 형식 오류로 처리한다.
  }
  if (manifest?.format !== FORMAT || !Array.isArray(manifest.thumbnails)) {
    throw new Error("이 확장에서 내보낸 썸네일 백업 파일이 아닙니다.");
  }
  if (manifest.version > VERSION) {
    throw new Error("더 새로운 버전에서 만든 백업 파일입니다. 확장을 업데이트해 주세요.");
  }

  const result: ImportResult = { added: 0, replaced: 0, skipped: 0 };
  const changed: string[] = [];
  for (const { key, file: path, capturedAt } of manifest.thumbnails) {
    const bytes = entries[path];
    if (typeof key !== "string" || !bytes || typeof capturedAt !== "number") {
      result.skipped++;
      continue;
    }
    const existing = await getThumbnail(key);
    if (existing && existing.capturedAt >= capturedAt) {
      result.skipped++;
      continue;
    }
    await putThumbnail(key, {
      // fflate가 돌려주는 배열은 일반 ArrayBuffer 기반이지만 타입이 넓게 잡혀 있어 좁혀 준다.
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
      capturedAt,
    });
    if (existing) result.replaced++;
    else result.added++;
    changed.push(key);
  }

  notifyThumbnailsChanged(changed);
  return result;
}
