import { loadBookmarksBarFlat, normalizeUrlForDedup } from "./manage/bookmarks";
import {
  THUMBNAIL_UPDATED,
  getThumbnail,
  putThumbnail,
  type ThumbnailUpdatedMessage,
} from "./thumbnails";

// 서비스 워커: 확장 아이콘 클릭 시 관리 페이지를 새 탭으로 연다.
// action.default_popup을 지정하지 않았기 때문에 onClicked가 정상적으로 동작한다.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ---- 썸네일 자동 캡처 ----
// 북마크된 사이트의 로딩이 끝나면 화면을 캡처해 썸네일로 저장한다.
// captureVisibleTab은 창에 "보이는" 탭만 찍을 수 있으므로, 백그라운드에서 로드된 탭은
// 사용자가 그 탭으로 전환했을 때 찍는다.

/** 로딩 완료 후 렌더링(웹폰트, 이미지 등)이 자리잡을 때까지 기다리는 시간 */
const CAPTURE_DELAY_MS = 1000;
/** 이 시간 안에 찍은 썸네일이 있으면 다시 찍지 않는다. */
const RECAPTURE_AFTER_MS = 60 * 60 * 1000;
/** 저장할 이미지의 최대 가로 크기 (마우스 오버 시 크게 보여주기 위해 넉넉히) */
const MAX_WIDTH = 1280;

/** 현재 탭 URL이 북마크 바에 있는 북마크라면 썸네일 키를, 아니면 null을 돌려준다. */
async function bookmarkKeyFor(url: string | undefined): Promise<string | null> {
  if (!url || !/^https?:/.test(url)) return null;
  const key = normalizeUrlForDedup(url);
  const bookmarks = await loadBookmarksBarFlat();
  return bookmarks.some((b) => normalizeUrlForDedup(b.url) === key) ? key : null;
}

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

  const key = await bookmarkKeyFor(tab.url);
  if (!key) {
    console.debug("[thumbnail] 북마크 바에 없는 주소라 건너뜀:", tab.url);
    return;
  }

  const existing = await getThumbnail(key);
  if (existing && Date.now() - existing.capturedAt < RECAPTURE_AFTER_MS) return;

  await new Promise((r) => setTimeout(r, CAPTURE_DELAY_MS));

  // 기다리는 동안 다른 탭으로 전환했거나 다른 페이지로 이동했으면 찍지 않는다.
  const current = await chrome.tabs.get(tabId);
  if (!current.active || current.url !== tab.url) return;

  const dataUrl = await chrome.tabs.captureVisibleTab(current.windowId, {
    format: "jpeg",
    quality: 90,
  });
  await putThumbnail(key, { blob: await resize(dataUrl), capturedAt: Date.now() });
  console.log("[thumbnail] 저장 완료:", key);

  const message: ThumbnailUpdatedMessage = { type: THUMBNAIL_UPDATED, key };
  // 관리 페이지가 열려 있지 않으면 받는 쪽이 없어 실패하므로 무시한다.
  chrome.runtime.sendMessage(message).catch(() => {});
}

/** 로딩 완료와 탭 전환이 동시에 일어나도 한 번만 찍도록 진행 중인 탭을 기록한다. */
const inFlight = new Set<number>();

function tryCapture(tabId: number) {
  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);
  captureIfBookmarked(tabId)
    .catch((e) => {
      // 탭이 닫혔거나, 창이 최소화되었거나, 캡처가 금지된 페이지 등. 기록만 남기고 넘어간다.
      console.warn("[thumbnail] 캡처 실패:", e);
    })
    .finally(() => inFlight.delete(tabId));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") tryCapture(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  tryCapture(tabId);
});
