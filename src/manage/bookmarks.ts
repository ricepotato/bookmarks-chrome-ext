import type { FlatBookmark, FolderOption } from "./types";

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

export async function removeBookmark(id: string): Promise<void> {
  await chrome.bookmarks.remove(id);
}

export async function createBookmark(params: {
  parentId: string;
  title: string;
  url: string;
}): Promise<void> {
  await chrome.bookmarks.create(params);
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
