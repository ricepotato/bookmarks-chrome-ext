import { useEffect, useState } from "react";
import type { FlatBookmark } from "../types";

interface Props {
  bookmark: FlatBookmark;
  onSave: (id: string, changes: { title: string; url: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function BookmarkRow({ bookmark, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title !== bookmark.title || url !== bookmark.url;

  // 외부(다른 탭, 일괄 도메인 수정 등)에서 이 북마크가 바뀐 경우, 편집 중이 아니라면 반영한다.
  useEffect(() => {
    if (!dirty) {
      setTitle(bookmark.title);
      setUrl(bookmark.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmark.title, bookmark.url]);

  const handleSave = async () => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleGo = () => {
    try {
      new URL(url);
    } catch {
      setError("올바른 URL 형식이 아닙니다. (예: https://example.com)");
      return;
    }
    setError(null);
    chrome.tabs.create({ url });
  };

  const handleReset = () => {
    setTitle(bookmark.title);
    setUrl(bookmark.url);
    setError(null);
  };

  const handleDelete = async () => {
    const ok = window.confirm(
      `다음 북마크를 삭제할까요?\n\n${bookmark.title}\n${bookmark.url}`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await onDelete(bookmark.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className={dirty ? "row-dirty" : undefined}>
      <td className="col-path" title={bookmark.path.join(" > ") || "(최상위)"}>
        {bookmark.path.length > 0 ? bookmark.path.join(" > ") : "-"}
      </td>
      <td className="col-title">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
        />
      </td>
      <td className="col-url">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={saving}
        />
        {error && <div className="field-error">{error}</div>}
      </td>
      <td className="col-actions">
        <button onClick={handleGo} disabled={saving || !url.trim()}>
          이동
        </button>
        <button onClick={handleSave} disabled={!dirty || saving}>
          저장
        </button>
        <button onClick={handleReset} disabled={!dirty || saving}>
          취소
        </button>
        <button className="btn-danger" onClick={handleDelete} disabled={saving}>
          삭제
        </button>
      </td>
    </tr>
  );
}
