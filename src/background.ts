import {
  BOOKMARKS_BAR_ID,
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

// ---- "북마크에 추가" 버튼 콘텐츠 스크립트: 허용된 출처에만 동적으로 등록 ----
// manifest에는 host_permissions을 고정으로 넣지 않고(optional_host_permissions만 선언),
// 사용자가 스크린샷 설정에서 실제로 허용한 출처(사이트별 권한 또는 "모든 사이트")에만
// chrome.scripting으로 이 스크립트를 등록한다. 권한이 하나도 없으면 아무 페이지에도
// 실행되지 않는다.
const CONTENT_SCRIPT_ID = "bookmarkshot-content";

async function syncNow(): Promise<void> {
  const { origins = [] } = await chrome.permissions.getAll();
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    // 아직 등록된 적이 없으면 실패하는데, 무시해도 된다.
  }
  if (origins.length === 0) return;
  await chrome.scripting.registerContentScripts([
    { id: CONTENT_SCRIPT_ID, js: ["content.js"], matches: origins },
  ]);
}

// 여러 이벤트가 겹쳐 들어와도(설치+시작 등) unregister/register가 서로 끼어들지 않도록
// 한 번에 하나씩만 실행되게 줄 세운다.
let syncChain: Promise<void> = Promise.resolve();
function queueSync(): void {
  syncChain = syncChain
    .catch(() => {})
    .then(syncNow)
    .catch((e) => console.error("[content-script] 등록 동기화 실패:", e));
}

chrome.permissions.onAdded.addListener(queueSync);
chrome.permissions.onRemoved.addListener(queueSync);
chrome.runtime.onInstalled.addListener(queueSync);
chrome.runtime.onStartup.addListener(queueSync);
// 서비스 워커가 다른 이유로 깨어났을 때도 등록 상태가 실제 권한과 어긋나지 않도록 맞춰 둔다.
queueSync();

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
  return resizeBlob(await (await fetch(dataUrl)).blob());
}

/** 이미지를 썸네일 크기(가로 최대 MAX_WIDTH)의 JPEG로 줄인다. */
async function resizeBlob(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
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
  const targets = visit.keys.filter((k) => isCaptureTarget(k, sites, allSites));
  if (targets.length === 0) {
    console.debug("[thumbnail] 캡처 대상 사이트가 아니라 건너뜀:", visit.keys);
    return;
  }

  // 이미 스크린샷이 있는 북마크는 자동으로 다시 찍지 않는다. (다시 찍으려면 페이지 위의
  // "캡처" 버튼을 쓴다) 리다이렉트 체인에 걸린 북마크 중 스크린샷이 없는 것만 찍는다.
  const records = await Promise.all(targets.map((k) => getThumbnail(k)));
  const keys = targets.filter((_, i) => !records[i]);
  if (keys.length === 0) {
    console.debug("[thumbnail] 이미 스크린샷이 있어 건너뜀:", targets);
    return;
  }

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

// ---- 컨텍스트 메뉴: "북마크 캡쳐 이미지로 사용" ----
// 페이지의 이미지를 우클릭해 그 이미지를 현재 페이지 북마크의 썸네일로 쓴다. 페이지가 아직
// 북마크에 없으면 북마크 바 최상위에 먼저 추가한다. 메뉴를 누르면 그 탭에 대해 activeTab
// 권한이 생기므로, 사이트 접근 권한을 허용하지 않은 사이트에서도 동작한다.

const USE_IMAGE_MENU_ID = "use-image-as-thumbnail";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: USE_IMAGE_MENU_ID,
      title: "북마크 캡쳐 이미지로 사용",
      contexts: ["image"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== USE_IMAGE_MENU_ID || !tab?.id) return;
  const tabId = tab.id;
  useImageAsThumbnail(info, tab)
    .then((message) => showPageToast(tabId, message))
    .catch((e) => {
      console.warn("[thumbnail] 이미지로 바꾸기 실패:", e);
      showPageToast(tabId, e instanceof Error ? e.message : String(e), true);
    });
});

