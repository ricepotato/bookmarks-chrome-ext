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

    const handleMessage = (message: ThumbnailUpdatedMessage) => {
      if (message?.type !== THUMBNAIL_UPDATED) return;
      getThumbnail(message.key).then((record) => {
        if (!cancelled && record) setOne(message.key, record.blob);
      });
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, []);

  return urls;
}
