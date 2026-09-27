import { useState } from "react";
import type { BookmarkFolder, FlatBookmark } from "../types";
import { normalizeUrlForDedup } from "../bookmarks";
import BookmarkTile from "./BookmarkTile";

interface Props {
  folders: BookmarkFolder[];
  bookmarks: FlatBookmark[];
  /** 폴더별 하위 북마크 수 (하위 폴더 포함) */
  folderCounts: Map<string, number>;
  /** 썸네일 키(normalizeUrlForDedup) → 이미지 URL */
  thumbnails: Map<string, string>;
  showPath?: boolean;
  onOpenFolder: (id: string) => void;
  onEdit: (bookmark: FlatBookmark) => void;
  /**
   * 드래그로 순서를 바꿨을 때 호출된다. index는 부모 폴더 안의 새 위치.
   * 넘기지 않으면(예: 검색 중) 드래그할 수 없다.
   */
  onMove?: (id: string, parentId: string, index: number) => Promise<void>;
}

/**
 * 화면에는 폴더를 먼저, 북마크를 나중에 보여주므로 순서 바꾸기도 같은 종류끼리만 한다.
 * (폴더는 폴더 사이로, 북마크는 북마크 사이로)
 */
type Kind = "folder" | "bookmark";

interface DragItem {
  kind: Kind;
  id: string;
}

interface DropTarget {
  id: string;
  side: "before" | "after";
}

export default function BookmarkGrid({
  folders,
  bookmarks,
  folderCounts,
  thumbnails,
  showPath,
  onOpenFolder,
  onEdit,
  onMove,
}: Props) {
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  if (folders.length === 0 && bookmarks.length === 0) {
    return <p className="empty">표시할 북마크가 없습니다.</p>;
  }

  const endDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  /** 타일 하나에 붙일 드래그 관련 속성 */
  const dragProps = (
    kind: Kind,
    item: { id: string; parentId: string; index: number },
  ): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } => {
    if (!onMove) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        // 일부 환경에서는 데이터가 없으면 드래그가 시작되지 않는다.
        e.dataTransfer.setData("text/plain", item.id);
        setDragging({ kind, id: item.id });
      },
      onDragOver: (e) => {
        if (!dragging || dragging.kind !== kind) return;
        e.preventDefault(); // 드롭을 허용한다.
        e.dataTransfer.dropEffect = "move";
        // 타일의 왼쪽 절반이면 앞에, 오른쪽 절반이면 뒤에 넣는다.
        const rect = e.currentTarget.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        if (dropTarget?.id !== item.id || dropTarget.side !== side) {
          setDropTarget({ id: item.id, side });
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        const moving = dragging;
        const side = dropTarget?.id === item.id ? dropTarget.side : "before";
        endDrag();
        if (!moving || moving.kind !== kind || moving.id === item.id) return;
        const index = side === "before" ? item.index : item.index + 1;
        onMove(moving.id, item.parentId, index).catch((err) =>
          console.error("[bookmarks] 순서 변경 실패:", err),
        );
      },
      onDragEnd: endDrag,
    };
  };

  const dragClass = (id: string) => {
    const classes: string[] = [];
    if (dragging?.id === id) classes.push("dragging");
    if (dropTarget?.id === id && dragging?.id !== id) {
      classes.push(dropTarget.side === "before" ? "drop-before" : "drop-after");
    }
    return classes.join(" ");
  };

  return (
    <div className="grid">
      {folders.map((f) => (
        <button
          key={f.id}
          className={`tile tile-folder ${dragClass(f.id)}`}
          onClick={() => onOpenFolder(f.id)}
          title={f.path.join(" > ")}
          {...dragProps("folder", f)}
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
        <BookmarkTile
          key={b.id}
          bookmark={b}
          thumbnailUrl={thumbnails.get(normalizeUrlForDedup(b.url))}
          showPath={showPath}
          onEdit={onEdit}
          className={dragClass(b.id)}
          dragProps={dragProps("bookmark", b)}
        />
      ))}
    </div>
  );
}
