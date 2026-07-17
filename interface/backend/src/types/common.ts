export type RowObject = Record<string, unknown>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ArtifactMeta {
  name: string;
  fileName: string;
  ext: string;
  category: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  imageUrl?: string;
  htmlUrl?: string;
  fileUrl: string;
}
