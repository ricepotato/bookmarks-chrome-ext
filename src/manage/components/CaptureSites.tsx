import { useEffect, useState } from "react";
import {
  ALL_SITES_BUTTON_POSITION,
  BUTTON_POSITIONS,
  CAPTURE_ALL_SITES_KEY,
  CAPTURE_SITES_KEY,
  getCaptureAllSites,
  getCaptureSites,
  newCaptureSite,
  normalizeSiteInput,
  parseCaptureSites,
  setCaptureAllSites,
  setCaptureSites,
  type ButtonPosition,
  type CaptureSite,
} from "../../captureSites";

export default function CaptureSites() {
  const [sites, setSites] = useState<CaptureSite[] | null>(null);
  const [allSites, setAllSites] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCaptureSites().then(setSites);
    getCaptureAllSites().then(setAllSites);
    // 다른 관리 페이지 탭에서 목록을 바꿔도 반영한다.
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[CAPTURE_SITES_KEY]) {
        setSites(parseCaptureSites(changes[CAPTURE_SITES_KEY].newValue));
      }
      if (changes[CAPTURE_ALL_SITES_KEY]) {
        setAllSites(changes[CAPTURE_ALL_SITES_KEY].newValue === true);
      }
    };
    chrome.storage.local.onChanged.addListener(handleChange);
    return () => chrome.storage.local.onChanged.removeListener(handleChange);
  }, []);

  const save = async (next: CaptureSite[]) => {
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
    if (sites.some((s) => s.domain === site)) {
      setError(`이미 목록에 있습니다: ${site}`);
      return;
    }
    await save(
      [...sites, newCaptureSite(site)].sort((a, b) => a.domain.localeCompare(b.domain)),
    );
    setInput("");
  };

  const handleRemove = (domain: string) => {
    if (!sites) return;
    save(sites.filter((s) => s.domain !== domain));
  };

  const handleAllSitesChange = async (checked: boolean) => {
    setError(null);
    try {
      await setCaptureAllSites(checked);
      setAllSites(checked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const allSitesPositionLabel = BUTTON_POSITIONS.find(
    (p) => p.value === ALL_SITES_BUTTON_POSITION,
  )?.label;

  const handleUpdate = (domain: string, changes: Partial<CaptureSite>) => {
    if (!sites) return;
    save(sites.map((s) => (s.domain === domain ? { ...s, ...changes } : s)));
  };

  if (!sites) return null;

  return (
    <div className="capture-sites">
      <h2>
        미리보기 설정 <span className="count">({sites.length})</span>
      </h2>
      <p className="hint">
        이 목록에 있는 도메인(하위 도메인 포함)의 북마크만 방문할 때 화면을 캡처해 썸네일로
        저장합니다. 목록에 없는 사이트는 캡처하지 않습니다. "추가 버튼 표시"를 켜면 그
        사이트를 보고 있을 때 화면 모서리에 "즐겨찾기에 추가" 버튼이 나타나고, 누르면 저장할
        폴더를 골라 현재 페이지를 추가할 수 있습니다.
      </p>

      <label className="capture-all-sites">
        <input
          type="checkbox"
          checked={allSites}
          onChange={(e) => handleAllSitesChange(e.target.checked)}
        />
        모든 사이트
      </label>
      <p className="hint">
        켜면 목록에 없는 사이트도 모두 캡처하고, 그 사이트들에는 {allSitesPositionLabel}에
        버튼이 나타납니다. 아래 목록에 등록한 사이트는 각자의 설정(버튼 표시 여부와 위치)을
        그대로 따릅니다.
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
        <p className="hint">
          {allSites
            ? "등록된 사이트가 없습니다. 모든 사이트를 캡처합니다."
            : "등록된 사이트가 없어 현재 어떤 사이트도 캡처하지 않습니다."}
        </p>
      ) : (
        <ul className="capture-site-list">
          {sites.map((site) => (
            <li key={site.domain}>
              <span className="capture-site-domain">{site.domain}</span>
              <label className="capture-site-option">
                <input
                  type="checkbox"
                  checked={site.showAddButton}
                  onChange={(e) =>
                    handleUpdate(site.domain, { showAddButton: e.target.checked })
                  }
                />
                추가 버튼 표시
              </label>
              <select
                value={site.buttonPosition}
                disabled={!site.showAddButton}
                aria-label="버튼 위치"
                onChange={(e) =>
                  handleUpdate(site.domain, {
                    buttonPosition: e.target.value as ButtonPosition,
                  })
                }
              >
                {BUTTON_POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button onClick={() => handleRemove(site.domain)}>삭제</button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
