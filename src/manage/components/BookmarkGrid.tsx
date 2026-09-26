import type { BookmarkFolder, FlatBookmark } from "../types";
import BookmarkTile from "./BookmarkTile";

interface Props {
  folders: BookmarkFolder[];
  bookmarks: FlatBookmark[];
  /** 폴더별 하위 북마크 수 (하위 폴더 포함) */
  folderCounts: Map<string, number>;
  showPath?: boolean;
  onOpenFolder: (id: string) => void;
  onEdit: (bookmark: FlatBookmark) => void;
}

export default function BookmarkGrid({
  folders,
  bookmarks,
  folderCounts,
  showPath,
  onOpenFolder,
  onEdit,
}: Props) {
  if (folders.length === 0 && bookmarks.length === 0) {
    return <p className="empty">표시할 북마크가 없습니다.</p>;
  }

  return (
    <div className="grid">
      {folders.map((f) => (
        <button
          key={f.id}
          className="tile tile-folder"
          onClick={() => onOpenFolder(f.id)}
          title={f.path.join(" > ")}
        >
          <div className="tile-thumb">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"
              />
            </svg>
          </div>
          <div className="tile-body">
            <div className="tile-title">{f.title || "(이름 없음)"}</div>
            <div className="tile-sub">북마크 {folderCounts.get(f.id) ?? 0}개</div>
          </div>
        </button>
      ))}
      {bookmarks.map((b) => (
        <BookmarkTile key={b.id} bookmark={b} showPath={showPath} onEdit={onEdit} />
      ))}
    </div>
  );
}
