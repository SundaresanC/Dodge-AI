export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

type RequestConfig = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

// Global interceptors logic basically
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.map((cb) => cb(token));
  refreshSubscribers = [];
}

/**
 * Fetch wrapper that handles JSON bodies, auth headers, and automatic token refresh.
 */
export async function fetchApi<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
  const url = `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  
  let accessToken = localStorage.getItem('accessToken');
  
  const headers = new Headers(config.headers);
  if (!headers.has('Content-Type') && !(config.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const options: RequestInit = {
    ...config,
    headers,
    body: config.body ? (config.body instanceof FormData ? config.body : JSON.stringify(config.body)) : undefined,
  };

  let response = await fetch(url, options);

  // Handle 401 Unauthorized (Token expired)
  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      throw new Error('Unauthorized');
    }

    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!refreshResponse.ok) {
          throw new Error('Refresh failed');
        }

        const data = await refreshResponse.json();
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        
        accessToken = data.accessToken;
        isRefreshing = false;
        onRefreshed(data.accessToken);
      } catch (error) {
        isRefreshing = false;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    } else {
      // Wait for the token to be refreshed
      accessToken = await new Promise((resolve) => {
        subscribeTokenRefresh((token) => resolve(token));
      });
    }

    // Retrying original request with new token
    headers.set('Authorization', `Bearer ${accessToken}`);
    response = await fetch(url, { ...options, headers });
  }

  // Parse JSON if possible
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    const result = await response.json();
    if (!response.ok) {
      // Attach http status to the thrown error for callers to inspect
      const err = new Error(
        result?.message ?? result?.error ?? `Request failed (${response.status})`
      );
      (err as unknown as Record<string, unknown>).status = response.status;
      (err as unknown as Record<string, unknown>).data = result;
      throw err;
    }
    return result as T;
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response as unknown as T;
}

// ── NL Query API ─────────────────────────────────────────

export interface NLQueryResult {
  /** Discriminated type for rendering branch */
  type: 'chart' | 'table' | 'empty' | 'error';
  chartType: 'bar' | 'line' | 'pie' | 'kpi' | 'table' | 'none';
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  model: string;
  historyId?: string | null;
  title: string;
  description: string;
  /** Populated when results may be affected by data-quality issues */
  warning?: string;
  /** Populated for type === "error" */
  errorType?: 'invalid_query' | 'sql_generation' | 'unsafe_sql' | 'sql_error' | 'no_model';
  suggestions?: string[];
}

export interface QueryHistoryItem {
  id: string;
  nlQuery: string;
  generatedSql: string;
  chartType: string;
  rowCount: number;
  executionMs: number;
  createdAt: string;
  resultSchema: { columns: string[] } | null;
}

export interface QueryHistoryResponse {
  items: QueryHistoryItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export function nlQuery(query: string): Promise<NLQueryResult> {
  return fetchApi('/ai/nl-query', { method: 'POST', body: { query } });
}

export function getQueryHistory(page = 1, limit = 20): Promise<QueryHistoryResponse> {
  return fetchApi(`/ai/query-history?page=${page}&limit=${limit}`);
}

export function deleteQueryHistoryItem(id: string): Promise<void> {
  return fetchApi(`/ai/query-history/${id}`, { method: 'DELETE' });
}

// ── Settings / AI Model Config API ────────────────────────

export interface AIModelConfig {
  id: string;
  provider: 'GEMINI' | 'OPENAI' | 'ANTHROPIC';
  modelId: string;
  displayName: string;
  isActive: boolean;
  purpose: 'NL_QUERY' | 'DEFAULT';
  hasCustomKey: boolean;
  keyPreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIModelsResponse {
  configs: AIModelConfig[];
  systemKeys: { GEMINI: boolean; OPENAI: boolean; ANTHROPIC: boolean };
  encryptionEnabled: boolean;
}

export interface CreateModelConfigInput {
  provider: 'GEMINI' | 'OPENAI' | 'ANTHROPIC';
  modelId: string;
  displayName: string;
  isActive?: boolean;
  purpose?: 'NL_QUERY' | 'DEFAULT';
  apiKey?: string;
}

export interface UpdateModelConfigInput {
  provider?: 'GEMINI' | 'OPENAI' | 'ANTHROPIC';
  modelId?: string;
  displayName?: string;
  purpose?: 'NL_QUERY' | 'DEFAULT';
  isActive?: boolean;
  apiKey?: string | null;
}

export function getAIModels(): Promise<AIModelsResponse> {
  return fetchApi('/settings/ai-models');
}

export function createAIModel(config: CreateModelConfigInput): Promise<AIModelConfig> {
  return fetchApi('/settings/ai-models', { method: 'POST', body: config });
}

export function updateAIModel(id: string, config: UpdateModelConfigInput): Promise<AIModelConfig> {
  return fetchApi(`/settings/ai-models/${id}`, { method: 'PUT', body: config });
}

export function deleteAIModel(id: string): Promise<void> {
  return fetchApi(`/settings/ai-models/${id}`, { method: 'DELETE' });
}

export function activateAIModel(id: string, purpose: string): Promise<AIModelConfig> {
  return fetchApi(`/settings/ai-models/${id}/activate`, { method: 'PATCH', body: { purpose } });
}

export function verifyAIModel(id: string): Promise<{ valid: boolean; error?: string }> {
  return fetchApi(`/settings/ai-models/${id}/verify`);
}
