import { useEffect, useState } from "react";
import {
  THUMBNAIL_UPDATED,
  getAllThumbnails,
  getThumbnail,
  type ThumbnailUpdatedMessage,
} from "../thumbnails";

/**
 * 저장된 썸네일을 불러와 { 썸네일 키 → object URL } 맵으로 제공한다.
 * 서비스 워커가 새 썸네일을 저장하면 메시지를 받아 해당 항목만 갱신한다.
 * 관리 페이지 안에서 바꾼 경우(notifyThumbnailsChanged)도 같은 방식으로 반영하며,
 * 썸네일이 지워졌으면 맵에서도 뺀다.
 */
export function useThumbnails(): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // 언마운트 시 해제하기 위해 이 effect에서 만든 object URL을 모두 추적한다.
    const created = new Set<string>();

    const setOne = (key: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      created.add(url);
      setUrls((prev) => {
        const old = prev.get(key);
        if (old) {
          URL.revokeObjectURL(old);
          created.delete(old);
        }
        return new Map(prev).set(key, url);
      });
    };

    getAllThumbnails()
      .then((all) => {
        if (cancelled) return;
        for (const [key, record] of all) setOne(key, record.blob);
      })
      .catch((e) => console.error("[thumbnail] load failed:", e));

    const removeOne = (key: string) => {
      setUrls((prev) => {
        const old = prev.get(key);
        if (!old) return prev;
        URL.revokeObjectURL(old);
        created.delete(old);
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    };

    const handleMessage = (message: ThumbnailUpdatedMessage) => {
      if (message?.type !== THUMBNAIL_UPDATED) return;
      getThumbnail(message.key).then((record) => {
        if (cancelled) return;
        if (record) setOne(message.key, record.blob);
        else removeOne(message.key);
      });
    };
    const handleLocalChange = (e: Event) =>
      handleMessage((e as CustomEvent<ThumbnailUpdatedMessage>).detail);
    chrome.runtime.onMessage.addListener(handleMessage);
    window.addEventListener(THUMBNAIL_UPDATED, handleLocalChange);

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
      window.removeEventListener(THUMBNAIL_UPDATED, handleLocalChange);
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, []);

  return urls;
}
