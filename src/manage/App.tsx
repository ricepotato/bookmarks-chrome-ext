import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookmarkFolder, FlatBookmark, FolderOption } from "./types";
import {
  BOOKMARKS_BAR_ID,
  createBookmark,
  loadBookmarkFolders,
  loadBookmarksBarFlat,
  loadFolderOptions,
  normalizeUrlForDedup,
  removeBookmark,
  updateBookmark,
} from "./bookmarks";
import BookmarkGrid from "./components/BookmarkGrid";
import BookmarkEditDialog from "./components/BookmarkEditDialog";
import AddBookmarkForm from "./components/AddBookmarkForm";
import BulkDomainEditor from "./components/BulkDomainEditor";
import DuplicateFinder from "./components/DuplicateFinder";
import DriveSync from "./components/DriveSync";
import FileBackup from "./components/FileBackup";
import CaptureSites from "./components/CaptureSites";
import { useThumbnails } from "./useThumbnails";
import { moveThumbnails, notifyThumbnailsChanged } from "../thumbnails";
import { moveThumbnailsInDrive } from "../drive";
import type { BulkApplyResult } from "./components/BulkDomainEditor";

/** 왼쪽 메뉴. 북마크 목록이 기본 화면이고, 나머지는 자주 쓰는 순서로 둔다. */
const MENU = [
  { id: "list", label: "북마크 목록" },
  { id: "add", label: "북마크 추가" },
  { id: "capture", label: "미리보기 설정" },
  { id: "duplicates", label: "중복 제거" },
  { id: "domain", label: "도메인 일괄 수정" },
  { id: "backup", label: "백업" },
] as const;

type PageId = (typeof MENU)[number]["id"];

/** 주소의 #해시로 현재 페이지를 정한다. 새로고침하거나 뒤로 가기를 해도 유지된다. */
function pageFromHash(): PageId {
  const id = location.hash.slice(1);
  return MENU.find((m) => m.id === id)?.id ?? "list";
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
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([]);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [folderTree, setFolderTree] = useState<BookmarkFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState(BOOKMARKS_BAR_ID);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const handleSaveRow = async (
    id: string,
    changes: { title: string; url: string },
  ) => {
    await updateBookmark(id, changes);
    await reload();
  };

  const handleDeleteRow = async (id: string) => {
    await removeBookmark(id);
    await reload();
  };

  const handleAdd = async (params: {
    parentId: string;
    title: string;
    url: string;
  }) => {
    await createBookmark(params);
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
        ? [{ from: normalizeUrlForDedup(oldUrl), to: normalizeUrlForDedup(c.url) }]
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
      <header className="topbar">
        <h1>북마크 관리</h1>
        <span className="hint">대상 범위: 북마크 바 (하위 폴더 포함)</span>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="메뉴">
          {MENU.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={item.id === page ? "sidebar-item active" : "sidebar-item"}
              aria-current={item.id === page ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <main className="content">
          {loadError && (
            <div className="field-error">
              목록을 불러오지 못했습니다: {loadError}
            </div>
          )}

          {/* 페이지를 옮겨도 입력 중인 값이나 진행 중인 작업이 사라지지 않도록
              모든 페이지를 그려 두고 현재 페이지만 보여준다. */}
          <section className="page" hidden={page !== "list"}>
            <div className="list-header">
              <h2>
                북마크 목록{" "}
                <span className="count">
                  {searching
                    ? `(검색 결과 ${visibleBookmarks.length}/${bookmarks.length})`
                    : `(전체 ${bookmarks.length})`}
                </span>
              </h2>
              <input
                className="search-box"
                type="text"
                placeholder="제목, 주소, 폴더로 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
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
                folders={visibleFolders}
                bookmarks={visibleBookmarks}
                folderCounts={folderCounts}
                thumbnails={thumbnails}
                showPath={searching}
                onOpenFolder={setCurrentFolderId}
                onEdit={(b) => setEditingId(b.id)}
              />
            )}
          </section>

          <section className="page" hidden={page !== "add"}>
            <h2>북마크 추가</h2>
            <AddBookmarkForm folders={folders} onAdd={handleAdd} />
          </section>

          <section className="page" hidden={page !== "capture"}>
            <CaptureSites />
          </section>

          <section className="page" hidden={page !== "duplicates"}>
            <DuplicateFinder bookmarks={bookmarks} onDelete={handleDeleteMany} />
          </section>

          <section className="page" hidden={page !== "domain"}>
            <BulkDomainEditor bookmarks={bookmarks} onApply={handleBulkApply} />
          </section>

          <section className="page" hidden={page !== "backup"}>
            <h2>백업</h2>
            <FileBackup />
            <DriveSync />
          </section>
        </main>
      </div>

      {editing && (
        <BookmarkEditDialog
          key={editing.id}
          bookmark={editing}
          onSave={handleSaveRow}
          onDelete={handleDeleteRow}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
