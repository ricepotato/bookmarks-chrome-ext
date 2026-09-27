import { useEffect, useRef, useState } from "react";
import type { FlatBookmark } from "../types";
import { getHostname } from "../bookmarks";
import ThumbnailPreview from "./ThumbnailPreview";

interface Props {
  bookmark: FlatBookmark;
  /** 저장된 사이트 스크린샷의 object URL (없으면 첫 글자로 대신 표시) */
  thumbnailUrl?: string;
  /** 검색 결과처럼 여러 폴더의 북마크가 섞여 있을 때 폴더 경로를 함께 표시한다. */
  showPath?: boolean;
  onEdit: (bookmark: FlatBookmark) => void;
}

/** 마우스를 잠깐 올려두었을 때만 크게 보여주기 위한 지연 시간 */
const PREVIEW_DELAY_MS = 1000;

/**
 * 지금 떠 있는 확대 미리보기를 닫는 함수. 확대 이미지는 한 번에 하나만 보이도록,
 * 다른 타일에 마우스를 올리는 즉시 기존 미리보기를 닫는 데 쓴다.
 */
let closeActivePreview: (() => void) | null = null;

export default function BookmarkTile({
  bookmark,
  thumbnailUrl,
  showPath,
  onEdit,
}: Props) {
  const host = getHostname(bookmark.url) ?? bookmark.url;
  const label = bookmark.title || host;

  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const hidePreview = () => {
    window.clearTimeout(timerRef.current);
    setPreviewAnchor(null);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    // 다른 타일의 확대 이미지가 남아 있으면 (이 타일에 썸네일이 없더라도) 바로 닫는다.
    closeActivePreview?.();
    closeActivePreview = null;
    if (!thumbnailUrl) return;
    const tile = e.currentTarget;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      closeActivePreview?.();
      closeActivePreview = hidePreview;
      setPreviewAnchor(tile.getBoundingClientRect());
    }, PREVIEW_DELAY_MS);
  };

  // 스크롤하면 미리보기 위치가 타일과 어긋나므로 닫는다.
  useEffect(() => {
    if (!previewAnchor) return;
    window.addEventListener("scroll", hidePreview, true);
    return () => window.removeEventListener("scroll", hidePreview, true);
  }, [previewAnchor]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const handleOpen = (e: React.MouseEvent) => {
    // chrome:// 등 일반 링크로 열 수 없는 주소도 열 수 있도록 tabs API를 사용한다.
    e.preventDefault();
    hidePreview();
    chrome.tabs.create({ url: bookmark.url });
  };

  return (
    <div className="tile" onMouseEnter={handleMouseEnter} onMouseLeave={hidePreview}>
      <a
        className="tile-link"
        href={bookmark.url}
        onClick={handleOpen}
        // 캡처 이미지가 있으면 툴팁 대신 미리보기 이미지 아래에 같은 내용을 보여준다.
        title={thumbnailUrl ? undefined : `${label}\n${bookmark.url}`}
      >
        <div className="tile-thumb">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <span className="tile-thumb-letter">
              {label.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </div>
        <div className="tile-body">
          <div className="tile-title">{label}</div>
          <div className="tile-sub">{host}</div>
          {showPath && (
            <div className="tile-sub">
              {bookmark.path.length > 0 ? bookmark.path.join(" > ") : "(최상위)"}
            </div>
          )}
        </div>
      </a>
      <button
        className="tile-edit"
        onClick={() => {
          hidePreview();
          onEdit(bookmark);
        }}
        title="편집"
        aria-label={`${label} 편집`}
      >
        편집
      </button>
      {previewAnchor && thumbnailUrl && (
        <ThumbnailPreview
          src={thumbnailUrl}
          anchor={previewAnchor}
          title={label}
          url={bookmark.url}
        />
      )}
    </div>
  );
}
