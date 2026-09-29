// 스크린샷 캡처에 필요한 호스트 권한을 그때그때 요청/반납한다.
// manifest에는 optional_host_permissions로 "<all_urls>"만 선언해 두고, 실제로는
// 사용자가 스크린샷 설정에서 사이트를 추가하거나 "모든 사이트"를 켤 때만 그 범위만큼만
// chrome.permissions로 요청한다 (요청은 사용자 조작이 있는 확장 페이지에서만 가능하다).

export const ALL_URLS = "<all_urls>";

/** 도메인과 그 하위 도메인을 모두 포함하는 매치 패턴 두 개 */
export function originPatternsForDomain(domain: string): string[] {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

export async function hasDomainAccess(domain: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: originPatternsForDomain(domain) });
}

/** 사용자 조작(클릭 등) 처리 중에만 호출할 수 있다. */
export async function requestDomainAccess(domain: string): Promise<boolean> {
  return chrome.permissions.request({ origins: originPatternsForDomain(domain) });
}

export async function removeDomainAccess(domain: string): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: originPatternsForDomain(domain) });
  } catch {
    // 다른 곳(예: "모든 사이트")이 이미 이 출처를 포함하고 있으면 실패할 수 있다. 무시한다.
  }
}

export async function hasAllUrlsAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [ALL_URLS] });
}

/** 사용자 조작(클릭 등) 처리 중에만 호출할 수 있다. */
export async function requestAllUrlsAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: [ALL_URLS] });
}

export async function removeAllUrlsAccess(): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [ALL_URLS] });
  } catch {
    // 이미 없으면 무시한다.
  }
}
