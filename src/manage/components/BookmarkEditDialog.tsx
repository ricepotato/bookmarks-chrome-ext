import { useEffect, useRef, useState } from "react";
import type { FlatBookmark } from "../types";

interface Props {
  bookmark: FlatBookmark;
  onSave: (id: string, changes: { title: string; url: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 저장된 미리보기 이미지가 있을 때만 전달된다. */
  onRemoveThumbnail?: () => Promise<void>;
  onClose: () => void;
}

export default function BookmarkEditDialog({
  bookmark,
  onSave,
  onDelete,
  onRemoveThumbnail,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = title !== bookmark.title || url !== bookmark.url;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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
      await onSave(bookmark.id, { title, url });
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
      `이 북마크의 미리보기 이미지를 삭제할까요?\n\n${bookmark.url}\n\n` +
        "같은 주소를 쓰는 다른 북마크의 이미지도 함께 사라집니다. " +
        "Google Drive에 백업된 파일은 지우지 않습니다.",
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await onRemoveThumbnail();
      setNotice("미리보기 이미지를 삭제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    // Esc로 닫을 때도 onClose가 호출되도록 cancel/close 이벤트를 받는다.
    <dialog ref={dialogRef} className="edit-dialog" onClose={onClose}>
      <form onSubmit={handleSave}>
        <h2>북마크 편집</h2>
        <p className="hint">
          폴더: {bookmark.path.length > 0 ? bookmark.path.join(" > ") : "(최상위)"}
        </p>
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
