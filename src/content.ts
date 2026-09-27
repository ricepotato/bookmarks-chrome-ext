// content script: 캡처 대상 사이트 중 "북마크 추가 버튼"을 켠 사이트에서
// 화면 모서리에 버튼을 띄운다. "북마크에 추가"를 누르면 저장할 폴더를 고르는 작은
// 창이 뜨고, "캡처"는 이미 북마크된 페이지일 때만 눌러서 썸네일을 새로 찍을 수 있다.
// 페이지의 CSS와 섞이지 않도록 Shadow DOM 안에 그린다.

import {
  ADD_CURRENT_PAGE_BOOKMARK,
  CAPTURE_ALL_SITES_KEY,
  CAPTURE_SITES_KEY,
  GET_BOOKMARK_FOLDERS,
  IS_PAGE_BOOKMARKED,
  RECAPTURE_CURRENT_PAGE,
  buttonPositionFor,
  getCaptureAllSites,
  getCaptureSites,
  parseCaptureSites,
  type AddCurrentPageBookmarkResult,
  type BookmarkMessageResponse,
  type ButtonPosition,
  type CaptureSite,
  type ContentMessage,
} from "./captureSites";
import type { FolderOption } from "./manage/types";

const STYLE = `
  :host { all: initial; }
  .root {
    position: fixed;
    z-index: 2147483647;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1f2328;
  }
  .root.top-left { top: 16px; left: 16px; }
  .root.top-right { top: 16px; right: 16px; }
  .root.bottom-left { bottom: 16px; left: 16px; }
  .root.bottom-right { bottom: 16px; right: 16px; }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
    border: 1px solid #d0d7de;
    background: #f6f8fa;
    color: inherit;
    padding: 5px 10px;
  }
  button:disabled { cursor: default; opacity: 0.6; }
  .fab {
    border: none;
    background: #0969da;
    color: #fff;
    padding: 8px 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    opacity: 0.85;
  }
  .fab:hover:not(:disabled) { opacity: 1; }
  .fab:disabled { background: #6e7781; opacity: 0.6; }
  .fabs { display: flex; gap: 6px; }
  .top-right .fabs, .bottom-right .fabs { justify-content: flex-end; }
  .toast {
    position: absolute;
    white-space: nowrap;
    padding: 6px 10px;
    border-radius: 6px;
    background: #1f2328;
    color: #fff;
    font-size: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  .toast.error { background: #cf222e; }
  .panel {
    position: absolute;
    width: 300px;
    box-sizing: border-box;
    padding: 12px;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .top-left :is(.panel, .toast), .top-right :is(.panel, .toast) { top: calc(100% + 8px); }
  .bottom-left :is(.panel, .toast), .bottom-right :is(.panel, .toast) { bottom: calc(100% + 8px); }
  .top-left :is(.panel, .toast), .bottom-left :is(.panel, .toast) { left: 0; }
  .top-right :is(.panel, .toast), .bottom-right :is(.panel, .toast) { right: 0; }
  .panel strong { font-size: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #59636e; }
  input, select {
    font: inherit;
    color: #1f2328;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 5px 8px;
  }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .actions .primary { background: #0969da; border-color: #0969da; color: #fff; }
  .status { font-size: 12px; color: #59636e; }
  .status.error { color: #cf222e; }
  @media (prefers-color-scheme: dark) {
    .root { color: #e6edf3; }
    button { background: #21262d; border-color: #3d444d; }
    .panel { background: #161b22; border-color: #3d444d; }
    label, .status { color: #9198a1; }
    input, select { background: #0d1117; color: #e6edf3; border-color: #3d444d; }
    .status.error { color: #f85149; }
  }
`;

