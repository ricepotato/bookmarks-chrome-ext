import { useCallback, useEffect, useState } from "react";
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
import { isDriveConfigured } from "../../drive";
import {
  hasAllUrlsAccess,
  hasDomainAccess,
  removeAllUrlsAccess,
  removeDomainAccess,
  requestAllUrlsAccess,
  requestDomainAccess,
} from "../../hostAccess";

export default function CaptureSites() {
  const [sites, setSites] = useState<CaptureSite[] | null>(null);
  const [allSites, setAllSites] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 실제로 브라우저가 이 출처에 접근을 허용했는지 (도메인별 권한, "모든 사이트" 권한)
  const [grantedDomains, setGrantedDomains] = useState<Set<string>>(new Set());
  const [allUrlsGranted, setAllUrlsGranted] = useState(false);

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

  // 실제 권한 허용 상태는 목록과 별개로 브라우저에 물어봐야 하므로, 목록이 바뀔 때마다 다시 확인한다.
  const refreshGranted = useCallback(async (current: CaptureSite[]) => {
    const [allUrls, perSite] = await Promise.all([
      hasAllUrlsAccess(),
      Promise.all(
        current.map(async (s) => [s.domain, await hasDomainAccess(s.domain)] as const),
      ),
    ]);
    setAllUrlsGranted(allUrls);
    setGrantedDomains(new Set(perSite.filter(([, ok]) => ok).map(([d]) => d)));
  }, []);

  useEffect(() => {
    if (sites) refreshGranted(sites);
  }, [sites, refreshGranted]);

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
    setError(null);
    // 권한 요청은 사용자 조작(이 제출) 중에만 브라우저가 허용해 주므로 여기서 바로 한다.
    let granted = false;
    try {
      granted = await requestDomainAccess(site);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    await save(
      [...sites, newCaptureSite(site)].sort((a, b) => a.domain.localeCompare(b.domain)),
    );
    setInput("");
    if (!granted) {
      setError(
        `"${site}"에 대한 접근을 허용하지 않아 아직 캡처되지 않습니다. 목록의 "권한 허용" 버튼으로 나중에 켤 수 있습니다.`,
      );
    }
  };

  const handleRemove = async (domain: string) => {
    if (!sites) return;
    await save(sites.filter((s) => s.domain !== domain));
    // 더 이상 목록에 없는 사이트는 접근 권한도 함께 반납한다 ("모든 사이트"가 켜져
    // 있으면 그쪽 권한이 대신 커버하므로 반납해도 캡처 동작은 바뀌지 않는다).
    await removeDomainAccess(domain);
    await refreshGranted(sites.filter((s) => s.domain !== domain));
  };

  const handleAllSitesChange = async (checked: boolean) => {
    setError(null);
    try {
      if (checked) {
        const granted = await requestAllUrlsAccess();
        if (!granted) {
          setError("권한을 허용하지 않아 모든 사이트 캡처를 켤 수 없습니다.");
          return;
        }
      } else {
        await removeAllUrlsAccess();
      }
      await setCaptureAllSites(checked);
      setAllSites(checked);
      if (sites) await refreshGranted(sites);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleGrantDomain = async (domain: string) => {
    setError(null);
    try {
      const granted = await requestDomainAccess(domain);
      if (!granted) setError(`"${domain}"에 대한 접근을 허용하지 않았습니다.`);
      if (sites) await refreshGranted(sites);
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
        스크린샷 설정 <span className="count">({sites.length})</span>
      </h2>
      <p className="hint">
        이 목록에 있는 도메인(하위 도메인 포함)의 북마크만 방문할 때 화면을 캡처해 썸네일로
        저장합니다. 목록에 없는 사이트는 캡처하지 않습니다. "추가 버튼 표시"를 켜면 그
        사이트를 보고 있을 때 화면 모서리에 "북마크에 추가" 버튼이 나타나고, 누르면 저장할
        폴더를 골라 현재 페이지를 추가할 수 있습니다.
      </p>

      <div className="storage-note">
        <strong>사이트별로 접근 권한을 따로 허용합니다</strong>
        <ul>
          <li>
            도메인을 추가하거나 "모든 사이트"를 켤 때, Chrome이 그 사이트에 대한 접근 허용
            여부를 따로 묻습니다. 허용해야 그 사이트에서 캡처와 "북마크에 추가" 버튼이
            동작합니다.
          </li>
          <li>
            권한을 허용하지 않았거나 나중에 취소한 사이트는 목록에 <b>"권한 필요"</b>로
            표시되며, 옆의 <b>권한 허용</b> 버튼으로 언제든 다시 허용할 수 있습니다.
          </li>
          <li>
            이렇게 사이트 단위로만 접근을 허용하므로, 이 확장이 목록에 없는 사이트의 화면을
            들여다보는 일은 없습니다.
          </li>
        </ul>
      </div>

      <div className="storage-note">
        <strong>캡처는 언제 되나요?</strong>
        <ul>
          <li>
            <b>북마크에 있는 주소를 열었을 때만</b> 자동으로 캡처합니다. (북마크 바와 그 하위
            폴더 기준. 기타 북마크·모바일 북마크는 제외) 북마크에 없는 사이트는 처음 들어간
            사이트든 전에 가 본 사이트든 캡처하지 않습니다.
          </li>
          <li>
            주소는 페이지 단위로 일치해야 합니다. <code>example.com</code>이 북마크되어 있어도{" "}
            <code>example.com/news</code>는 캡처하지 않습니다. 북마크 주소가 다른 주소로
            이동(리다이렉트)되는 경우에는 최종 화면을 그 북마크의 이미지로 저장합니다.
          </li>
          <li>
            그 사이트가 아래 목록에 있거나 "모든 사이트"가 켜져 있어야 합니다. (그리고 위의
            접근 권한도 허용되어 있어야 합니다.)
          </li>
          <li>
            페이지 로딩이 끝나고 약 1초 뒤, 탭이 화면에 보일 때 찍습니다. 뒤에서 열린 탭은 그
            탭으로 전환할 때 찍고, 1시간 안에 찍은 이미지가 있으면 다시 찍지 않습니다. 한 번
            찍은 뒤 같은 탭에서 사이트 안을 돌아다녀도 이미지를 덮어쓰지 않습니다.
          </li>
          <li>
            페이지 위의 <b>"북마크에 추가"</b> 버튼으로 북마크를 추가하면 그 순간의 화면을
            캡처합니다. 처음 들어간 사이트도 이 방법으로 캡처할 수 있습니다. 이미 북마크된
            페이지는 <b>"캡처"</b> 버튼으로 언제든 다시 찍을 수 있습니다.
          </li>
        </ul>
      </div>

      <div className="storage-note">
        <strong>스크린샷은 어디에 저장되나요?</strong>
        <ul>
          <li>
            캡처한 이미지는 외부 서버로 전송되지 않으며, <b>이 기기의 현재 Chrome 프로필</b>에만
            저장됩니다. 같은 계정이라도 다른 기기나 다른 프로필과는 동기화되지 않습니다.
          </li>
          <li>
            저장 위치는 Chrome 프로필 폴더 안의 이 확장 전용 데이터베이스(IndexedDB)입니다.
            <br />
            예) Windows:{" "}
            <code>
              %LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_
              {chrome.runtime.id}_0.indexeddb.leveldb
            </code>
            <br />
            (다른 프로필을 쓰면 <code>Default</code> 대신 <code>Profile 1</code> 같은 폴더명)
          </li>
          <li>
            확장을 삭제하면 저장된 이미지도 함께 지워집니다. 옮기거나 보관하려면 "백업" 메뉴의
            ZIP 내보내기를 쓰세요.
            {isDriveConfigured() &&
              " 백업 메뉴에서 Google Drive 백업을 직접 켠 경우에만 내 Drive로 업로드됩니다."}
          </li>
        </ul>
      </div>

      <label className="capture-all-sites">
        <input
          type="checkbox"
          checked={allSites}
          onChange={(e) => handleAllSitesChange(e.target.checked)}
        />
        모든 사이트
      </label>
      <p className="hint">
        켜면 Chrome이 모든 사이트에 대한 접근 허용을 먼저 묻고, 허용하면 목록에 없는
        사이트(북마크에 추가된 상태여야 합니다. 북마크에 현재 사이트가 추가되지 않았다면
        캡쳐가 동작하지 않습니다.)도 모두 캡처하며, 그 사이트들에는 {allSitesPositionLabel}에
        버튼이 나타납니다. 아래 목록에 등록한 사이트는 각자의 설정(버튼 표시 여부와 위치)을
        그대로 따릅니다.
      </p>
      {allSites && !allUrlsGranted && (
        <p className="field-error">
          "모든 사이트"가 켜져 있지만 접근 권한이 없어 동작하지 않습니다.{" "}
          <button type="button" onClick={() => handleAllSitesChange(true)}>
            권한 허용
          </button>
        </p>
      )}

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
          {sites.map((site) => {
            const granted = allUrlsGranted || grantedDomains.has(site.domain);
            return (
              <li key={site.domain}>
                <span className="capture-site-domain">
                  {site.domain}
                  {!granted && <span className="capture-site-permission">권한 필요</span>}
                </span>
                {!granted && (
                  <button type="button" onClick={() => handleGrantDomain(site.domain)}>
                    권한 허용
                  </button>
                )}
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
            );
          })}
        </ul>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
