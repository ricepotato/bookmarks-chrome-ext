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
  onEditFolder: (folder: BookmarkFolder) => void;
  /**
   * 드래그로 순서를 바꾸거나 폴더에 넣었을 때 호출된다. index는 부모 폴더 안의 새 위치이며,
   * 폴더에 넣을 때는 생략해 맨 끝에 넣는다. 넘기지 않으면(예: 검색 중) 드래그할 수 없다.
   */
  onMove?: (id: string, parentId: string, index?: number) => Promise<void>;
}

/**
 * 화면에는 폴더를 먼저, 북마크를 나중에 보여주므로 순서 바꾸기는 같은 종류끼리만 한다.
 * (폴더는 폴더 사이로, 북마크는 북마크 사이로) 북마크나 폴더를 폴더 타일 위에 놓으면
 * 그 폴더 안으로 옮긴다. 폴더를 폴더 위로 끌 때는 타일의 양쪽 가장자리가 순서 바꾸기,
 * 가운데가 폴더 안에 넣기다.
 */
type Kind = "folder" | "bookmark";

interface DragItem {
  kind: Kind;
  id: string;
}

interface DropTarget {
  id: string;
  /** 대상 타일의 앞/뒤에 놓을지, 폴더 안에 넣을지 */
  side: "before" | "after" | "into";
}

export default function BookmarkGrid({
  folders,
  bookmarks,
  folderCounts,
  thumbnails,
  showPath,
  onOpenFolder,
  onEdit,
  onEditFolder,
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
        if (!dragging) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        let side: DropTarget["side"];
        if (kind === "folder" && dragging.kind === "folder") {
          // 폴더 → 폴더: 양쪽 1/4은 순서 바꾸기, 가운데는 폴더 안에 넣기
          if (dragging.id === item.id) side = x < 0.5 ? "before" : "after";
          else side = x < 0.25 ? "before" : x > 0.75 ? "after" : "into";
        } else if (kind === "folder") {
          side = "into"; // 북마크를 폴더 위에 놓으면 폴더 안으로 옮긴다.
        } else if (dragging.kind === "bookmark") {
          // 북마크 → 북마크: 왼쪽 절반이면 앞에, 오른쪽 절반이면 뒤에 넣는다.
          side = x < 0.5 ? "before" : "after";
        } else {
          return; // 폴더를 북마크 사이에 놓을 수는 없다.
        }
        e.preventDefault(); // 드롭을 허용한다.
        e.dataTransfer.dropEffect = "move";
        if (dropTarget?.id !== item.id || dropTarget.side !== side) {
          setDropTarget({ id: item.id, side });
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        const moving = dragging;
        const side = dropTarget?.id === item.id ? dropTarget.side : null;
        endDrag();
        if (!moving || !side || moving.id === item.id) return;
        const done =
          side === "into"
            ? onMove(moving.id, item.id)
            : onMove(moving.id, item.parentId, side === "before" ? item.index : item.index + 1);
        done.catch((err) => console.error("[bookmarks] 이동 실패:", err));
      },
      onDragEnd: endDrag,
    };
  };

  const dragClass = (id: string) => {
    const classes: string[] = [];
    if (dragging?.id === id) classes.push("dragging");
    if (dropTarget?.id === id && dragging?.id !== id) {
      classes.push(`drop-${dropTarget.side}`);
    }
    return classes.join(" ");
  };

  return (
    <div className="grid">
      {folders.map((f) => (
        <div key={f.id} className={`tile ${dragClass(f.id)}`} {...dragProps("folder", f)}>
          <button
            className="tile-folder"
            onClick={() => onOpenFolder(f.id)}
            title={f.path.join(" > ")}
          >
            <div className="tile-thumb glass">
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
          <button
            className="tile-edit"
            onClick={() => onEditFolder(f)}
            title="편집"
            aria-label={`${f.title || "(이름 없음)"} 폴더 편집`}
          >
            편집
          </button>
        </div>
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
