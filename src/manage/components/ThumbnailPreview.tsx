import { createPortal } from "react-dom";

interface Props {
  src: string;
  /** 미리보기를 띄울 기준이 되는 타일의 화면상 위치 */
  anchor: DOMRect;
}

const WIDTH = 560;
const HEIGHT = 350; // 16:10
const GAP = 12;
const MARGIN = 16;

/** 타일 옆(공간이 없으면 반대편)에 썸네일을 크게 띄운다. */
export default function ThumbnailPreview({ src, anchor }: Props) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(WIDTH, vw - MARGIN * 2);
  const height = Math.min(HEIGHT, vh - MARGIN * 2);

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
    </div>,
    document.body,
  );
}
