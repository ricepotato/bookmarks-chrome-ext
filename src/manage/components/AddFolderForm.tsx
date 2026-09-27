import { useState } from "react";
import type { FolderOption } from "../types";

interface Props {
  folders: FolderOption[];
  onAdd: (params: { parentId: string; title: string }) => Promise<void>;
}

export default function AddFolderForm({ folders, onAdd }: Props) {
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState(folders[0]?.id ?? "1");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("폴더 이름을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setDone(null);
    try {
      await onAdd({ parentId, title: name });
      const where = folders.find((f) => f.id === parentId)?.label ?? "";
      setDone(`"${where}" 맨 앞에 "${name}" 폴더를 만들었습니다.`);
      setTitle("");
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
        placeholder="새 폴더 이름"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={submitting}
      />
      <select
        value={parentId}
        onChange={(e) => setParentId(e.target.value)}
        disabled={submitting}
        aria-label="만들 위치"
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
      {done && <div className="success-msg">{done}</div>}
    </form>
  );
}
