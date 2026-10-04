import { useEffect, useRef, useState } from "react";
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
   * 드래그로 순서를 바꾸거나 폴더에 넣었을 때 호출된다. ids는 옮기는 항목들(선택한 항목
   * 전체 또는 끈 항목 하나), index는 부모 폴더 안의 새 위치이며 폴더에 넣을 때는 생략한다.
   * 넘기지 않으면(예: 검색 중) 드래그와 여러 항목 선택을 할 수 없다.
   */
  onMove?: (ids: string[], parentId: string, index?: number) => Promise<void>;
  /** 선택한 항목을 Delete 키로 삭제할 때 (확인을 받은 뒤) 호출된다. */
  onDelete?: (ids: string[]) => Promise<void>;
}

/**
 * 화면에는 폴더를 먼저, 북마크를 나중에 보여주므로 순서 바꾸기는 같은 종류끼리만 한다.
 * (폴더는 폴더 사이로, 북마크는 북마크 사이로) 북마크나 폴더를 폴더 타일 위에 놓으면
 * 그 폴더 안으로 옮긴다. 폴더만 끌어 폴더 위로 가져갈 때는 타일의 양쪽 가장자리가 순서
 * 바꾸기, 가운데가 폴더 안에 넣기다.
 *
 * 빈 곳에서 마우스를 끌면 사각형 안의 타일을 여러 개 선택하고, Ctrl(⌘)+클릭으로 하나씩
 * 선택을 더하거나 뺄 수 있다. 선택한 타일을 끌면 선택한 항목이 모두 함께 옮겨진다.
 */
type Kind = "folder" | "bookmark";

interface DragItems {
  /** 옮기는 항목 id (화면 순서) */
  ids: string[];
  hasFolder: boolean;
  hasBookmark: boolean;
}

interface DropTarget {
  id: string;
  /** 대상 타일의 앞/뒤에 놓을지, 폴더 안에 넣을지 */
  side: "before" | "after" | "into";
}

