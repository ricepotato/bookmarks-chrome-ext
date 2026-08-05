import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlatBookmark, FolderOption } from "./types";
import {
  createBookmark,
  loadBookmarksBarFlat,
  loadFolderOptions,
  removeBookmark,
  updateBookmark,
} from "./bookmarks";
import BookmarkRow from "./components/BookmarkRow";
import AddBookmarkForm from "./components/AddBookmarkForm";
import BulkDomainEditor from "./components/BulkDomainEditor";

export default function App() {
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([]);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [flat, folderOpts] = await Promise.all([
        loadBookmarksBarFlat(),
        loadFolderOptions(),
      ]);
      setBookmarks(flat);
      setFolders(folderOpts);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.path.some((p) => p.toLowerCase().includes(q)),
    );
  }, [bookmarks, query]);

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

  const handleBulkApply = async (changes: { id: string; url: string }[]) => {
    const updateBookmarkPromises = changes.map((c) =>
      updateBookmark(c.id, { url: c.url }),
    );
    await Promise.all(updateBookmarkPromises);
    await reload();
  };

  return (
    <div className="app">
      <header>
        <h1>북마크 관리</h1>
        <p className="hint">대상 범위: 북마크 바 (하위 폴더 포함)</p>
      </header>

      {loadError && (
        <div className="field-error">
          목록을 불러오지 못했습니다: {loadError}
        </div>
      )}

      <section>
        <h2>새 북마크 추가</h2>
        <AddBookmarkForm folders={folders} onAdd={handleAdd} />
      </section>

      <section>
        <BulkDomainEditor bookmarks={bookmarks} onApply={handleBulkApply} />
      </section>

      <section>
        <div className="list-header">
          <h2>
            북마크 목록{" "}
            <span className="count">
              ({filtered.length}/{bookmarks.length})
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

        {loading ? (
          <p>불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="empty">표시할 북마크가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-path">폴더</th>
                <th className="col-title">제목</th>
                <th className="col-url">주소</th>
                <th className="col-actions">동작</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <BookmarkRow
                  key={b.id}
                  bookmark={b}
                  onSave={handleSaveRow}
                  onDelete={handleDeleteRow}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
