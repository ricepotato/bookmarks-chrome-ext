// 화면 캡처 대상 사이트 목록. 이 목록에 있는 도메인(하위 도메인 포함)의 북마크만
// 썸네일을 캡처한다. 사이트마다 "현재 사이트 북마크에 추가하기" 버튼을 페이지에
// 띄울지와 그 위치도 정한다. 서비스 워커, 관리 페이지, content script가
// chrome.storage.local로 공유한다.

import { getHostname, isValidHostname, matchesDomain } from "./manage/bookmarks";

export const CAPTURE_SITES_KEY = "captureSites";
/**
 * "모든 사이트" 체크 여부. 목록과 따로 저장하므로 켜고 꺼도 목록의 사이트별 설정은
 * 그대로 남는다.
 */
export const CAPTURE_ALL_SITES_KEY = "captureAllSites";

export type ButtonPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const BUTTON_POSITIONS: { value: ButtonPosition; label: string }[] = [
  { value: "top-left", label: "좌측 상단" },
  { value: "top-right", label: "우측 상단" },
  { value: "bottom-left", label: "좌측 하단" },
  { value: "bottom-right", label: "우측 하단" },
];

export interface CaptureSite {
  domain: string;
  /** 이 사이트 페이지에 "현재 사이트 북마크에 추가하기" 버튼을 띄울지 */
  showAddButton: boolean;
  /** 버튼을 띄울 화면 모서리 */
  buttonPosition: ButtonPosition;
}

/** "모든 사이트"가 켜져 있을 때 목록에 없는 사이트에 버튼을 띄우는 위치 */
export const ALL_SITES_BUTTON_POSITION: ButtonPosition = "bottom-left";

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

export async function getCaptureAllSites(): Promise<boolean> {
  return (await chrome.storage.local.get(CAPTURE_ALL_SITES_KEY))[CAPTURE_ALL_SITES_KEY] === true;
}

export async function setCaptureAllSites(all: boolean): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_ALL_SITES_KEY]: all });
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

/**
 * 주소를 캡처할지. "모든 사이트"가 켜져 있으면 모두, 아니면 목록의 도메인
 * (또는 그 하위 도메인)만 캡처한다.
 */
export function isCaptureTarget(
  url: string,
  sites: CaptureSite[],
  allSites: boolean,
): boolean {
  return allSites || findCaptureSite(url, sites) !== undefined;
}

/**
 * 이 주소의 페이지에 북마크 버튼을 띄울 위치. 띄우지 않으면 null.
 * 목록에 있는 사이트는 "모든 사이트" 여부와 관계없이 그 사이트의 설정을 따르고,
 * 목록에 없는 사이트는 "모든 사이트"가 켜져 있을 때만 기본 위치에 띄운다.
 */
export function buttonPositionFor(
  url: string,
  sites: CaptureSite[],
  allSites: boolean,
): ButtonPosition | null {
  const site = findCaptureSite(url, sites);
  if (site) return site.showAddButton ? site.buttonPosition : null;
  return allSites ? ALL_SITES_BUTTON_POSITION : null;
}

// ---- content script ↔ 서비스 워커 메시지 ----
// content script에서는 chrome.bookmarks를 쓸 수 없으므로 서비스 워커에 요청한다.

export const GET_BOOKMARK_FOLDERS = "get-bookmark-folders";
export const ADD_CURRENT_PAGE_BOOKMARK = "add-current-page-bookmark";
export const IS_PAGE_BOOKMARKED = "is-page-bookmarked";
export const RECAPTURE_CURRENT_PAGE = "recapture-current-page";

export interface GetBookmarkFoldersMessage {
  type: typeof GET_BOOKMARK_FOLDERS;
}

export interface AddCurrentPageBookmarkMessage {
  type: typeof ADD_CURRENT_PAGE_BOOKMARK;
  parentId: string;
  title: string;
  url: string;
}

/** 주소가 북마크 바(하위 폴더 포함)에 북마크되어 있는지 묻는다. 응답은 boolean */
export interface IsPageBookmarkedMessage {
  type: typeof IS_PAGE_BOOKMARKED;
  url: string;
}

/** 북마크된 페이지의 지금 화면을 다시 찍어 기존 썸네일을 교체한다. */
export interface RecaptureCurrentPageMessage {
  type: typeof RECAPTURE_CURRENT_PAGE;
  url: string;
}

export type ContentMessage =
  | GetBookmarkFoldersMessage
  | AddCurrentPageBookmarkMessage
  | IsPageBookmarkedMessage
  | RecaptureCurrentPageMessage;

export interface AddCurrentPageBookmarkResult {
  /** 북마크와 함께 화면을 캡처해 썸네일로 저장했는지 */
  captured: boolean;
  /** 캡처에 실패한 경우 그 사유 (북마크 추가 자체는 성공) */
  captureError?: string;
}

/** 서비스 워커의 응답. 실패하면 error에 사유를 담는다. */
export type BookmarkMessageResponse<T> = { ok: true; data: T } | { ok: false; error: string };
