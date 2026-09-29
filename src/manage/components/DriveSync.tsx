import { useEffect, useState } from "react";
import {
  DEFAULT_FOLDER_NAME,
  getAccountEmail,
  getDriveSettings,
  isDriveConfigured,
  setDriveSettings,
  signIn,
  signOut,
  syncAllThumbnailsToDrive,
  type DriveSettings,
} from "../../drive";

export default function DriveSync() {
  const configured = isDriveConfigured();
  const [settings, setSettings] = useState<DriveSettings | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const s = await getDriveSettings();
    setSettings(s);
    setFolderName(s.folderName);
    setEmail(s.enabled ? await getAccountEmail() : null);
  };

  useEffect(() => {
    if (!configured) return;
    refresh();
    // 서비스 워커가 폴더를 새로 만들면 folderId가 바뀌므로 반영한다.
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.driveSettings) setSettings(changes.driveSettings.newValue);
    };
    chrome.storage.local.onChanged.addListener(handleChange);
    return () => chrome.storage.local.onChanged.removeListener(handleChange);
  }, [configured]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = () =>
    run(async () => {
      await signIn();
      await refresh();
    });

  const handleSignOut = () =>
    run(async () => {
      await signOut();
      setProgress(null);
      await refresh();
    });

  const handleSaveFolder = () =>
    run(async () => {
      const name = folderName.trim() || DEFAULT_FOLDER_NAME;
      // 이름이 바뀌면 다음 업로드 때 그 이름의 폴더를 새로 찾거나 만든다.
      setSettings(await setDriveSettings({ folderName: name, folderId: undefined }));
      setFolderName(name);
    });

  const handleSyncAll = () =>
    run(async () => {
      const { uploaded, failed } = await syncAllThumbnailsToDrive((done, total) =>
        setProgress(`업로드 중... ${done}/${total}`),
      );
      setProgress(
        failed > 0
          ? `${uploaded}개 업로드, ${failed}개 실패 (콘솔 확인)`
          : `${uploaded}개 업로드 완료`,
      );
    });

  if (!configured) {
    return (
      <div>
        <h3>Google Drive 백업</h3>
        <p className="hint">
          OAuth 클라이언트 ID가 설정되지 않았습니다. <code>.env.local</code>에{" "}
          <code>GOOGLE_OAUTH_CLIENT_ID</code>를 넣고 다시 빌드하세요. (README 참고)
        </p>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="drive-sync">
      <h3>Google Drive 백업</h3>
      <p className="hint">
        북마크 스냅샷 이미지(썸네일)를 캡처할 때마다 내 Google Drive의 지정한 폴더에도
        저장합니다. 북마크 자체는 여기에 올라가지 않습니다. 이 확장은 자신이 만든 폴더와
        파일에만 접근할 수 있습니다.
      </p>

      {!settings.enabled ? (
        <button onClick={handleSignIn} disabled={busy}>
          Google 계정으로 로그인
        </button>
      ) : (
        <>
          <div className="drive-row">
            <span>
              연결된 계정: <strong>{email ?? "(확인 중)"}</strong>
            </span>
            <button onClick={handleSignOut} disabled={busy}>
              로그아웃
            </button>
          </div>
          <div className="drive-row">
            <label>
              저장 폴더 (내 드라이브 최상위)
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              onClick={handleSaveFolder}
              disabled={busy || folderName.trim() === settings.folderName}
            >
              폴더 변경
            </button>
            {settings.folderId && (
              <a
                href={`https://drive.google.com/drive/folders/${settings.folderId}`}
                target="_blank"
                rel="noreferrer"
              >
                Drive에서 열기
              </a>
            )}
          </div>
          <div className="drive-row">
            <button onClick={handleSyncAll} disabled={busy}>
              기존 썸네일 전체 업로드
            </button>
            {progress && <span className="hint">{progress}</span>}
          </div>
        </>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
