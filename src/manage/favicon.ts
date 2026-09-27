import { useEffect, useState } from "react";

// 사이트 파비콘. Chrome이 방문한 사이트의 파비콘을 저장해 두므로, "favicon" 권한으로
// 확장의 /_favicon/ 주소에서 꺼내 쓴다 (방문 기록 권한은 필요 없다).
// 한 번도 방문하지 않아 저장된 파비콘이 없으면 Chrome은 기본 지구본 아이콘을 돌려주므로,
// 그 기본 아이콘과 같은 이미지면 "파비콘 없음"으로 본다.

const SIZE = 64;
/** 파비콘이 저장되어 있을 리 없는 주소. 기본 아이콘을 알아내는 데 쓴다. */
const UNKNOWN_PAGE = "https://no-favicon.invalid/";

function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(SIZE));
  return url.toString();
}

/** 이미지를 픽셀 단위로 비교하기 위한 값 (같은 확장 origin이라 canvas를 읽을 수 있다) */
async function imageSignature(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return canvas.toDataURL();
}

let defaultSignature: Promise<string> | null = null;
/** 페이지 주소 → 파비콘 이미지 주소 (없으면 null). 페이지를 새로 열 때까지 기억한다. */
const cache = new Map<string, Promise<string | null>>();

export function loadFavicon(pageUrl: string): Promise<string | null> {
  if (!/^https?:/i.test(pageUrl)) return Promise.resolve(null);
  let result = cache.get(pageUrl);
  if (!result) {
    result = (async () => {
      defaultSignature ??= imageSignature(faviconUrl(UNKNOWN_PAGE));
      const src = faviconUrl(pageUrl);
      const [fallback, own] = await Promise.all([defaultSignature, imageSignature(src)]);
      return own === fallback ? null : src;
    })().catch(() => null);
    cache.set(pageUrl, result);
  }
  return result;
}

/** 방문한 적이 있어 파비콘이 저장된 사이트면 그 이미지 주소를, 아니면 null을 돌려준다. */
export function useFavicon(pageUrl: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!pageUrl) return;
    let cancelled = false;
    loadFavicon(pageUrl).then((found) => {
      if (!cancelled) setSrc(found);
    });
    return () => {
      cancelled = true;
    };
  }, [pageUrl]);
  return src;
}
