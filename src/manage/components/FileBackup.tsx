import { useRef, useState } from "react";
import {
  exportFileName,
  exportThumbnailsZip,
  importThumbnailsZip,
} from "../../thumbnailBackup";

export default function FileBackup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      setMessage(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () =>
    run(async () => {
      const { blob, count } = await exportThumbnailsZip();
      if (count === 0) return "내보낼 스크린샷이 없습니다.";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName();
      a.click();
      // 다운로드가 시작될 시간을 준 뒤 해제한다.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return `이미지 ${count}개를 ${a.download} 파일로 내보냈습니다.`;
    });

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 change 이벤트가 오도록 비운다.
    e.target.value = "";
    if (!file) return;
    run(async () => {
      const { added, replaced, skipped } = await importThumbnailsZip(file);
      const parts = [`새로 추가 ${added}개`, `교체 ${replaced}개`];
      if (skipped > 0) parts.push(`건너뜀 ${skipped}개 (이미 같거나 더 최근 이미지가 있음)`);
      return `가져오기 완료: ${parts.join(", ")}`;
    });
  };

  return (
    <div className="file-backup">
      <h3>파일로 백업</h3>
      <p className="hint">
        저장된 스크린샷(북마크 스냅샷 이미지)을 ZIP 파일 하나로 내보내고, 나중에 그 파일에서
        다시 가져올 수 있습니다. 북마크 자체는 포함되지 않습니다. 로그인이 필요 없고, 다른
        PC나 Chrome 프로필로 옮길 때도 쓸 수 있습니다. 가져올 때 같은 주소의 이미지가 이미
        있으면 더 최근에 찍은 쪽을 남깁니다.
      </p>
      <div className="form-row">
        <button onClick={handleExport} disabled={busy}>
          ZIP으로 내보내기
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
          ZIP에서 가져오기
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={handleImport}
        />
        {busy && <span className="hint">처리 중...</span>}
      </div>
      {message && <div className="success-msg">{message}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
