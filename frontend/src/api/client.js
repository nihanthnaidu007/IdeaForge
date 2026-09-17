import axios from "axios";

// Base URL resolution mirrors the Vite migration contract: VITE_BACKEND_URL is
// canonical, REACT_APP_BACKEND_URL is a legacy fallback, dev defaults to the
// local FastAPI server, and a built app defaults to same-origin.
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.REACT_APP_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:8001" : window.location.origin);

export const API = `${BACKEND_URL}/api`;

// Error kinds mirror the backend's typed failure taxonomy (spec §Error
// taxonomy). The kind drives distinct UI: missing-key/quota/auth states route
// the user to Settings, everything else offers retry. Never render a provider
// failure as if it were data.
export const ERROR_KINDS = {
  MISSING_KEY: "missing_key",
  AUTH: "auth",
  QUOTA: "quota",
  UNAVAILABLE: "unavailable",
  PROVIDER: "provider",
  RATE_LIMIT: "rate_limit",
  VALIDATION: "validation",
  NETWORK: "network",
  UNKNOWN: "unknown",
};

const KIND_BY_STATUS = {
  401: ERROR_KINDS.AUTH,
  402: ERROR_KINDS.QUOTA,
  403: ERROR_KINDS.AUTH,
  429: ERROR_KINDS.RATE_LIMIT,
  502: ERROR_KINDS.PROVIDER,
  503: ERROR_KINDS.UNAVAILABLE,
};

// Backend error codes (provider layer) map 1:1 to kinds; unknown/absent codes
// fall back to status-based mapping.
const KIND_BY_CODE = {
  MISSING_KEYS: ERROR_KINDS.MISSING_KEY,
  PROVIDER_AUTH: ERROR_KINDS.AUTH,
  PROVIDER_QUOTA: ERROR_KINDS.QUOTA,
  PROVIDER_UNAVAILABLE: ERROR_KINDS.UNAVAILABLE,
  RESEARCH_FAILED: ERROR_KINDS.PROVIDER,
  GENERATION_FAILED: ERROR_KINDS.PROVIDER,
};

// Product-neutral fallback copy per kind. Server-provided detail (the honest
// copy from the fail-loud backend) always wins over these.
const FALLBACK_MESSAGE = {
  [ERROR_KINDS.MISSING_KEY]:
    "No API key is configured for this provider yet — add one in Settings.",
  [ERROR_KINDS.AUTH]: "Your API key was rejected — check it in Settings.",
  [ERROR_KINDS.QUOTA]:
    "Your provider account is out of credit — add balance or switch keys in Settings.",
  [ERROR_KINDS.UNAVAILABLE]:
    "The provider is temporarily unavailable — try again in a moment.",
  [ERROR_KINDS.PROVIDER]:
    "The provider failed to complete this request — try again.",
  [ERROR_KINDS.RATE_LIMIT]: "Too many requests — slow down and try again.",
  [ERROR_KINDS.VALIDATION]: "The request was rejected — adjust the input.",
  [ERROR_KINDS.NETWORK]:
    "Can't reach the IdeaForge server — check your connection and try again.",
  [ERROR_KINDS.UNKNOWN]: "Something went wrong — try again.",
};

export class ApiError extends Error {
  constructor({ status, kind, message, provider, detail }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.provider = provider;
    this.detail = detail;
  }
}

// Normalize any thrown value into an ApiError. Extracts the code/kind from the
// response body when the backend provides one (typed errors), else infers from
// the HTTP status. No provider-specific string matching — structure only.
export function normalizeApiError(error) {
  if (error instanceof ApiError) return error;

  if (error?.response) {
    const { status, data } = error.response;
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    const code = data?.code ?? (typeof data?.detail === "object" ? data.detail?.code : undefined);
    const kind =
      (code && KIND_BY_CODE[code]) ||
      KIND_BY_STATUS[status] ||
      (status >= 500 ? ERROR_KINDS.PROVIDER : ERROR_KINDS.VALIDATION);
    return new ApiError({
      status,
      kind,
      provider: data?.provider ?? (typeof data?.detail === "object" ? data.detail?.provider : undefined),
      detail: data?.detail,
      message: data?.message || detail || FALLBACK_MESSAGE[kind],
    });
  }

  if (error?.request) {
    return new ApiError({
      status: 0,
      kind: ERROR_KINDS.NETWORK,
      message: FALLBACK_MESSAGE[ERROR_KINDS.NETWORK],
    });
  }

  return new ApiError({
    status: 0,
    kind: ERROR_KINDS.UNKNOWN,
    message: error?.message || FALLBACK_MESSAGE[ERROR_KINDS.UNKNOWN],
  });
}

// 401 on an authenticated request means the token is dead (expired or
// revoked). Handlers registered here react — AuthProvider clears session
// state. When the backend ships refresh-token rotation, a refresh-and-retry
// step slots in ahead of this callback.
let unauthorizedHandler = null;
export const onUnauthorized = (handler) => {
  unauthorizedHandler = handler;
};

const client = axios.create({ baseURL: API });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("ideaforge_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = normalizeApiError(error);
    if (normalized.status === 401 && unauthorizedHandler) unauthorizedHandler(normalized);
    return Promise.reject(normalized);
  }
);

async function request(method, url, data, config) {
  try {
    const response = await client[method](url, ...(method === "get" || method === "delete" ? [config] : [data, config]));
    return response.data;
  } catch (error) {
    // Re-throw normalized ApiErrors as-is; wrap anything unexpected.
    throw error instanceof ApiError ? error : normalizeApiError(error);
  }
}

export const api = {
  get: (url, config) => request("get", url, undefined, config),
  post: (url, data, config) => request("post", url, data, config),
  patch: (url, data, config) => request("patch", url, data, config),
  delete: (url, config) => request("delete", url, undefined, config),
};
