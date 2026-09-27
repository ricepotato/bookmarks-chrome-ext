// 화면 캡처 대상 사이트 목록. 이 목록에 있는 도메인(하위 도메인 포함)의 북마크만
// 썸네일을 캡처한다. 서비스 워커와 관리 페이지가 chrome.storage.local로 공유한다.

import { getHostname, isValidHostname, matchesDomain } from "./manage/bookmarks";

export const CAPTURE_SITES_KEY = "captureSites";

export async function getCaptureSites(): Promise<string[]> {
  const stored = (await chrome.storage.local.get(CAPTURE_SITES_KEY))[CAPTURE_SITES_KEY];
  return Array.isArray(stored) ? stored : [];
}

export async function setCaptureSites(sites: string[]): Promise<void> {
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

/** 주소의 호스트가 목록의 도메인(또는 그 하위 도메인)에 해당하는지 */
export function isCaptureTarget(url: string, sites: string[]): boolean {
  const host = getHostname(url);
  if (!host) return false;
  return sites.some((site) => matchesDomain(host, site, true));
}
