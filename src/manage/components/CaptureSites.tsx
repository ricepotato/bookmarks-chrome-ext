import { useEffect, useState } from "react";
import {
  CAPTURE_SITES_KEY,
  getCaptureSites,
  normalizeSiteInput,
  setCaptureSites,
} from "../../captureSites";

export default function CaptureSites() {
  const [sites, setSites] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCaptureSites().then(setSites);
    // 다른 관리 페이지 탭에서 목록을 바꿔도 반영한다.
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[CAPTURE_SITES_KEY]) {
        setSites(changes[CAPTURE_SITES_KEY].newValue ?? []);
      }
    };
    chrome.storage.local.onChanged.addListener(handleChange);
    return () => chrome.storage.local.onChanged.removeListener(handleChange);
  }, []);

  const save = async (next: string[]) => {
    setError(null);
    try {
      await setCaptureSites(next);
      setSites(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sites) return;
    const site = normalizeSiteInput(input);
    if (!site) {
      setError(`올바르지 않은 도메인 형식입니다: "${input.trim()}"`);
      return;
    }
    if (sites.includes(site)) {
      setError(`이미 목록에 있습니다: ${site}`);
      return;
    }
    await save([...sites, site].sort());
    setInput("");
  };

  const handleRemove = (site: string) => {
    if (!sites) return;
    save(sites.filter((s) => s !== site));
  };

  if (!sites) return null;

  return (
    <div className="capture-sites">
      <h2>
        화면 캡처 대상 사이트 <span className="count">({sites.length})</span>
      </h2>
      <p className="hint">
        이 목록에 있는 도메인(하위 도메인 포함)의 북마크만 방문할 때 화면을 캡처해 썸네일로
        저장합니다. 목록에 없는 사이트는 캡처하지 않습니다.
      </p>

      <form className="drive-row" onSubmit={handleAdd}>
        <label>
          도메인 또는 주소
          <input
            type="text"
            placeholder="example.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!input.trim()}>
          추가
        </button>
      </form>

      {sites.length === 0 ? (
        <p className="hint">등록된 사이트가 없어 현재 어떤 사이트도 캡처하지 않습니다.</p>
      ) : (
        <ul className="capture-site-list">
          {sites.map((site) => (
            <li key={site}>
              <span>{site}</span>
              <button onClick={() => handleRemove(site)}>삭제</button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
