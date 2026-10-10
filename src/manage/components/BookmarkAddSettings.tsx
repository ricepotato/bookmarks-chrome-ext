import { useEffect, useState } from "react";
import {
  ASK_FOLDER_ON_IMAGE_MENU_KEY,
  PLACE_AT_TOP_KEY,
  getAskFolderOnImageMenu,
  getPlaceAtTop,
  setAskFolderOnImageMenu,
  setPlaceAtTop,
} from "../../bookmarkSettings";

/** "북마크 추가" 메뉴의 설정 체크박스들 */
export default function BookmarkAddSettings() {
  const [atTop, setAtTop] = useState<boolean | null>(null);
  const [askFolder, setAskFolder] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlaceAtTop().then(setAtTop);
    getAskFolderOnImageMenu().then(setAskFolder);
    // 다른 관리 페이지 탭에서 바꿔도 반영한다.
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[PLACE_AT_TOP_KEY]) setAtTop(changes[PLACE_AT_TOP_KEY].newValue === true);
      if (changes[ASK_FOLDER_ON_IMAGE_MENU_KEY]) {
        setAskFolder(changes[ASK_FOLDER_ON_IMAGE_MENU_KEY].newValue === true);
      }
    };
    chrome.storage.local.onChanged.addListener(handleChange);
    return () => chrome.storage.local.onChanged.removeListener(handleChange);
  }, []);

  const save = async (
    store: (v: boolean) => Promise<void>,
    apply: (v: boolean) => void,
    checked: boolean,
  ) => {
    setError(null);
    try {
      await store(checked);
      apply(checked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (atTop === null || askFolder === null) return null;

  return (
    <div className="add-settings">
      <label className="add-setting-option">
        <input
          type="checkbox"
          checked={atTop}
          onChange={(e) => save(setPlaceAtTop, setAtTop, e.target.checked)}
        />
        북마크 추가/이동 시 가장 위에 배치
      </label>
      <p className="hint">
        켜면 새로 추가한 북마크나 다른 폴더로 옮긴 북마크가 그 폴더의 맨 앞에 놓입니다. 끄면
        맨 끝에 놓입니다. 페이지 위의 "북마크에 추가" 버튼으로 추가할 때도 적용되며, 목록에서
        끌어다 놓아 원하는 자리에 넣을 때는 놓은 자리를 그대로 따릅니다.
      </p>

      <label className="add-setting-option">
        <input
          type="checkbox"
          checked={askFolder}
          onChange={(e) => save(setAskFolderOnImageMenu, setAskFolder, e.target.checked)}
        />
        "북마크 캡쳐 이미지로 사용" 시 추가할 위치 선택
      </label>
      <p className="hint">
        사이트에서 이미지를 우클릭해 "북마크 캡쳐 이미지로 사용"을 눌렀을 때 그 페이지가 아직
        북마크에 없으면 북마크로 추가합니다. 켜면 페이지 위에 창을 띄워 저장할 폴더(와 제목)를
        묻고, 끄면 북마크 바 최상위에 바로 추가합니다. 이미 북마크된 페이지는 묻지 않고 캡처
        이미지만 바꿉니다.
      </p>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
