import { createPortal } from "react-dom";

interface Props {
  src: string;
  /** 미리보기를 띄울 기준이 되는 타일의 화면상 위치 */
  anchor: DOMRect;
  /** 이미지 아래에 표시할 북마크 제목과 주소 (타일의 툴팁 대신) */
  title: string;
  url: string;
}

const WIDTH = 560;
const HEIGHT = 350; // 16:10
/** 이미지 아래 제목/주소 영역의 높이 */
const CAPTION_HEIGHT = 48;
const GAP = 12;
const MARGIN = 16;

/** 타일 옆(공간이 없으면 반대편)에 썸네일을 크게 띄우고, 그 아래에 제목과 주소를 보여준다. */
export default function ThumbnailPreview({ src, anchor, title, url }: Props) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(WIDTH, vw - MARGIN * 2);
  const height = Math.min(HEIGHT + CAPTION_HEIGHT, vh - MARGIN * 2);

  let left: number;
  if (anchor.right + GAP + width <= vw - MARGIN) {
    left = anchor.right + GAP;
  } else if (anchor.left - GAP - width >= MARGIN) {
    left = anchor.left - GAP - width;
  } else {
    left = Math.max(MARGIN, Math.min(anchor.left, vw - MARGIN - width));
  }
  const top = Math.max(MARGIN, Math.min(anchor.top, vh - MARGIN - height));

  return createPortal(
    <div className="thumb-preview" style={{ left, top, width, height }}>
      <img src={src} alt="" />
      <div className="thumb-preview-caption" style={{ height: CAPTION_HEIGHT }}>
        <div className="thumb-preview-title">{title}</div>
        <div className="thumb-preview-url">{url}</div>
      </div>
    </div>,
    document.body,
  );
}
