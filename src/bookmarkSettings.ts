// 북마크 추가/이동 관련 설정. 관리 페이지와 서비스 워커(페이지 위 "북마크에 추가" 버튼,
// 컨텍스트 메뉴)가 chrome.storage.local로 공유한다.

/** 켜져 있으면 북마크를 추가하거나 다른 폴더로 옮길 때 그 폴더의 맨 앞에 놓는다. */
export const PLACE_AT_TOP_KEY = "placeBookmarksAtTop";

export async function getPlaceAtTop(): Promise<boolean> {
  return (await chrome.storage.local.get(PLACE_AT_TOP_KEY))[PLACE_AT_TOP_KEY] === true;
}

export async function setPlaceAtTop(atTop: boolean): Promise<void> {
  await chrome.storage.local.set({ [PLACE_AT_TOP_KEY]: atTop });
}

/**
 * 켜져 있으면 컨텍스트 메뉴 "북마크 캡쳐 이미지로 사용"으로 아직 북마크에 없는 페이지를
 * 추가할 때, 북마크 바 최상위에 바로 넣지 않고 페이지 위에 창을 띄워 저장할 폴더를 묻는다.
 */
export const ASK_FOLDER_ON_IMAGE_MENU_KEY = "askFolderOnImageMenu";

export async function getAskFolderOnImageMenu(): Promise<boolean> {
  return (
    (await chrome.storage.local.get(ASK_FOLDER_ON_IMAGE_MENU_KEY))[ASK_FOLDER_ON_IMAGE_MENU_KEY] ===
    true
  );
}

export async function setAskFolderOnImageMenu(ask: boolean): Promise<void> {
  await chrome.storage.local.set({ [ASK_FOLDER_ON_IMAGE_MENU_KEY]: ask });
}
