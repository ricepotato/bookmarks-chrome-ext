import { useEffect, useMemo, useState } from "react";
import type { FlatBookmark } from "../types";
import { findDuplicateGroups } from "../bookmarks";

interface Props {
  bookmarks: FlatBookmark[];
  onDelete: (ids: string[]) => Promise<void>;
}

/** 각 그룹에서 가장 오래된 1개만 남기고 나머지를 선택한 상태를 만든다. */
function defaultSelection(groups: FlatBookmark[][]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const b of g.slice(1)) ids.add(b.id);
  }
  return ids;
}

function formatDate(ms?: number): string {
  return ms ? new Date(ms).toLocaleString() : "-";
}

export default function DuplicateFinder({ bookmarks, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const groups = useMemo(() => findDuplicateGroups(bookmarks), [bookmarks]);

  // 목록이 바뀌어 사라진 북마크는 선택에서 제외한다.
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(bookmarks.map((b) => b.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [bookmarks]);

  const handleOpen = () => {
    setSelected(defaultSelection(groups));
    setError(null);
    setDone(null);
    setOpen(true);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fullySelectedGroups = groups.filter((g) =>
    g.every((b) => selected.has(b.id)),
  ).length;

  const handleDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    let message = `선택한 ${ids.length}개 북마크를 삭제할까요?`;
    if (fullySelectedGroups > 0) {
      message += `\n\n주의: ${fullySelectedGroups}개 주소는 모든 사본이 선택되어 완전히 삭제됩니다.`;
    }
    if (!window.confirm(message)) return;

    setDeleting(true);
    setError(null);
    setDone(null);
    try {
      await onDelete(ids);
      setSelected(new Set());
      setDone(ids.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dedup">
      <div className="list-header">
        <h2>중복 제거</h2>
        {open ? (
          <button onClick={() => setOpen(false)}>닫기</button>
        ) : (
          <button onClick={handleOpen}>중복 제거</button>
        )}
      </div>
      <p className="hint">
        같은 주소(스킴/도메인 대소문자, 끝의 "/" 차이는 무시)를 가진 북마크를 찾습니다.
        기본으로 각 주소에서 가장 먼저 추가된 1개만 남기고 나머지가 선택됩니다.
      </p>

      {open && (
        <>
          {groups.length === 0 ? (
            <p className="empty">중복된 북마크가 없습니다.</p>
          ) : (
            <>
              <div className="dedup-toolbar">
                <span>
                  중복 주소 <strong>{groups.length}개</strong>, 선택{" "}
                  <strong>{selected.size}개</strong>
                </span>
                <button
                  onClick={() => setSelected(defaultSelection(groups))}
                  disabled={deleting}
                >
                  1개씩 남기고 선택
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={deleting}
                >
                  선택 해제
                </button>
                <button
                  className="btn-danger"
                  onClick={handleDelete}
                  disabled={deleting || selected.size === 0}
                >
                  선택 삭제
                </button>
              </div>

              <div className="dedup-groups">
                {groups.map((g) => {
                  const allSelected = g.every((b) => selected.has(b.id));
                  return (
                    <div className="dedup-group" key={g[0].id}>
                      <div className="dedup-group-url" title={g[0].url}>
                        {g[0].url} <span className="count">({g.length}개)</span>
                        {allSelected && (
                          <span className="field-error">
                            {" "}
                            모든 사본이 선택됨
                          </span>
                        )}
                      </div>
                      <ul>
                        {g.map((b) => (
                          <li key={b.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selected.has(b.id)}
                                onChange={() => toggle(b.id)}
                                disabled={deleting}
                              />
                              <span className="preview-title" title={b.title}>
                                {b.title || "(제목 없음)"}
                              </span>
                              <span className="dedup-path">
                                {b.path.length > 0 ? b.path.join(" > ") : "(최상위)"}
                              </span>
                              <span className="dedup-date">
                                {formatDate(b.dateAdded)}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {error && <div className="field-error">{error}</div>}
          {done !== null && (
            <div className="success-msg">{done}개 북마크를 삭제했습니다.</div>
          )}
        </>
      )}
    </div>
  );
}
