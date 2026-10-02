import { getPlaceAtTop } from "../bookmarkSettings";
import type { BookmarkFolder, FlatBookmark, FolderOption } from "./types";

// Chrome 북마크 트리에서 "북마크 바" 노드의 id는 로케일에 관계없이 항상 "1" 이다.
export const BOOKMARKS_BAR_ID = "1";

/**
 * 북마크 바 하위 트리를 읽어 실제 북마크(URL이 있는 리프 노드)만 평탄화한다.
 * 스코프: 북마크 바와 그 하위 폴더 전체 (다른 북마크/모바일 북마크는 제외).
 */
export async function loadBookmarksBarFlat(): Promise<FlatBookmark[]> {
  const [barRoot] = await chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID);
  const result: FlatBookmark[] = [];

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    if (!node.children) {
      // 리프 노드: url이 있으면 북마크, 없으면 빈 폴더(무시)
      if (node.url) {
        result.push({
          id: node.id,
          parentId: node.parentId ?? BOOKMARKS_BAR_ID,
          title: node.title,
          url: node.url,
          dateAdded: node.dateAdded,
          index: node.index ?? 0,
          path,
        });
      }
      return;
    }
    for (const child of node.children) {
      if (child.url) {
        result.push({
          id: child.id,
          parentId: child.parentId ?? node.id,
          title: child.title,
          url: child.url,
          dateAdded: child.dateAdded,
          index: child.index ?? 0,
          path,
        });
      } else {
        walk(child, [...path, child.title]);
      }
    }
  };

  walk(barRoot, []);
  return result;
}

/** 북마크 바 하위의 모든 폴더(북마크 바 자신은 제외)를 트리 순서대로 수집한다. */
export async function loadBookmarkFolders(): Promise<BookmarkFolder[]> {
  const [barRoot] = await chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID);
  const result: BookmarkFolder[] = [];

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    if (!node.children) return;
    for (const child of node.children) {
      if (!child.url) {
        const childPath = [...path, child.title];
        result.push({
          id: child.id,
          parentId: child.parentId ?? node.id,
          title: child.title,
          index: child.index ?? 0,
          path: childPath,
        });
        walk(child, childPath);
      }
    }
  };

  walk(barRoot, []);
  return result;
}

/** 북마크 바 하위의 폴더 목록을 "추가할 위치" 선택용으로 수집한다. */
export async function loadFolderOptions(): Promise<FolderOption[]> {
  const [barRoot] = await chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID);
  const options: FolderOption[] = [
    { id: BOOKMARKS_BAR_ID, label: "북마크 바 (최상위)" },
  ];

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, label: string) => {
    if (!node.children) return;
    for (const child of node.children) {
      if (!child.url) {
        const childLabel = `${label} > ${child.title}`;
        options.push({ id: child.id, label: childLabel });
        walk(child, childLabel);
      }
    }
  };

  walk(barRoot, "북마크 바");
  return options;
}

export async function updateBookmark(
  id: string,
  changes: { title?: string; url?: string },
): Promise<void> {
  await chrome.bookmarks.update(id, changes);
}

/**
 * 북마크나 폴더를 parentId 폴더의 index 위치로 옮긴다. index를 생략하면 "맨 위에 배치"
 * 설정에 따라 맨 앞 또는 맨 끝에 넣는다.
 * 같은 폴더 안에서 뒤쪽으로 옮길 때도 index는 "옮기기 전" 목록 기준이다.
 * (Chrome이 자기 자신이 빠지는 만큼을 알아서 보정한다.)
 */
export async function moveBookmark(
  id: string,
  parentId: string,
  index?: number,
): Promise<void> {
  if (index === undefined && (await getPlaceAtTop())) index = 0;
  await chrome.bookmarks.move(id, index === undefined ? { parentId } : { parentId, index });
}

/**
 * 여러 북마크/폴더를 parentId 폴더로 한꺼번에 옮긴다. 옮기는 항목끼리의 순서는 원래 순서를
 * 그대로 유지한다.
 * - index가 있으면 parentId 폴더의 "옮기기 전" 목록 기준 index 자리에 이어 붙여 넣는다.
 * - index를 생략하면 "맨 위에 배치" 설정에 따라 맨 앞 또는 맨 끝에 넣는다.
 */
