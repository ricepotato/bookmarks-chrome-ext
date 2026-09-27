import {
  createBookmark,
  loadBookmarksBarFlat,
  loadFolderOptions,
  normalizeUrlForDedup,
} from "./manage/bookmarks";
import {
  THUMBNAIL_UPDATED,
  getThumbnail,
  putThumbnail,
  type ThumbnailUpdatedMessage,
} from "./thumbnails";
import { syncThumbnailToDrive } from "./drive";
import {
  ADD_CURRENT_PAGE_BOOKMARK,
  GET_BOOKMARK_FOLDERS,
  IS_PAGE_BOOKMARKED,
  RECAPTURE_CURRENT_PAGE,
  getCaptureAllSites,
  getCaptureSites,
  isCaptureTarget,
  type AddCurrentPageBookmarkMessage,
  type AddCurrentPageBookmarkResult,
  type BookmarkMessageResponse,
  type ContentMessage,
} from "./captureSites";

// 서비스 워커: 확장 아이콘 클릭 시 관리 페이지를 새 탭으로 연다.
// action.default_popup을 지정하지 않았기 때문에 onClicked가 정상적으로 동작한다.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ---- "현재 사이트 북마크에 추가하기" 버튼 ----
// content script는 chrome.bookmarks를 쓸 수 없으므로 폴더 목록 조회, 북마크 여부 확인,
// 북마크 추가, 화면 다시 캡처를 대신한다.
chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    sender,
    sendResponse: (response: BookmarkMessageResponse<unknown>) => void,
  ) => {
    let task: Promise<unknown>;
    if (message?.type === GET_BOOKMARK_FOLDERS) {
      task = loadFolderOptions();
    } else if (message?.type === ADD_CURRENT_PAGE_BOOKMARK) {
      task = addPageBookmark(message, sender.tab);
    } else if (message?.type === IS_PAGE_BOOKMARKED) {
      task = bookmarkKeyFor(message.url).then((key) => key !== null);
    } else if (message?.type === RECAPTURE_CURRENT_PAGE) {
      task = recapturePage(message.url, sender.tab);
    } else {
      return false;
    }
    task
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) =>
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    return true; // 비동기로 응답한다.
  },
);

/**
 * 버튼으로 요청한 페이지를 북마크에 추가하고, 지금 보이는 화면을 그 북마크의 썸네일로 저장한다.
 * content script는 요청을 보내기 전에 버튼/선택 창을 숨겨 두므로 캡처에 찍히지 않는다.
 * 캡처에 실패해도 북마크 추가는 성공으로 보고, 실패 사유만 함께 돌려준다.
 */