/** 그리드 영역 기준 좌표의 선택 사각형 (시작점과 현재점) */
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 마우스를 이만큼 움직여야 클릭이 아니라 사각형 선택으로 본다. */
const MARQUEE_THRESHOLD_PX = 4;

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
  onDelete,
}: Props) {
  const [dragging, setDragging] = useState<DragItems | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // 화면에 그리는 순서 그대로의 항목 목록 (그리드의 자식 요소 순서와 같다)
  const items: { id: string; kind: Kind }[] = [
    ...folders.map((f) => ({ id: f.id, kind: "folder" as const })),
    ...bookmarks.map((b) => ({ id: b.id, kind: "bookmark" as const })),
  ];
  // 다른 폴더로 옮겨져 화면에서 사라진 항목은 선택에서 뺀다.
  const visibleSelected = items.filter((it) => selected.has(it.id));

  useEffect(() => {
    if (selected.size === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      // 목록이 화면에 없거나(다른 메뉴) 편집 창이 떠 있거나 입력 칸에 쓰는 중이면 무시한다.
      if (!areaRef.current?.offsetParent || document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") setSelected(new Set());
      else if (e.key === "Delete" && onDelete) {
        e.preventDefault();
        deleteSelected(onDelete);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  });

  if (folders.length === 0 && bookmarks.length === 0) {
    return <p className="empty">표시할 북마크가 없습니다.</p>;
  }

  const deleteSelected = async (remove: (ids: string[]) => Promise<void>) => {
    const targets = visibleSelected;
    if (targets.length === 0) return;
    const folderTargets = folders.filter((f) => selected.has(f.id));
    const bookmarkCount = targets.length - folderTargets.length;
    const inside = folderTargets.reduce((sum, f) => sum + (folderCounts.get(f.id) ?? 0), 0);
    const parts = [
      folderTargets.length > 0 && `폴더 ${folderTargets.length}개`,
      bookmarkCount > 0 && `북마크 ${bookmarkCount}개`,
    ].filter(Boolean);
    const ok = window.confirm(
      `선택한 ${parts.join(", ")}를 삭제할까요?` +
        (folderTargets.length > 0
          ? `\n\n폴더 안의 북마크 ${inside}개와 하위 폴더도 모두 함께 삭제됩니다.`
          : "") +
        "\n되돌릴 수 없습니다.",
    );
    if (!ok) return;
    try {
      await remove(targets.map((t) => t.id));
      setSelected(new Set());
    } catch (err) {
      console.error("[bookmarks] 삭제 실패:", err);
      window.alert(`삭제하지 못한 항목이 있습니다.\n${err instanceof Error ? err.message : err}`);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 빈 곳에서 마우스를 눌러 끌면 사각형으로 여러 타일을 선택한다. */
  const handleAreaMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onMove || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tile, .selection-bar")) return;
    const area = areaRef.current;
    const grid = gridRef.current;
    if (!area || !grid) return;
    e.preventDefault(); // 끄는 동안 글자가 선택되지 않게 한다.

    // Ctrl/⌘/Shift를 누른 채 시작하면 기존 선택에 더한다.
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const startRect = area.getBoundingClientRect();
    const x0 = e.clientX - startRect.left;
    const y0 = e.clientY - startRect.top;
    let last = { x: e.clientX, y: e.clientY };
    let started = false;

    // 그리드 영역 기준 좌표로 계산하므로 끄는 도중 스크롤해도 사각형이 어긋나지 않는다.
    const update = () => {
      const rect = area.getBoundingClientRect();
      const x1 = last.x - rect.left;
      const y1 = last.y - rect.top;
      if (!started && Math.hypot(x1 - x0, y1 - y0) < MARQUEE_THRESHOLD_PX) return;
      started = true;
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      const top = Math.min(y0, y1);
      const bottom = Math.max(y0, y1);
      const next = new Set(base);
      Array.from(grid.children).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const tl = r.left - rect.left;
        const tt = r.top - rect.top;
        const hit = tl < right && tl + r.width > left && tt < bottom && tt + r.height > top;
        if (hit && items[i]) next.add(items[i].id);
      });
      setSelected(next);
      setMarquee({ x0, y0, x1, y1 });
    };

    const handleMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      update();
    };
    const handleUp = () => {
      // 끌지 않고 빈 곳을 클릭만 했으면 선택을 해제한다.
      if (!started && !additive) setSelected(new Set());
      setMarquee(null);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      window.removeEventListener("scroll", update, true);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    window.addEventListener("scroll", update, true);
  };

  const endDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  /** 타일 하나에 붙일 드래그/선택 관련 속성 */
  const tileProps = (
    kind: Kind,
    item: { id: string; parentId: string; index: number },
  ): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } => {
    if (!onMove) return {};
    return {
      draggable: true,
      // Ctrl(⌘)+클릭은 열거나 편집하지 않고 선택만 바꾼다.
      onClickCapture: (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSelected(item.id);
      },
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        // 일부 환경에서는 데이터가 없으면 드래그가 시작되지 않는다.
        e.dataTransfer.setData("text/plain", item.id);
        // 선택한 타일을 끌면 선택 전체를, 선택하지 않은 타일을 끌면 그 타일만 옮긴다.
        const moving = selected.has(item.id) ? visibleSelected : [{ id: item.id, kind }];
        if (!selected.has(item.id)) setSelected(new Set());
        if (moving.length > 1) setCountDragImage(e.dataTransfer, moving.length);
        setDragging({
          ids: moving.map((m) => m.id),
          hasFolder: moving.some((m) => m.kind === "folder"),
          hasBookmark: moving.some((m) => m.kind === "bookmark"),
        });
      },
      onDragOver: (e) => {
        // 옮기는 항목 자신 위에는 놓을 수 없다.
        if (!dragging || dragging.ids.includes(item.id)) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        let side: DropTarget["side"];
        if (kind === "folder" && !dragging.hasBookmark) {
          // 폴더만 → 폴더: 양쪽 1/4은 순서 바꾸기, 가운데는 폴더 안에 넣기
          side = x < 0.25 ? "before" : x > 0.75 ? "after" : "into";
        } else if (kind === "folder") {
          side = "into"; // 북마크가 섞여 있으면 폴더 위에 놓을 때 폴더 안으로 옮긴다.
        } else if (!dragging.hasFolder) {
          // 북마크만 → 북마크: 왼쪽 절반이면 앞에, 오른쪽 절반이면 뒤에 넣는다.
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
        if (!moving || !side || moving.ids.includes(item.id)) return;
        const done =
          side === "into"
            ? onMove(moving.ids, item.id)
            : onMove(moving.ids, item.parentId, side === "before" ? item.index : item.index + 1);
        done.catch((err) => console.error("[bookmarks] 이동 실패:", err));
      },
      onDragEnd: endDrag,
    };
  };

  const tileClass = (id: string) => {
    const classes: string[] = [];
    if (selected.has(id)) classes.push("selected");
    if (dragging?.ids.includes(id)) classes.push("dragging");
    if (dropTarget?.id === id && !dragging?.ids.includes(id)) {
      classes.push(`drop-${dropTarget.side}`);
    }
    return classes.join(" ");
  };

  return (
    <div className="grid-area" ref={areaRef} onMouseDown={handleAreaMouseDown}>
      {onMove && (
        <div className="selection-bar">
          {visibleSelected.length > 0 ? (
            <>
              <span>
                <b>{visibleSelected.length}개 선택됨</b> · 선택한 항목을 끌어 순서를 바꾸거나
                폴더 위에 놓아 한꺼번에 옮길 수 있습니다.
                {onDelete && " Delete 키를 누르면 한꺼번에 삭제합니다."}
              </span>
              <button type="button" onClick={() => setSelected(new Set())}>
                선택 해제
              </button>
            </>
          ) : (
            <span className="hint">
              빈 곳에서 마우스를 끌거나 Ctrl(⌘)+클릭하면 여러 항목을 선택할 수 있습니다.
            </span>
          )}
        </div>
      )}
      <div className="grid" ref={gridRef}>
        {folders.map((f) => (
          <div key={f.id} className={`tile ${tileClass(f.id)}`} {...tileProps("folder", f)}>
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
            className={tileClass(b.id)}
            dragProps={tileProps("bookmark", b)}
          />
        ))}
      </div>
      {marquee && (
        <div
          className="selection-box"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </div>
  );
}

/** 여러 항목을 끌 때 커서 옆에 "N개 항목" 배지를 드래그 이미지로 보여준다. */
function setCountDragImage(dataTransfer: DataTransfer, count: number) {
  const badge = document.createElement("div");
  badge.className = "drag-count-badge";
  badge.textContent = `${count}개 항목`;
  document.body.appendChild(badge);
  dataTransfer.setDragImage(badge, -8, -8);
  // 드래그 이미지는 setDragImage를 부른 시점에 찍히므로 바로 지워도 된다.
  setTimeout(() => badge.remove(), 0);
}