export async function moveBookmarks(
  ids: string[],
  parentId: string,
  index?: number,
): Promise<void> {
  const nodes = await chrome.bookmarks.get(ids);
  // 원래 순서대로 옮긴다. (드래그로 옮기는 항목은 모두 같은 폴더에 있으므로 index 순서가 곧 화면 순서다)
  const moving = [...nodes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  if (index === undefined) {
    if (await getPlaceAtTop()) {
      for (const [i, node] of moving.entries()) {
        await chrome.bookmarks.move(node.id, { parentId, index: i });
      }
    } else {
      for (const node of moving) await chrome.bookmarks.move(node.id, { parentId });
    }
    return;
  }

  const movingIds = new Set(moving.map((n) => n.id));
  const children = await chrome.bookmarks.getChildren(parentId);
  // 남는 항목들 사이에서 끼워 넣을 자리: 원래 index 자리보다 앞에 있던 남는 항목의 수
  const remaining = children.filter((c) => !movingIds.has(c.id));
  const insertAt = remaining.filter((c) => (c.index ?? 0) < index).length;
  const finalOrder = [
    ...remaining.slice(0, insertAt).map((c) => c.id),
    ...moving.map((n) => n.id),
    ...remaining.slice(insertAt).map((c) => c.id),
  ];

  // 다른 폴더에 있던 항목은 먼저 이 폴더로 가져온 뒤 순서를 맞춘다.
  const childIds = new Set(children.map((c) => c.id));
  const current = children.map((c) => c.id);
  for (const node of moving) {
    if (!childIds.has(node.id)) {
      await chrome.bookmarks.move(node.id, { parentId });
      current.push(node.id);
    }
  }

  // 앞에서부터 자리가 다른 항목을 그 자리로 당겨 온다. 당겨 오는 항목은 항상 뒤쪽에
  // 있으므로 Chrome의 index 보정(뒤로 옮길 때 -1)이 끼어들지 않는다.
  for (let i = 0; i < finalOrder.length; i++) {
    if (current[i] === finalOrder[i]) continue;
    const from = current.indexOf(finalOrder[i]);
    await chrome.bookmarks.move(finalOrder[i], { parentId, index: i });
    current.splice(from, 1);
    current.splice(i, 0, finalOrder[i]);
  }
}

export async function removeBookmark(id: string): Promise<void> {
  await chrome.bookmarks.remove(id);
}

export async function renameFolder(id: string, title: string): Promise<void> {
  await chrome.bookmarks.update(id, { title });
}

/** 폴더와 그 안의 북마크/하위 폴더를 모두 삭제한다. */
export async function removeFolder(id: string): Promise<void> {
  await chrome.bookmarks.removeTree(id);
}

/** parentId 폴더에 북마크를 만든다. "맨 위에 배치" 설정이 켜져 있으면 맨 앞, 아니면 맨 끝. */
export async function createBookmark(params: {
  parentId: string;
  title: string;
  url: string;
}): Promise<void> {
  await chrome.bookmarks.create((await getPlaceAtTop()) ? { ...params, index: 0 } : params);
}

/** parentId 폴더의 맨 앞에 새 폴더를 만든다. */
export async function createFolder(params: {
  parentId: string;
  title: string;
}): Promise<void> {
  // url 없이 만들면 폴더가 된다.
  await chrome.bookmarks.create({ ...params, index: 0 });
}

/**
 * 중복 판정용 URL 키. 스킴/호스트 대소문자 차이와 끝의 "/" 유무는 같은 주소로 본다.
 * (예: "HTTPS://Example.com/" 와 "https://example.com" 은 같은 키)
 */
export function normalizeUrlForDedup(url: string): string {
  let key: string;
  try {
    key = new URL(url).href;
  } catch {
    key = url.trim();
  }
  return key.endsWith("/") ? key.slice(0, -1) : key;
}

/**
 * 같은 주소를 가진 북마크들을 그룹으로 묶는다 (2개 이상인 그룹만 반환).
 * 각 그룹은 추가된 시각이 오래된 순으로 정렬된다.
 */
export function findDuplicateGroups(bookmarks: FlatBookmark[]): FlatBookmark[][] {
  const groups = new Map<string, FlatBookmark[]>();
  for (const b of bookmarks) {
    const key = normalizeUrlForDedup(b.url);
    const group = groups.get(key);
    if (group) group.push(b);
    else groups.set(key, [b]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) =>
      [...g].sort(
        (a, b) => (a.dateAdded ?? Infinity) - (b.dateAdded ?? Infinity),
      ),
    );
}

/** URL에서 호스트네임을 추출한다. 파싱 실패 시 null. */
export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 대상 호스트네임이 찾는 도메인과 일치하는지 검사한다. */
export function matchesDomain(
  hostname: string,
  findDomain: string,
  includeSubdomains: boolean,
): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const f = findDomain.toLowerCase().replace(/\.$/, "");
  if (!f) return false;
  if (h === f) return true;
  if (includeSubdomains && h.endsWith(`.${f}`)) return true;
  return false;
}

const HOSTNAME_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;

/** 도메인으로 쓸 수 있는 형식인지 검사한다 (스킴/경로/포트/공백 등을 걸러냄). */
export function isValidHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

/** URL의 호스트네임 부분만 교체하고 나머지(경로/쿼리/포트 등)는 유지한다. */
export function replaceHostname(url: string, newHostname: string): string {
  if (!isValidHostname(newHostname)) {
    throw new Error(`올바르지 않은 도메인 형식입니다: "${newHostname}"`);
  }
  const u = new URL(url);
  u.hostname = newHostname;
  // WHATWG URL의 hostname setter는 유효하지 않은 값을 조용히 무시할 수 있으므로
  // 실제로 반영되었는지 확인한다 (IDNA 변환을 고려해 소문자로 비교).
  if (u.hostname.toLowerCase() !== newHostname.toLowerCase()) {
    throw new Error(`도메인을 "${newHostname}"(으)로 변경하지 못했습니다.`);
  }
  return u.toString();
}
