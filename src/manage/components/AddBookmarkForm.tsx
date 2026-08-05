import { useState } from "react";
import type { FolderOption } from "../types";

interface Props {
  folders: FolderOption[];
  onAdd: (params: { parentId: string; title: string; url: string }) => Promise<void>;
}

export default function AddBookmarkForm({ folders, onAdd }: Props) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [parentId, setParentId] = useState(folders[0]?.id ?? "1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("주소를 입력해 주세요.");
      return;
    }
    try {
      new URL(url);
    } catch {
      setError("올바른 URL 형식이 아닙니다. (예: https://example.com)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ parentId, title: title.trim() || url, url });
      setTitle("");
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="제목 (비워두면 주소가 사용됩니다)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={submitting}
      />
      <input
        type="text"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={submitting}
      />
      <select
        value={parentId}
        onChange={(e) => setParentId(e.target.value)}
        disabled={submitting}
      >
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={submitting}>
        추가
      </button>
      {error && <div className="field-error">{error}</div>}
    </form>
  );
}