async function addPageBookmark(
  { parentId, title, url }: AddCurrentPageBookmarkMessage,
  tab: chrome.tabs.Tab | undefined,
): Promise<AddCurrentPageBookmarkResult> {
  await createBookmark({ parentId, title: title || url, url });
  try {
    if (!tab?.id) throw new Error("탭 정보를 알 수 없습니다.");
    const blob = await captureTab(tab.windowId);
    await saveThumbnail([normalizeUrlForDedup(url)], blob, url);
    return { captured: true };
  } catch (e) {
    console.warn("[thumbnail] 북마크 추가 중 캡처 실패:", e);
    return { captured: false, captureError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * "캡처" 버튼: 북마크된 페이지의 지금 화면을 찍어 기존 썸네일을 교체한다.
 * 같은 키로 저장하므로 로컬 썸네일은 덮어쓰고, Drive 백업도 같은 파일을 덮어쓴다.
 */
async function recapturePage(url: string, tab: chrome.tabs.Tab | undefined): Promise<void> {
  const key = await bookmarkKeyFor(url);
  if (!key) throw new Error("북마크에 추가된 페이지가 아닙니다.");
  if (!tab?.id) throw new Error("탭 정보를 알 수 없습니다.");
  const blob = await captureTab(tab.windowId);
  await saveThumbnail([key], blob, url);
}

// ---- 썸네일 자동 캡처 ----
// 북마크된 사이트의 로딩이 끝나면 화면을 캡처해 썸네일로 저장한다.
// 단, 관리 페이지의 "스크린샷 설정" 목록에 있는 도메인의 북마크만 찍는다.
// ("모든 사이트"를 켜면 모든 북마크를 찍는다.)
// captureVisibleTab은 창에 "보이는" 탭만 찍을 수 있으므로, 백그라운드에서 로드된 탭은
// 사용자가 그 탭으로 전환했을 때 찍는다.
//
// 사이트가 다른 주소로 리다이렉트하는 경우(서버 3xx, JS/meta 리다이렉트, history.replaceState)
// 최종 주소는 북마크와 다르므로, 탭별로 "처음 요청한 북마크 주소"를 기억해 두었다가
// 리다이렉트 끝에 로드된 화면을 그 북마크의 썸네일로 저장한다.

/** 로딩 완료 후 렌더링(웹폰트, 이미지 등)이 자리잡을 때까지 기다리는 시간 */
const CAPTURE_DELAY_MS = 1000;
/** 이 시간 안에 찍은 썸네일이 있으면 다시 찍지 않는다. */
const RECAPTURE_AFTER_MS = 60 * 60 * 1000;
/** 저장할 이미지의 최대 가로 크기 (마우스 오버 시 크게 보여주기 위해 넉넉히) */
const MAX_WIDTH = 1280;

/**
 * 탭에서 진행 중인 북마크 방문 정보.
 * 서비스 워커는 수시로 종료되므로 메모리가 아닌 storage.session에 둔다.
 */
interface TabVisit {
  /** 이 방문이 해당하는 북마크들의 썸네일 키 (리다이렉트 체인에 걸친 북마크 모두) */
  keys: string[];
  /** 메인 프레임 커밋마다 증가. 캡처 대기 중 페이지가 바뀌었는지 판별하는 데 쓴다. */
  seq: number;
}

const visitKey = (tabId: number) => `visit:${tabId}`;
const requestedKey = (tabId: number) => `requested:${tabId}`;

async function getVisit(tabId: number): Promise<TabVisit | undefined> {
  const k = visitKey(tabId);
  return (await chrome.storage.session.get(k))[k];
}

/** 북마크 바에 있는 북마크들의 썸네일 키 집합. 북마크가 바뀌면 다시 읽는다. */
let bookmarkKeysCache: Promise<Set<string>> | null = null;

function getBookmarkKeys(): Promise<Set<string>> {
  if (!bookmarkKeysCache) {
    bookmarkKeysCache = loadBookmarksBarFlat().then(
      (list) => new Set(list.map((b) => normalizeUrlForDedup(b.url))),
    );
    bookmarkKeysCache.catch(() => (bookmarkKeysCache = null));
  }
  return bookmarkKeysCache;
}

const invalidateBookmarkKeys = () => (bookmarkKeysCache = null);
chrome.bookmarks.onCreated.addListener(invalidateBookmarkKeys);
chrome.bookmarks.onRemoved.addListener(invalidateBookmarkKeys);
chrome.bookmarks.onChanged.addListener(invalidateBookmarkKeys);
chrome.bookmarks.onMoved.addListener(invalidateBookmarkKeys);

/** 주소가 북마크 바에 있는 북마크라면 썸네일 키를, 아니면 null을 돌려준다. */
async function bookmarkKeyFor(url: string | undefined): Promise<string | null> {
  if (!url || !/^https?:/.test(url)) return null;
  const key = normalizeUrlForDedup(url);
  return (await getBookmarkKeys()).has(key) ? key : null;
}

// 서버 리다이렉트는 커밋 시점에 최종 주소만 보이므로, 처음 요청한 주소를 따로 기록해 둔다.
chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  chrome.storage.session.set({ [requestedKey(tabId)]: url });
});

chrome.webNavigation.onCommitted.addListener(
  async ({ tabId, frameId, url, transitionQualifiers }) => {
    if (frameId !== 0) return;
    const rk = requestedKey(tabId);
    const requested: string | undefined = (await chrome.storage.session.get(rk))[rk];
    const prev = await getVisit(tabId);

    const keys = new Set<string>();
    // 서버/클라이언트 리다이렉트로 이어진 이동이면 앞선 북마크 방문을 이어받는다.
    // 사용자가 직접 다른 곳으로 이동한 경우에는 새 방문으로 본다.
    const isRedirect =
      transitionQualifiers.includes("server_redirect") ||
      transitionQualifiers.includes("client_redirect");
    if (isRedirect && prev) prev.keys.forEach((k) => keys.add(k));
    for (const u of [requested, url]) {
      const k = await bookmarkKeyFor(u);
      if (k) keys.add(k);
    }

    const visit: TabVisit = { keys: [...keys], seq: (prev?.seq ?? 0) + 1 };
    await chrome.storage.session.set({ [visitKey(tabId)]: visit });
    await chrome.storage.session.remove(rk);
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([visitKey(tabId), requestedKey(tabId)]);
});

async function resize(dataUrl: string): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}

