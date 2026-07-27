// Standard API response envelope used by every endpoint
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>; // field-level validation errors
    requestId?: string;
  };
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  perPage?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}
