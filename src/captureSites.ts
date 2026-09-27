// 화면 캡처 대상 사이트 목록. 이 목록에 있는 도메인(하위 도메인 포함)의 북마크만
// 썸네일을 캡처한다. 사이트마다 "현재 사이트 즐겨찾기에 추가하기" 버튼을 페이지에
// 띄울지와 그 위치도 정한다. 서비스 워커, 관리 페이지, content script가
// chrome.storage.local로 공유한다.

import { getHostname, isValidHostname, matchesDomain } from "./manage/bookmarks";

export const CAPTURE_SITES_KEY = "captureSites";

export type ButtonPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const BUTTON_POSITIONS: { value: ButtonPosition; label: string }[] = [
  { value: "top-left", label: "좌측 상단" },
  { value: "top-right", label: "우측 상단" },
  { value: "bottom-left", label: "좌측 하단" },
  { value: "bottom-right", label: "우측 하단" },
];

export interface CaptureSite {
  domain: string;
  /** 이 사이트 페이지에 "현재 사이트 즐겨찾기에 추가하기" 버튼을 띄울지 */
  showAddButton: boolean;
  /** 버튼을 띄울 화면 모서리 */
  buttonPosition: ButtonPosition;
}

export function newCaptureSite(domain: string): CaptureSite {
  return { domain, showAddButton: false, buttonPosition: "bottom-right" };
}

export async function getCaptureSites(): Promise<CaptureSite[]> {
  const stored = (await chrome.storage.local.get(CAPTURE_SITES_KEY))[CAPTURE_SITES_KEY];
  return parseCaptureSites(stored);
}

/** 저장된 값을 읽는다. 예전 형식(도메인 문자열 배열)도 받아들인다. */
export function parseCaptureSites(stored: unknown): CaptureSite[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((s) =>
    typeof s === "string" ? newCaptureSite(s) : { ...newCaptureSite(s.domain), ...s },
  );
}

export async function setCaptureSites(sites: CaptureSite[]): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_SITES_KEY]: sites });
}

/**
 * 사용자가 입력한 값을 목록에 넣을 도메인으로 바꾼다.
 * "https://www.example.com/path" 처럼 주소를 붙여넣어도 호스트네임만 뽑아낸다.
 * 도메인으로 쓸 수 없는 값이면 null.
 */
export function normalizeSiteInput(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const host = (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? getHostname(v) : v)
    ?.toLowerCase()
    .replace(/\.$/, "");
  return host && isValidHostname(host) ? host : null;
}

/** 주소의 호스트에 해당하는 목록 항목(도메인 또는 그 상위 도메인). 없으면 undefined */
export function findCaptureSite(
  url: string,
  sites: CaptureSite[],
): CaptureSite | undefined {
  const host = getHostname(url);
  if (!host) return undefined;
  // 여러 항목이 걸리면(예: example.com 과 www.example.com) 더 구체적인 쪽을 쓴다.
  return sites
    .filter((s) => matchesDomain(host, s.domain, true))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
}

/** 주소의 호스트가 목록의 도메인(또는 그 하위 도메인)에 해당하는지 */
export function isCaptureTarget(url: string, sites: CaptureSite[]): boolean {
  return findCaptureSite(url, sites) !== undefined;
}

// ---- content script ↔ 서비스 워커 메시지 ----
// content script에서는 chrome.bookmarks를 쓸 수 없으므로 서비스 워커에 요청한다.

export const GET_BOOKMARK_FOLDERS = "get-bookmark-folders";
export const ADD_CURRENT_PAGE_BOOKMARK = "add-current-page-bookmark";

export interface GetBookmarkFoldersMessage {
  type: typeof GET_BOOKMARK_FOLDERS;
}

export interface AddCurrentPageBookmarkMessage {
  type: typeof ADD_CURRENT_PAGE_BOOKMARK;
  parentId: string;
  title: string;
  url: string;
}

export interface AddCurrentPageBookmarkResult {
  /** 북마크와 함께 화면을 캡처해 썸네일로 저장했는지 */
  captured: boolean;
  /** 캡처에 실패한 경우 그 사유 (북마크 추가 자체는 성공) */
  captureError?: string;
}

/** 서비스 워커의 응답. 실패하면 error에 사유를 담는다. */
export type BookmarkMessageResponse<T> = { ok: true; data: T } | { ok: false; error: string };
