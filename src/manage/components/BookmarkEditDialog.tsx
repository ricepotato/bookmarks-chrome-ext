import { useState } from "react";
import type { FlatBookmark, FolderOption } from "../types";
import { useModalDialog } from "../useModalDialog";

interface Props {
  bookmark: FlatBookmark;
  /** 옮길 수 있는 폴더 목록 (북마크 바와 그 하위 폴더) */
  folders: FolderOption[];
  onSave: (
    id: string,
    changes: { title: string; url: string; parentId: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 저장된 스크린샷이 있을 때만 전달된다. */
  onRemoveThumbnail?: () => Promise<void>;
  onClose: () => void;
}

export default function BookmarkEditDialog({
  bookmark,
  folders,
  onSave,
  onDelete,
  onRemoveThumbnail,
  onClose,
}: Props) {
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [parentId, setParentId] = useState(bookmark.parentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty =
    title !== bookmark.title || url !== bookmark.url || parentId !== bookmark.parentId;

  const dialogProps = useModalDialog(onClose, saving);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("주소는 비워둘 수 없습니다.");
      return;
    }
    try {
      // 유효한 URL인지 미리 검증 (chrome.bookmarks.update는 실패 시 예외를 던짐)
      new URL(url);
    } catch {
      setError("올바른 URL 형식이 아닙니다. (예: https://example.com)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(bookmark.id, { title, url, parentId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = window.confirm(
      `다음 북마크를 삭제할까요?\n\n${bookmark.title}\n${bookmark.url}`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await onDelete(bookmark.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const handleRemoveThumbnail = async () => {
    if (!onRemoveThumbnail) return;
    const ok = window.confirm(
      `이 북마크의 스크린샷을 삭제할까요?\n\n${bookmark.url}\n\n` +
        "같은 주소를 쓰는 다른 북마크의 이미지도 함께 사라집니다.",
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await onRemoveThumbnail();
      setNotice("스크린샷을 삭제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog className="edit-dialog" {...dialogProps}>
      <form onSubmit={handleSave}>
        <h2>북마크 편집</h2>
        <label>
          제목
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </label>
        <label>
          주소
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={saving}
          />
        </label>
        <label>
          폴더 (바꾸면 그 폴더의 맨 끝으로 이동)
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
        {error && <div className="field-error">{error}</div>}
        {notice && <div className="success-msg">{notice}</div>}
        <div className="edit-dialog-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={handleDelete}
            disabled={saving}
          >
            삭제
          </button>
          {onRemoveThumbnail && (
            <button type="button" onClick={handleRemoveThumbnail} disabled={saving}>
              이미지 제거
            </button>
          )}
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
