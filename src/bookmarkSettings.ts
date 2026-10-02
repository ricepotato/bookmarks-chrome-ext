// 북마크 추가/이동 관련 설정. 관리 페이지와 서비스 워커(페이지 위 "북마크에 추가" 버튼)가
// chrome.storage.local로 공유한다.

/** 켜져 있으면 북마크를 추가하거나 다른 폴더로 옮길 때 그 폴더의 맨 앞에 놓는다. */
export const PLACE_AT_TOP_KEY = "placeBookmarksAtTop";

export async function getPlaceAtTop(): Promise<boolean> {
  return (await chrome.storage.local.get(PLACE_AT_TOP_KEY))[PLACE_AT_TOP_KEY] === true;
}

export async function setPlaceAtTop(atTop: boolean): Promise<void> {
  await chrome.storage.local.set({ [PLACE_AT_TOP_KEY]: atTop });
}