async function captureIfBookmarked(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.status !== "complete") return;

  const visit = await getVisit(tabId);
  if (!visit || visit.keys.length === 0) {
    console.debug("[thumbnail] 북마크에서 시작한 방문이 아니라 건너뜀:", tab.url);
    return;
  }

  // 캡처 대상 사이트 목록에 있는 북마크만 찍는다("모든 사이트"가 켜져 있으면 모두).
  // 설정은 관리 페이지에서 언제든 바뀔 수 있으므로 방문 기록 시점이 아니라 캡처 직전에 확인한다.
  const [sites, allSites] = await Promise.all([getCaptureSites(), getCaptureAllSites()]);
  const keys = visit.keys.filter((k) => isCaptureTarget(k, sites, allSites));
  if (keys.length === 0) {
    console.debug("[thumbnail] 캡처 대상 사이트가 아니라 건너뜀:", visit.keys);
    return;
  }

  const records = await Promise.all(keys.map((k) => getThumbnail(k)));
  const fresh = records.every(
    (r) => r && Date.now() - r.capturedAt < RECAPTURE_AFTER_MS,
  );
  if (fresh) return;

  await new Promise((r) => setTimeout(r, CAPTURE_DELAY_MS));

  // 기다리는 동안 다른 탭으로 전환했거나, 다른 페이지로 이동(또는 JS 리다이렉트)했으면
  // 지금 찍지 않는다. 리다이렉트라면 그 페이지의 로딩이 끝났을 때 다시 시도된다.
  const current = await chrome.tabs.get(tabId);
  const latest = await getVisit(tabId);
  if (!current.active || latest?.seq !== visit.seq) return;

  const blob = await captureTab(current.windowId);
  await saveThumbnail(keys, blob, current.url);

  // 한 번 찍은 뒤에는 같은 탭에서 사이트 안을 돌아다닌 화면이 북마크 썸네일을
  // 덮어쓰지 않도록 방문 정보를 비운다.
  await chrome.storage.session.set({
    [visitKey(tabId)]: { keys: [], seq: visit.seq } satisfies TabVisit,
  });
}

/** 창에 보이는 탭 화면을 찍어 썸네일 크기로 줄인다. */
async function captureTab(windowId: number): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 90,
  });
  return resize(dataUrl);
}

/** 찍은 화면을 북마크 키들의 썸네일로 저장하고, 관리 페이지 알림과 Drive 백업까지 처리한다. */
async function saveThumbnail(
  keys: string[],
  blob: Blob,
  sourceUrl: string | undefined,
): Promise<void> {
  const capturedAt = Date.now();
  for (const key of keys) {
    const record = { blob, capturedAt };
    await putThumbnail(key, record);
    console.log("[thumbnail] 저장 완료:", key, "←", sourceUrl);
    const message: ThumbnailUpdatedMessage = { type: THUMBNAIL_UPDATED, key };
    // 관리 페이지가 열려 있지 않으면 받는 쪽이 없어 실패하므로 무시한다.
    chrome.runtime.sendMessage(message).catch(() => {});

    // Drive 백업이 켜져 있으면 업로드한다. 실패해도 로컬 썸네일은 유지되고,
    // 관리 페이지의 "전체 업로드"로 나중에 다시 올릴 수 있다.
    syncThumbnailToDrive(key, record)
      .then((ok) => ok && console.log("[drive] 업로드 완료:", key))
      .catch((e) => console.warn("[drive] 업로드 실패:", key, e));
  }
}

/**
 * 탭별 캡처 진행 상태. 진행 중에 또 요청이 오면(예: 대기 중 JS 리다이렉트로 새 페이지가
 * 로드 완료) 겹쳐 실행하지 않고, 끝난 뒤 한 번 더 실행한다.
 */
const inFlight = new Map<number, { rerun: boolean }>();

function tryCapture(tabId: number) {
  const running = inFlight.get(tabId);
  if (running) {
    running.rerun = true;
    return;
  }
  const state = { rerun: false };
  inFlight.set(tabId, state);
  captureIfBookmarked(tabId)
    .catch((e) => {
      // 탭이 닫혔거나, 창이 최소화되었거나, 캡처가 금지된 페이지 등. 기록만 남기고 넘어간다.
      console.warn("[thumbnail] 캡처 실패:", e);
    })
    .finally(() => {
      inFlight.delete(tabId);
      if (state.rerun) tryCapture(tabId);
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") tryCapture(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  tryCapture(tabId);
});
