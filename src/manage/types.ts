export interface FlatBookmark {
  id: string;
  parentId: string;
  title: string;
  url: string;
  /** 추가된 시각 (epoch ms). 알 수 없으면 undefined */
  dateAdded?: number;
  /** 부모 폴더 안에서의 위치 (폴더와 북마크를 합친 순서, 0부터) */
  index: number;
  /** 북마크 바(root) 바로 아래부터 이 북마크가 속한 폴더까지의 폴더명 경로 */
  path: string[];
}

export interface FolderOption {
  id: string;
  /** "북마크 바 > 하위폴더 > ..." 형태의 표시용 경로 */
  label: string;
}

export interface BookmarkFolder {
  id: string;
  parentId: string;
  title: string;
  /** 부모 폴더 안에서의 위치 (폴더와 북마크를 합친 순서, 0부터) */
  index: number;
  /** 북마크 바(root) 바로 아래부터 이 폴더 자신까지의 폴더명 경로 */
  path: string[];
}
