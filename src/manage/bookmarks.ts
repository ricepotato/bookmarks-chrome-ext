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
 * 북마크나 폴더를 parentId 폴더의 index 위치로 옮긴다. index를 생략하면 맨 끝에 넣는다.
 * 같은 폴더 안에서 뒤쪽으로 옮길 때도 index는 "옮기기 전" 목록 기준이다.
 * (Chrome이 자기 자신이 빠지는 만큼을 알아서 보정한다.)
 */
export async function moveBookmark(
  id: string,
  parentId: string,
  index?: number,
): Promise<void> {
  await chrome.bookmarks.move(id, index === undefined ? { parentId } : { parentId, index });
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

export async function createBookmark(params: {
  parentId: string;
  title: string;
  url: string;
}): Promise<void> {
  await chrome.bookmarks.create(params);
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
