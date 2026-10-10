import { useMemo, useState } from "react";
import type { FlatBookmark } from "../types";
import { getHostname, matchesDomain, replaceHostname } from "../bookmarks";

export interface BulkApplyResult {
  /** 새 주소로 옮긴 썸네일 수 */
  thumbnails: number;
}

interface Props {
  bookmarks: FlatBookmark[];
  onApply: (changes: { id: string; url: string }[]) => Promise<BulkApplyResult>;
}

export default function BulkDomainEditor({ bookmarks, onApply }: Props) {
  const [findDomain, setFindDomain] = useState("");
  const [replaceDomain, setReplaceDomain] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const matches = useMemo(() => {
    const find = findDomain.trim();
    if (!find) return [];
    return bookmarks.filter((b) => {
      const host = getHostname(b.url);
      return host !== null && matchesDomain(host, find, includeSubdomains);
    });
  }, [bookmarks, findDomain, includeSubdomains]);

  const canApply =
    findDomain.trim().length > 0 &&
    replaceDomain.trim().length > 0 &&
    matches.length > 0 &&
    !applying;

  const handleApply = async () => {
    setError(null);
    setDone(null);
    const target = replaceDomain.trim();
    const changes: { id: string; url: string }[] = [];
    try {
      for (const b of matches) {
        changes.push({ id: b.id, url: replaceHostname(b.url, target) });
      }
    } catch {
      setError(
        "바꿀 도메인 형식이 올바르지 않습니다. (예: new.example.com, 스키마/경로 제외)",
      );
      return;
    }

    const ok = window.confirm(
      `"${findDomain.trim()}" → "${target}"\n\n${changes.length}개 북마크의 주소를 변경합니다. 계속할까요?`,
    );
    if (!ok) return;

    setApplying(true);
    try {
      const result = await onApply(changes);
      let message = `${changes.length}개 북마크를 수정했습니다.`;
      if (result.thumbnails > 0) {
        message += ` 캡처 이미지 ${result.thumbnails}개도 새 주소로 옮겼습니다.`;
      }
      setDone(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bulk-editor">
      <h2>도메인 일괄 수정</h2>
      <p className="hint">
        북마크 바(하위 폴더 포함) 안에서 특정 도메인을 가진 북마크의 주소를 한 번에
        바꿉니다. 경로/쿼리는 그대로 유지되고 호스트(도메인) 부분만 바뀝니다. 연결된
        캡처 이미지도 바뀐 주소로 함께 옮깁니다.
      </p>
      <div className="bulk-editor-fields">
        <label>
          찾을 도메인
          <input
            type="text"
            placeholder="old.example.com"
            value={findDomain}
            onChange={(e) => setFindDomain(e.target.value)}
          />
        </label>
        <label>
          바꿀 도메인
          <input
            type="text"
            placeholder="new.example.com"
            value={replaceDomain}
            onChange={(e) => setReplaceDomain(e.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeSubdomains}
            onChange={(e) => setIncludeSubdomains(e.target.checked)}
          />
          하위 도메인 포함 (예: www.old.example.com)
        </label>
      </div>

      {findDomain.trim() && (
        <div className="bulk-preview">
          <strong>{matches.length}개</strong> 북마크가 영향을 받습니다.
          {matches.length > 0 && (
            <ul>
              {matches.slice(0, 8).map((b) => (
                <li key={b.id}>
                  <span className="preview-title">{b.title}</span>
                  <span className="preview-url">{b.url}</span>
                </li>
              ))}
              {matches.length > 8 && <li>... 외 {matches.length - 8}개</li>}
            </ul>
          )}
        </div>
      )}

      <button onClick={handleApply} disabled={!canApply}>
        일괄 적용
      </button>
      {error && <div className="field-error">{error}</div>}
      {done !== null && <div className="success-msg">{done}</div>}
    </div>
  );
}
