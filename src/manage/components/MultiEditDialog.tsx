import { useState } from "react";
import type { FolderOption } from "../types";
import { useModalDialog } from "../useModalDialog";

interface Props {
  /** 선택한 폴더 수와 북마크 수 */
  folderCount: number;
  bookmarkCount: number;
  /** 선택한 폴더들 안(하위 폴더 포함)에 있는 북마크 수. 삭제 확인에 쓴다. */
  bookmarksInFolders: number;
  /** 선택한 항목들이 지금 들어 있는 폴더 */
  currentParentId: string;
  /** 옮길 수 있는 위치 목록 (선택한 폴더 자신과 그 하위 폴더는 빠져 있어야 한다) */
  folders: FolderOption[];
  onSave: (parentId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/** 여러 항목을 선택한 채 "편집"을 누르면 뜨는 창. 저장 폴더 바꾸기와 삭제만 한꺼번에 할 수 있다. */
export default function MultiEditDialog({
  folderCount,
  bookmarkCount,
  bookmarksInFolders,
  currentParentId,
  folders,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [parentId, setParentId] = useState(currentParentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogProps = useModalDialog(onClose, saving);

  const summary = [
    folderCount > 0 && `폴더 ${folderCount}개`,
    bookmarkCount > 0 && `북마크 ${bookmarkCount}개`,
  ]
    .filter(Boolean)
    .join(", ");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(parentId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = window.confirm(
      `선택한 ${summary}를 삭제할까요?` +
        (folderCount > 0
          ? `\n\n폴더 안의 북마크 ${bookmarksInFolders}개와 하위 폴더도 모두 함께 삭제됩니다.`
          : "") +
        "\n되돌릴 수 없습니다.",
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <dialog className="edit-dialog" {...dialogProps}>
      <form onSubmit={handleSave}>
        <h2>{folderCount + bookmarkCount}개 항목 편집</h2>
        <p className="hint">
          선택한 {summary}의 저장 폴더를 한꺼번에 바꾸거나 한꺼번에 삭제합니다. 여러 항목을
          편집할 때는 제목이나 주소는 바꿀 수 없습니다.
        </p>
        <label>
          저장 폴더 (바꾸면 선택한 항목이 원래 순서대로 그 폴더로 이동)
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            disabled={saving}
            autoFocus
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
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
          <button type="submit" disabled={parentId === currentParentId || saving}>
            저장
          </button>
        </div>
      </form>
    </dialog>
  );
}