async function useImageAsThumbnail(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
): Promise<string> {
  const url = tab.url;
  if (!url || !/^https?:/.test(url)) {
    throw new Error("이 페이지는 북마크 캡처 이미지를 지정할 수 없습니다.");
  }
  if (!info.srcUrl) throw new Error("이미지 주소를 알 수 없습니다.");

  // 북마크를 추가하기 전에 이미지를 먼저 준비해, 실패하면 북마크도 만들지 않는다.
  let blob: Blob;
  let cropped = false;
  try {
    blob = await resizeBlob(await downloadImage(info.srcUrl));
  } catch (e) {
    // 다른 도메인의 이미지라 받을 수 없거나(CORS), SVG처럼 그릴 수 없는 형식이면
    // 지금 화면에서 그 이미지가 보이는 부분을 잘라 쓴다.
    console.debug("[thumbnail] 이미지를 직접 받지 못해 화면에서 잘라 씀:", info.srcUrl, e);
    blob = await cropImageFromScreen(tab, info.frameId ?? 0, info.srcUrl);
    cropped = true;
  }

  let key = await bookmarkKeyFor(url);
  const added = key === null;
  if (key === null) {
    await createBookmark({ parentId: BOOKMARKS_BAR_ID, title: tab.title || url, url });
    key = normalizeUrlForDedup(url);
  }
  await saveThumbnail([key], blob, info.srcUrl);

  return (
    (added
      ? "북마크 바에 이 페이지를 추가하고, 이 이미지를 캡처 이미지로 저장했습니다."
      : "이 이미지를 북마크 캡처 이미지로 저장했습니다.") +
    (cropped ? " (이미지를 직접 받을 수 없어 화면에 보이는 부분을 잘라 저장했습니다)" : "")
  );
}

async function downloadImage(srcUrl: string): Promise<Blob> {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`이미지를 받지 못했습니다. (HTTP ${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`이미지가 아닙니다: ${blob.type}`);
  return blob;
}

/** 지금 보이는 탭 화면에서 그 이미지가 있는 영역만 잘라낸다. */
async function cropImageFromScreen(
  tab: chrome.tabs.Tab,
  frameId: number,
  srcUrl: string,
): Promise<Blob> {
  // 프레임 안의 이미지는 화면 전체 기준 위치를 알 수 없으므로 잘라낼 수 없다.
  if (frameId !== 0) throw new Error("이 이미지는 가져올 수 없습니다.");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id!, frameIds: [0] },
    args: [srcUrl],
    func: (src: string) => {
      // 같은 이미지가 여러 개면 화면에 가장 크게 보이는 것을 고른다.
      let best: { left: number; top: number; right: number; bottom: number } | null = null;
      let bestArea = 0;
      for (const img of Array.from(document.images)) {
        if (img.currentSrc !== src && img.src !== src) continue;
        const r = img.getBoundingClientRect();
        const left = Math.max(0, r.left);
        const top = Math.max(0, r.top);
        const right = Math.min(window.innerWidth, r.right);
        const bottom = Math.min(window.innerHeight, r.bottom);
        const area = Math.max(0, right - left) * Math.max(0, bottom - top);
        if (area > bestArea) {
          bestArea = area;
          best = { left, top, right, bottom };
        }
      }
      return best && { ...best, viewportWidth: window.innerWidth };
    },
  });
  const rect = result?.result;
  if (!rect) throw new Error("화면에서 이미지를 찾지 못했습니다. 이미지가 보이게 스크롤한 뒤 다시 시도해 주세요.");

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // 화면 좌표(CSS 픽셀)를 캡처 이미지 픽셀로 바꾼다. (고해상도 화면이면 2배 등)
  const ratio = bitmap.width / rect.viewportWidth;
  const sx = Math.round(rect.left * ratio);
  const sy = Math.round(rect.top * ratio);
  const sw = Math.round((rect.right - rect.left) * ratio);
  const sh = Math.round((rect.bottom - rect.top) * ratio);
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  return resizeBlob(await canvas.convertToBlob({ type: "image/png" }));
}

/** 페이지 위에 잠깐 결과 안내를 띄운다. 띄울 수 없는 페이지면 콘솔에만 남긴다. */
function showPageToast(tabId: number, text: string, isError = false): void {
  chrome.scripting
    .executeScript({
      target: { tabId },
      args: [text, isError],
      func: (message: string, error: boolean) => {
        const id = "bookmarkshot-image-toast";
        document.getElementById(id)?.remove();
        const el = document.createElement("div");
        el.id = id;
        el.textContent = message;
        el.style.cssText = [
          "position:fixed",
          "left:50%",
          "bottom:24px",
          "transform:translateX(-50%)",
          "z-index:2147483647",
          "max-width:min(560px,calc(100vw - 32px))",
          "padding:10px 16px",
          "border-radius:10px",
          `background:${error ? "#cf222e" : "#1f2328"}`,
          "color:#fff",
          "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "box-shadow:0 4px 16px rgba(0,0,0,0.25)",
        ].join(";");
        document.documentElement.appendChild(el);
        setTimeout(() => el.remove(), 4000);
      },
    })
    .catch(() => console.log("[thumbnail]", text));
}
