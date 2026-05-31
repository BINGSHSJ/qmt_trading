import type { ApiError, ApiResponse, PageQueryParams } from '../types/api';

export class RequestError extends Error {
  apiError?: ApiError | null;
  traceId?: string;

  constructor(message: string, apiError?: ApiError | null, traceId?: string) {
    super(message);
    this.name = 'RequestError';
    this.apiError = apiError;
    this.traceId = traceId;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const DEFAULT_TIMEOUT_MS = 30000;

function filenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

async function downloadErrorFromResponse(response: Response): Promise<RequestError> {
  const fallbackError: ApiError = {
    code: 'DOWNLOAD_FAILED',
    detail: `${response.status} ${response.statusText}`,
    suggestion: '请检查后端服务和导出权限。',
  };

  try {
    const body = (await response.clone().json()) as Partial<ApiResponse<unknown>>;
    const backendError = body.error
      ? {
        ...fallbackError,
        ...body.error,
        suggestion: body.error.suggestion ?? fallbackError.suggestion,
      }
      : fallbackError;
    return new RequestError(body.message || '文件下载失败，请稍后重试。', backendError, body.trace_id);
  } catch {
    return new RequestError('文件下载失败，请稍后重试。', fallbackError, undefined);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const externalSignal = init?.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    response = await fetch(`${API_BASE}${url}`, {
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? '接口请求超时或已取消，请稍后重试。'
      : '无法连接后端服务，请确认本地启动脚本已运行。';
    throw new RequestError(
      message,
      { code: 'NETWORK_ERROR', detail: String(error), suggestion: '请检查后端是否运行在 8000 端口' },
      undefined,
    );
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }

  const responseForErrorText = response.clone();
  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch (error) {
    let responseText = '';
    try {
      responseText = await responseForErrorText.text();
    } catch {
      responseText = '无法读取响应正文';
    }
    throw new RequestError(
      '接口返回格式异常，请复制技术详情给 AI 排查。',
      {
        code: 'RESPONSE_PARSE_ERROR',
        detail: [
          `status=${response.status} ${response.statusText}`,
          `url=${url}`,
          `parse_error=${String(error)}`,
          `body=${responseText.slice(0, 1000) || '空响应'}`,
        ].join('; '),
        suggestion: '请检查后端日志、接口地址和本地服务是否返回了非 JSON 内容。',
      },
      undefined,
    );
  }
  if (!response.ok || !body.success) {
    throw new RequestError(body.message || '接口请求失败', body.error, body.trace_id);
  }

  return body.data as T;
}

export function buildPageQuery(params: PageQueryParams = {}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  });
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.sortField) query.set('sort_field', params.sortField);
  if (params.sortOrder) query.set('sort_order', params.sortOrder);
  if (params.startDate) query.set('start_date', params.startDate);
  if (params.endDate) query.set('end_date', params.endDate);
  if (params.status) query.set('status', params.status);
  if (params.scope) query.set('scope', params.scope);
  return query.toString();
}

export async function downloadFile(url: string, fallbackFilename: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`);
  } catch (error) {
    throw new RequestError(
      '无法连接后端服务，请确认本地启动脚本已运行。',
      { code: 'NETWORK_ERROR', detail: String(error), suggestion: '请检查后端是否运行在 8000 端口' },
      undefined,
    );
  }
  if (!response.ok) {
    throw await downloadErrorFromResponse(response);
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallbackFilename);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
  return filename;
}
