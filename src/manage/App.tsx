import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookmarkFolder, FlatBookmark, FolderOption } from "./types";
import {
  BOOKMARKS_BAR_ID,
  createBookmark,
  createFolder,
  loadBookmarkFolders,
  loadBookmarksBarFlat,
  loadFolderOptions,
  moveBookmark,
  moveBookmarks,
  normalizeUrlForDedup,
  removeBookmark,
  removeFolder,
  renameFolder,
  updateBookmark,
} from "./bookmarks";
import BookmarkGrid from "./components/BookmarkGrid";
import BookmarkEditDialog from "./components/BookmarkEditDialog";
import FolderEditDialog from "./components/FolderEditDialog";
import NewFolderDialog from "./components/NewFolderDialog";
import AddBookmarkForm from "./components/AddBookmarkForm";
import AddFolderForm from "./components/AddFolderForm";
import BulkDomainEditor from "./components/BulkDomainEditor";
import DuplicateFinder from "./components/DuplicateFinder";
import DriveSync from "./components/DriveSync";
import FileBackup from "./components/FileBackup";
import CaptureSites from "./components/CaptureSites";
import BookmarkAddSettings from "./components/BookmarkAddSettings";
import Faq from "./components/Faq";
import { useThumbnails } from "./useThumbnails";
import {
  deleteThumbnail,
  moveThumbnails,
  notifyThumbnailsChanged,
} from "../thumbnails";
import { isDriveConfigured, moveThumbnailsInDrive } from "../drive";
import type { BulkApplyResult } from "./components/BulkDomainEditor";

/** 왼쪽 메뉴에는 북마크 목록과 설정만 둔다. 나머지 기능은 설정 안의 탭으로 옮긴다. */
const MENU = [
  { id: "list", label: "북마크 목록" },
  { id: "settings", label: "설정" },
  { id: "faq", label: "FAQ" },
] as const;

/** 설정 안의 탭들. 예전에는 왼쪽 메뉴에 바로 있던 항목들이다. */
const SETTINGS_MENU = [
  { id: "add", label: "북마크 추가" },
  { id: "capture", label: "스크린샷 설정" },
  { id: "manage", label: "북마크 관리" },
  { id: "backup", label: "스냅샷 백업" },
] as const;

type PageId =
  | (typeof MENU)[number]["id"]
  | (typeof SETTINGS_MENU)[number]["id"];
type SettingsPageId = (typeof SETTINGS_MENU)[number]["id"];

const ALL_PAGE_IDS: PageId[] = [
  ...MENU.map((m) => m.id),
  ...SETTINGS_MENU.map((m) => m.id),
];

function isSettingsPage(id: PageId): id is SettingsPageId {
  return SETTINGS_MENU.some((m) => m.id === id);
}

/** 주소의 #해시로 현재 페이지를 정한다. 새로고침하거나 뒤로 가기를 해도 유지된다.
    "settings"는 실제 화면이 아니라 설정의 첫 탭으로 보낸다. */
function pageFromHash(): PageId {
  const id = location.hash.slice(1);
  if (id === "settings") return SETTINGS_MENU[0].id;
  // 예전에 따로 있던 "중복 제거", "도메인 일괄 수정" 탭은 "북마크 관리"로 합쳐졌다.
  if (id === "duplicates" || id === "domain") return "manage";
  return (ALL_PAGE_IDS as string[]).includes(id) ? (id as PageId) : "list";
}

function usePage(): PageId {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const handleChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", handleChange);
    return () => window.removeEventListener("hashchange", handleChange);
  }, []);
  return page;
}

