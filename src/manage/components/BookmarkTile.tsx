import type { FlatBookmark } from "../types";
import { getHostname } from "../bookmarks";

interface Props {
  bookmark: FlatBookmark;
  /** 검색 결과처럼 여러 폴더의 북마크가 섞여 있을 때 폴더 경로를 함께 표시한다. */
  showPath?: boolean;
  onEdit: (bookmark: FlatBookmark) => void;
}

export default function BookmarkTile({ bookmark, showPath, onEdit }: Props) {
  const host = getHostname(bookmark.url) ?? bookmark.url;
  const label = bookmark.title || host;

  const handleOpen = (e: React.MouseEvent) => {
    // chrome:// 등 일반 링크로 열 수 없는 주소도 열 수 있도록 tabs API를 사용한다.
    e.preventDefault();
    chrome.tabs.create({ url: bookmark.url });
  };

  return (
    <div className="tile">
      <a
        className="tile-link"
        href={bookmark.url}
        onClick={handleOpen}
        title={`${label}\n${bookmark.url}`}
      >
        {/* 썸네일 자리: 이미지가 준비되면 이 영역에 <img>를 넣는다. */}
        <div className="tile-thumb">
          <span className="tile-thumb-letter">
            {label.trim().charAt(0).toUpperCase() || "?"}
          </span>
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
        onClick={() => onEdit(bookmark)}
        title="편집"
        aria-label={`${label} 편집`}
      >
        편집
      </button>
    </div>
  );
}