function sendMessage<T>(message: ContentMessage): Promise<T> {
  return chrome.runtime
    .sendMessage(message)
    .then((res: BookmarkMessageResponse<T> | undefined) => {
      if (!res) throw new Error("확장 프로그램에서 응답이 없습니다.");
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let host: HTMLElement | null = null;
/** 버튼을 지울 때 문서에 건 이벤트 리스너도 함께 떼어낸다. */
let listeners: AbortController | null = null;

function removeButton() {
  listeners?.abort();
  listeners = null;
  host?.remove();
  host = null;
}

function renderButton(position: ButtonPosition) {
  removeButton();
  host = el("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const root = el("div", { className: `root ${position}` });
  const fab = el("button", {
    className: "fab",
    textContent: "★ 북마크에 추가",
    title: "현재 사이트를 북마크에 추가",
  });
  const captureButton = el("button", {
    className: "fab",
    textContent: "캡처",
    disabled: true,
  });
  root.append(el("div", { className: "fabs" }, fab, captureButton));
  shadow.append(el("style", { textContent: STYLE }), root);
  document.documentElement.append(host);
  listeners = new AbortController();
  const { signal } = listeners;

  let panel: HTMLElement | null = null;
  const closePanel = () => {
    panel?.remove();
    panel = null;
  };

  let toast: HTMLElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (text: string, isError = false) => {
    toast?.remove();
    clearTimeout(toastTimer);
    toast = el("div", { className: isError ? "toast error" : "toast", textContent: text });
    root.append(toast);
    toastTimer = setTimeout(() => toast?.remove(), isError ? 4000 : 2000);
  };

  // "캡처"는 현재 주소가 북마크되어 있을 때만 누를 수 있다. 다른 곳에서 북마크를
  // 추가/삭제하거나 SPA에서 주소가 바뀔 수 있으므로 필요할 때마다 다시 확인한다.
  const refreshBookmarked = async () => {
    let bookmarked = false;
    try {
      bookmarked = await sendMessage<boolean>({ type: IS_PAGE_BOOKMARKED, url: location.href });
    } catch {
      // 확장이 업데이트되어 연결이 끊긴 경우 등. 누를 수 없는 상태로 둔다.
    }
    captureButton.disabled = !bookmarked;
    captureButton.title = bookmarked
      ? "현재 화면을 캡처해 이 북마크의 썸네일을 교체"
      : "북마크에 추가된 페이지에서만 사용할 수 있습니다";
  };
  refreshBookmarked();
  root.addEventListener("mouseenter", refreshBookmarked);
  window.addEventListener("popstate", refreshBookmarked, { signal });
  window.addEventListener("hashchange", refreshBookmarked, { signal });
  document.addEventListener(
    "visibilitychange",
    () => document.visibilityState === "visible" && refreshBookmarked(),
    { signal },
  );

  fab.addEventListener("click", () => {
    if (panel) {
      closePanel();
      return;
    }
    panel = buildPanel(closePanel, refreshBookmarked);
    root.append(panel);
  });

  captureButton.addEventListener("click", async () => {
    closePanel();
    toast?.remove();
    captureButton.disabled = true;
    await hideWhileCapturing(true);
    try {
      await sendMessage<void>({ type: RECAPTURE_CURRENT_PAGE, url: location.href });
      await hideWhileCapturing(false);
      showToast("화면을 캡처해 썸네일을 교체했습니다.");
    } catch (e) {
      await hideWhileCapturing(false);
      showToast(`캡처하지 못했습니다: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      refreshBookmarked();
    }
  });

  // 창 바깥을 누르거나 Esc를 누르면 닫는다. (closed shadow라 composedPath로 판별)
  document.addEventListener(
    "mousedown",
    (e) => {
      if (panel && host && !e.composedPath().includes(host)) closePanel();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (panel && e.key === "Escape") closePanel();
    },
    { signal },
  );
}

function buildPanel(close: () => void, onAdded: () => void): HTMLElement {
  const titleInput = el("input", { type: "text", value: document.title || location.href });
  const folderSelect = el("select", { disabled: true });
  folderSelect.append(el("option", { textContent: "폴더 불러오는 중..." }));
  const status = el("div", { className: "status" });
  const cancel = el("button", { type: "button", textContent: "취소" });
  const add = el("button", { type: "button", className: "primary", textContent: "추가", disabled: true });

  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.className = isError ? "status error" : "status";
  };

  sendMessage<FolderOption[]>({ type: GET_BOOKMARK_FOLDERS })
    .then((folders) => {
      folderSelect.replaceChildren(
        ...folders.map((f) => el("option", { value: f.id, textContent: f.label })),
      );
      folderSelect.disabled = false;
      add.disabled = false;
    })
    .catch((e) => setStatus(`폴더 목록을 불러오지 못했습니다: ${e.message ?? e}`, true));

  cancel.addEventListener("click", close);
  add.addEventListener("click", async () => {
    add.disabled = true;
    setStatus("추가하는 중...");
    // 서비스 워커가 북마크 추가와 함께 화면을 캡처하므로, 그동안 버튼과 창을 숨겨
    // 썸네일에 찍히지 않게 한다.
    await hideWhileCapturing(true);
    try {
      const result = await sendMessage<AddCurrentPageBookmarkResult>({
        type: ADD_CURRENT_PAGE_BOOKMARK,
        parentId: folderSelect.value,
        title: titleInput.value.trim(),
        url: location.href,
      });
      const folder = folderSelect.selectedOptions[0]?.textContent ?? "";
      onAdded();
      if (result.captured) {
        setStatus(`"${folder}"에 추가하고 화면을 저장했습니다.`);
        setTimeout(close, 1200);
      } else {
        // 북마크는 추가되었으니 창을 닫지 않고 캡처 실패만 알린다.
        setStatus(
          `"${folder}"에 추가했지만 화면을 저장하지 못했습니다: ${result.captureError}`,
          true,
        );
      }
    } catch (e) {
      setStatus(`추가하지 못했습니다: ${e instanceof Error ? e.message : e}`, true);
      add.disabled = false;
    } finally {
      await hideWhileCapturing(false);
    }
  });

  return el(
    "div",
    { className: "panel" },
    el("strong", { textContent: "북마크에 추가" }),
    el("label", {}, "제목", titleInput),
    el("label", {}, "폴더", folderSelect),
    status,
    el("div", { className: "actions" }, cancel, add),
  );
}

/**
 * 캡처하는 동안 버튼과 창을 화면에서 숨긴다. 숨긴 뒤에는 브라우저가 실제로 다시
 * 그릴 때까지(두 프레임 + 여유) 기다렸다가 돌아간다.
 */
async function hideWhileCapturing(hidden: boolean) {
  if (!host) return;
  host.style.visibility = hidden ? "hidden" : "";
  if (!hidden) return;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 50));
}

let currentPosition: ButtonPosition | null = null;
let settings: { sites: CaptureSite[]; allSites: boolean } = { sites: [], allSites: false };

function apply() {
  const position = buttonPositionFor(location.href, settings.sites, settings.allSites);
  if (position === currentPosition) return;
  currentPosition = position;
  if (position) renderButton(position);
  else removeButton();
}

if (/^https?:$/.test(location.protocol)) {
  Promise.all([getCaptureSites(), getCaptureAllSites()]).then(([sites, allSites]) => {
    settings = { sites, allSites };
    apply();
  });
  // 관리 페이지에서 설정을 바꾸면 열려 있는 페이지에도 바로 반영한다.
  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes[CAPTURE_SITES_KEY]) {
      settings = { ...settings, sites: parseCaptureSites(changes[CAPTURE_SITES_KEY].newValue) };
    }
    if (changes[CAPTURE_ALL_SITES_KEY]) {
      settings = { ...settings, allSites: changes[CAPTURE_ALL_SITES_KEY].newValue === true };
    }
    if (changes[CAPTURE_SITES_KEY] || changes[CAPTURE_ALL_SITES_KEY]) apply();
  });
}