export default function App() {
  const page = usePage();
  const [menuOpen, setMenuOpen] = useState(false);

  // 메뉴가 열려 있을 때 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [menuOpen]);
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([]);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [folderTree, setFolderTree] = useState<BookmarkFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState(BOOKMARKS_BAR_ID);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const thumbnails = useThumbnails();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [flat, folderOpts, tree] = await Promise.all([
        loadBookmarksBarFlat(),
        loadFolderOptions(),
        loadBookmarkFolders(),
      ]);
      setBookmarks(flat);
      setFolders(folderOpts);
      setFolderTree(tree);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // 다른 곳(chrome://bookmarks, 다른 탭 등)에서 북마크가 바뀌어도 목록을 동기화한다.
    const handleChange = () => reload();
    chrome.bookmarks.onCreated.addListener(handleChange);
    chrome.bookmarks.onRemoved.addListener(handleChange);
    chrome.bookmarks.onChanged.addListener(handleChange);
    chrome.bookmarks.onMoved.addListener(handleChange);
    return () => {
      chrome.bookmarks.onCreated.removeListener(handleChange);
      chrome.bookmarks.onRemoved.removeListener(handleChange);
      chrome.bookmarks.onChanged.removeListener(handleChange);
      chrome.bookmarks.onMoved.removeListener(handleChange);
    };
  }, [reload]);

  const folderById = useMemo(
    () => new Map(folderTree.map((f) => [f.id, f])),
    [folderTree],
  );

  // 보고 있던 폴더가 다른 곳에서 삭제되면 북마크 바로 돌아간다.
  useEffect(() => {
    if (
      currentFolderId !== BOOKMARKS_BAR_ID &&
      !loading &&
      !folderById.has(currentFolderId)
    ) {
      setCurrentFolderId(BOOKMARKS_BAR_ID);
    }
  }, [currentFolderId, folderById, loading]);

  // 폴더별 북마크 수 (하위 폴더에 있는 것까지 포함)
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bookmarks) {
      let id: string | undefined = b.parentId;
      while (id && id !== BOOKMARKS_BAR_ID) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        id = folderById.get(id)?.parentId;
      }
    }
    return counts;
  }, [bookmarks, folderById]);

  const breadcrumb = useMemo(() => {
    const chain: BookmarkFolder[] = [];
    let folder = folderById.get(currentFolderId);
    while (folder) {
      chain.unshift(folder);
      folder = folderById.get(folder.parentId);
    }
    return chain;
  }, [currentFolderId, folderById]);

  const searching = query.trim().length > 0;

  const visibleFolders = useMemo(
    () =>
      searching ? [] : folderTree.filter((f) => f.parentId === currentFolderId),
    [folderTree, currentFolderId, searching],
  );

  const visibleBookmarks = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 검색 중에는 폴더와 관계없이 전체 북마크에서 찾는다.
    if (!q) return bookmarks.filter((b) => b.parentId === currentFolderId);
    return bookmarks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.path.some((p) => p.toLowerCase().includes(q)),
    );
  }, [bookmarks, query, currentFolderId]);

  const editing = editingId
    ? bookmarks.find((b) => b.id === editingId)
    : undefined;

  const editingFolder = editingFolderId
    ? folderById.get(editingFolderId)
    : undefined;

  /** 편집 중인 폴더와 그 하위 폴더 id. 자기 자신 안으로는 옮길 수 없으므로 위치 목록에서 뺀다. */
  const editingFolderSubtree = useMemo(() => {
    const ids = new Set<string>();
    if (!editingFolderId) return ids;
    ids.add(editingFolderId);
    for (const f of folderTree) {
      let id: string | undefined = f.parentId;
      while (id && id !== BOOKMARKS_BAR_ID) {
        if (id === editingFolderId) {
          ids.add(f.id);
          break;
        }
        id = folderById.get(id)?.parentId;
      }
    }
    return ids;
  }, [editingFolderId, folderTree, folderById]);

  const handleSaveRow = async (
    id: string,
    { parentId, ...changes }: { title: string; url: string; parentId: string },
  ) => {
    await updateBookmark(id, changes);
    // 폴더를 바꿨으면 새 폴더의 맨 끝(설정에 따라 맨 앞)으로 옮긴다.
    if (parentId !== bookmarks.find((b) => b.id === id)?.parentId) {
      await moveBookmark(id, parentId);
    }
    await reload();
  };

  const handleSaveFolder = async (
    id: string,
    { title, parentId }: { title: string; parentId: string },
  ) => {
    const folder = folderById.get(id);
    if (title !== folder?.title) await renameFolder(id, title);
    // 위치를 바꿨으면 새 폴더의 맨 끝(설정에 따라 맨 앞)으로 옮긴다.
    if (parentId !== folder?.parentId) await moveBookmark(id, parentId);
    await reload();
  };

  const handleDeleteFolder = async (id: string) => {
    await removeFolder(id);
    await reload();
  };

  const handleDeleteRow = async (id: string) => {
    await removeBookmark(id);
    await reload();
  };

  const handleMove = async (ids: string[], parentId: string, index?: number) => {
    await moveBookmarks(ids, parentId, index);
    await reload();
  };

  /** 목록에서 선택한 북마크와 폴더(안의 내용 포함)를 한꺼번에 삭제한다. */
  const handleDeleteSelected = async (ids: string[]) => {
    try {
      await Promise.all(
        ids.map((id) => (folderById.has(id) ? removeFolder(id) : removeBookmark(id))),
      );
    } finally {
      // 일부만 지워졌어도 화면은 실제 상태로 맞춘다.
      await reload();
    }
  };

  const handleRemoveThumbnail = async (url: string) => {
    const key = normalizeUrlForDedup(url);
    await deleteThumbnail(key);
    notifyThumbnailsChanged([key]);
  };

  const handleAdd = async (params: {
    parentId: string;
    title: string;
    url: string;
  }) => {
    await createBookmark(params);
    await reload();
  };

  const handleAddFolder = async (params: {
    parentId: string;
    title: string;
  }) => {
    await createFolder(params);
    await reload();
  };

  const handleBulkApply = async (
    changes: { id: string; url: string }[],
  ): Promise<BulkApplyResult> => {
    const updateBookmarkPromises = changes.map((c) =>
      updateBookmark(c.id, { url: c.url }),
    );
    await Promise.all(updateBookmarkPromises);

    // 바뀐 주소로 썸네일도 옮긴다. 바뀌지 않은 북마크가 아직 옛 주소를 쓰고 있으면
    // 그 썸네일은 지우지 않고 복사만 한다.
    const oldUrlById = new Map(bookmarks.map((b) => [b.id, b.url]));
    const changedIds = new Set(changes.map((c) => c.id));
    const keep = new Set(
      bookmarks
        .filter((b) => !changedIds.has(b.id))
        .map((b) => normalizeUrlForDedup(b.url)),
    );
    const moves = changes.flatMap((c) => {
      const oldUrl = oldUrlById.get(c.id);
      return oldUrl
        ? [
            {
              from: normalizeUrlForDedup(oldUrl),
              to: normalizeUrlForDedup(c.url),
            },
          ]
        : [];
    });
    const moved = await moveThumbnails(moves, keep);
    notifyThumbnailsChanged(moves.flatMap((m) => [m.from, m.to]));
    await reload();

    const drive = await moveThumbnailsInDrive(moved);
    return { thumbnails: moved.length, driveFailed: drive.failed };
  };

  const handleDeleteMany = async (ids: string[]) => {
    await Promise.all(ids.map((id) => removeBookmark(id)));
    await reload();
  };

  return (
    <div className="app">
      {/* 메뉴는 평소에는 왼쪽에 접혀 있고, 왼쪽 위의 떠 있는 버튼으로 열고 닫는다. */}
      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
        aria-expanded={menuOpen}
        aria-controls="sidebar"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          {menuOpen ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {menuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />
      )}

      <div className="layout">
        <nav
          id="sidebar"
          className={menuOpen ? "sidebar open" : "sidebar"}
          aria-label="메뉴"
        >
          {MENU.map((item) => {
            // "설정"은 하위 탭(add/capture/...) 중 하나를 보고 있을 때도 활성 표시한다.
            const active =
              item.id === page ||
              (item.id === "settings" && isSettingsPage(page));
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={active ? "sidebar-item active" : "sidebar-item"}
                aria-current={active ? "page" : undefined}
                // 메뉴를 고르면 닫고 가운데 화면만 보이게 한다.
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <main className="content">
          {loadError && (
            <div className="field-error">
              목록을 불러오지 못했습니다: {loadError}
            </div>
          )}

          {/* 페이지를 옮겨도 입력 중인 값이나 진행 중인 작업이 사라지지 않도록
              모든 페이지를 그려 두고 현재 페이지만 보여준다. */}
          <section className="page page-list" hidden={page !== "list"}>
            <div className="list-header">
              <h2>
                북마크 목록{" "}
                <span className="count">
                  {searching
                    ? `(검색 결과 ${visibleBookmarks.length}/${bookmarks.length})`
                    : `(전체 ${bookmarks.length})`}
                </span>
              </h2>
              <div className="list-actions">
                {/* 검색 중에는 "지금 보고 있는 폴더"가 없으므로 숨긴다. */}
                {!searching && (
                  <button
                    className="btn-primary"
                    onClick={() => setCreatingFolder(true)}
                  >
                    + 새 폴더
                  </button>
                )}
                <input
                  className="search-box"
                  type="text"
                  placeholder="제목, 주소, 폴더로 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            {!searching && (
              <nav className="breadcrumb" aria-label="폴더 경로">
                <button
                  className="breadcrumb-item"
                  onClick={() => setCurrentFolderId(BOOKMARKS_BAR_ID)}
                  disabled={currentFolderId === BOOKMARKS_BAR_ID}
                >
                  북마크 바
                </button>
                {breadcrumb.map((f) => (
                  <span key={f.id}>
                    <span className="breadcrumb-sep">›</span>
                    <button
                      className="breadcrumb-item"
                      onClick={() => setCurrentFolderId(f.id)}
                      disabled={f.id === currentFolderId}
                    >
                      {f.title || "(이름 없음)"}
                    </button>
                  </span>
                ))}
              </nav>
            )}

            {loading ? (
              <p>불러오는 중...</p>
            ) : (
              <BookmarkGrid
                // 다른 폴더로 가거나 검색하면 선택을 초기화한다.
                key={searching ? "search" : currentFolderId}
                folders={visibleFolders}
                bookmarks={visibleBookmarks}
                folderCounts={folderCounts}
                thumbnails={thumbnails}
                showPath={searching}
                onOpenFolder={setCurrentFolderId}
                onEdit={(b) => setEditingId(b.id)}
                onEditFolder={(f) => setEditingFolderId(f.id)}
                // 검색 결과는 여러 폴더가 섞여 있어 순서를 바꿀 기준이 없으므로 끈다.
                onMove={searching ? undefined : handleMove}
                onDelete={searching ? undefined : handleDeleteSelected}
              />
            )}
          </section>

          <section className="page" hidden={page !== "faq"}>
            <Faq />
          </section>

          <section
            className="page page-settings"
            hidden={!isSettingsPage(page)}
          >
            <nav className="settings-tabs" aria-label="설정 메뉴">
              {SETTINGS_MENU.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={
                    item.id === page ? "settings-tab active" : "settings-tab"
                  }
                  aria-current={item.id === page ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="page" hidden={page !== "add"}>
              <h2>북마크 추가</h2>
              <BookmarkAddSettings />
              <AddBookmarkForm folders={folders} onAdd={handleAdd} />

              <h2 className="page-subsection">폴더 추가</h2>
              <p className="hint">
                새 폴더는 선택한 위치의 맨 앞에 만들어집니다.
              </p>
              <AddFolderForm folders={folders} onAdd={handleAddFolder} />
            </div>

            <div className="page" hidden={page !== "capture"}>
              <CaptureSites />
            </div>

            <div className="page" hidden={page !== "manage"}>
              <DuplicateFinder
                bookmarks={bookmarks}
                onDelete={handleDeleteMany}
              />
              <div className="page-subsection">
                <BulkDomainEditor
                  bookmarks={bookmarks}
                  onApply={handleBulkApply}
                />
              </div>
            </div>

            <div className="page" hidden={page !== "backup"}>
              <h2>백업</h2>
              <div className="storage-note">
                <strong>북마크가 아니라 스냅샷 이미지를 백업합니다</strong>
                <p>
                  여기서 백업하는 것은{" "}
                  <b>북마크 항목(제목·주소·폴더) 자체가 아니라</b>, 북마크를
                  방문할 때 찍어 둔 <b>스냅샷 이미지(썸네일)</b>입니다. 북마크
                  목록은 Chrome 북마크 동기화로 이미 관리되고 있으니, 이 기능은
                  그 북마크에 딸린 화면 캡처 이미지만 내보내고 불러옵니다.
                </p>
              </div>
              <FileBackup />
              {/* Google Drive 백업은 보류된 기능이라 켜고 빌드한 경우에만 보인다. */}
              {isDriveConfigured() && <DriveSync />}
            </div>
          </section>
        </main>
      </div>

      {creatingFolder && (
        <NewFolderDialog
          locationLabel={[
            "북마크 바",
            ...breadcrumb.map((f) => f.title || "(이름 없음)"),
          ].join(" > ")}
          // 지금 보고 있는 폴더의 맨 앞에 만든다.
          onCreate={(title) =>
            handleAddFolder({ parentId: currentFolderId, title })
          }
          onClose={() => setCreatingFolder(false)}
        />
      )}

      {editingFolder && (
        <FolderEditDialog
          key={editingFolder.id}
          folder={editingFolder}
          folders={folders.filter((f) => !editingFolderSubtree.has(f.id))}
          bookmarkCount={folderCounts.get(editingFolder.id) ?? 0}
          subfolderCount={editingFolderSubtree.size - 1}
          onSave={handleSaveFolder}
          onDelete={handleDeleteFolder}
          onClose={() => setEditingFolderId(null)}
        />
      )}

      {editing && (
        <BookmarkEditDialog
          key={editing.id}
          bookmark={editing}
          folders={folders}
          onSave={handleSaveRow}
          onDelete={handleDeleteRow}
          onRemoveThumbnail={
            thumbnails.has(normalizeUrlForDedup(editing.url))
              ? () => handleRemoveThumbnail(editing.url)
              : undefined
          }
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
