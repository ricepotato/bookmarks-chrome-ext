import { useState } from "react";
import type { BookmarkFolder, FolderOption } from "../types";
import { useModalDialog } from "../useModalDialog";

interface Props {
  folder: BookmarkFolder;
  /** 옮길 수 있는 위치 목록 (이 폴더 자신과 그 하위 폴더는 빠져 있어야 한다) */
  folders: FolderOption[];
  /** 이 폴더 안(하위 폴더 포함)의 북마크 수와 하위 폴더 수. 삭제 확인에 쓴다. */
  bookmarkCount: number;
  subfolderCount: number;
  onSave: (id: string, changes: { title: string; parentId: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function FolderEditDialog({
  folder,
  folders,
  bookmarkCount,
  subfolderCount,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [title, setTitle] = useState(folder.title);
  const [parentId, setParentId] = useState(folder.parentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogProps = useModalDialog(onClose, saving);

  const dirty = title !== folder.title || parentId !== folder.parentId;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("폴더 이름은 비워둘 수 없습니다.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(folder.id, { title: title.trim(), parentId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const contents =
      bookmarkCount > 0 || subfolderCount > 0
        ? `\n\n안에 있는 북마크 ${bookmarkCount}개` +
          (subfolderCount > 0 ? `와 하위 폴더 ${subfolderCount}개` : "") +
          "도 모두 함께 삭제되며 되돌릴 수 없습니다."
        : "";
    const ok = window.confirm(
      `"${folder.title || "(이름 없음)"}" 폴더를 삭제할까요?${contents}`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await onDelete(folder.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <dialog className="edit-dialog" {...dialogProps}>
      <form onSubmit={handleSave}>
        <h2>폴더 편집</h2>
        <label>
          이름
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </label>
        <label>
          위치 (바꾸면 그 폴더의 맨 끝으로 이동)
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            disabled={saving}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          안에 있는 북마크 {bookmarkCount}개, 하위 폴더 {subfolderCount}개
        </p>
        {error && <div className="field-error">{error}</div>}
        <div className="edit-dialog-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={handleDelete}
            disabled={saving}
          >
            삭제
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" disabled={!dirty || saving}>
            저장
          </button>
        </div>
      </form>
    </dialog>
  );
}
