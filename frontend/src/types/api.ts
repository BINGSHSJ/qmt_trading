export interface ApiError {
  code: string;
  detail?: string | null;
  suggestion?: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  error: ApiError | null;
  trace_id: string;
}

export interface DirectoryStatus {
  name: string;
  path: string;
  exists: boolean;
}

export interface HealthStatus {
  app_name: string;
  version: string;
  api_status: string;
  qmt: {
    mode: string;
    connected: boolean;
    message: string;
  };
  directories: DirectoryStatus[];
}

export interface PageResult<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface PageQueryParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
  status?: string;
  scope?: string;
}

export interface PageState {
  page: number;
  pageSize: number;
  total: number;
}

export const defaultPageState: PageState = {
  page: 1,
  pageSize: 20,
  total: 0,
};
