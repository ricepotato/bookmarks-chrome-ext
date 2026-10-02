import { useEffect, useState } from "react";
import { PLACE_AT_TOP_KEY, getPlaceAtTop, setPlaceAtTop } from "../../bookmarkSettings";

export default function PlaceAtTopSetting() {
  const [atTop, setAtTop] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlaceAtTop().then(setAtTop);
    // 다른 관리 페이지 탭에서 바꿔도 반영한다.
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[PLACE_AT_TOP_KEY]) setAtTop(changes[PLACE_AT_TOP_KEY].newValue === true);
    };
    chrome.storage.local.onChanged.addListener(handleChange);
    return () => chrome.storage.local.onChanged.removeListener(handleChange);
  }, []);

  const handleChange = async (checked: boolean) => {
    setError(null);
    try {
      await setPlaceAtTop(checked);
      setAtTop(checked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (atTop === null) return null;

  return (
    <div className="add-settings">
      <label className="add-setting-option">
        <input
          type="checkbox"
          checked={atTop}
          onChange={(e) => handleChange(e.target.checked)}
        />
        북마크 추가/이동 시 가장 위에 배치
      </label>
      <p className="hint">
        켜면 새로 추가한 북마크나 다른 폴더로 옮긴 북마크가 그 폴더의 맨 앞에 놓입니다. 끄면
        맨 끝에 놓입니다. 페이지 위의 "북마크에 추가" 버튼으로 추가할 때도 적용되며, 목록에서
        끌어다 놓아 원하는 자리에 넣을 때는 놓은 자리를 그대로 따릅니다.
      </p>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
