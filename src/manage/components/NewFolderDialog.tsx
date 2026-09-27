import { useState } from "react";
import { useModalDialog } from "../useModalDialog";

interface Props {
  /** 폴더를 만들 위치의 표시용 경로 (예: "북마크 바 > 개발") */
  locationLabel: string;
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
}

/** 북마크 목록에서 지금 보고 있는 폴더에 새 폴더를 만드는 팝업 */
export default function NewFolderDialog({ locationLabel, onCreate, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogProps = useModalDialog(onClose, saving);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("폴더 이름을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <dialog className="edit-dialog" {...dialogProps}>
      <form onSubmit={handleSubmit}>
        <h2>새 폴더</h2>
        <p className="hint">{locationLabel}의 맨 앞에 만들어집니다.</p>
        <label>
          폴더 이름
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </label>
        {error && <div className="field-error">{error}</div>}
        <div className="edit-dialog-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" disabled={saving || !title.trim()}>
            추가
          </button>
        </div>
      </form>
    </dialog>
  );
}
