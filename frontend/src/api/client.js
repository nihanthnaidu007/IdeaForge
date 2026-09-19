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
  RATE_LIMITED: "rate_limited",
  RESEARCH_FAILED: "research_failed",
  GENERATION_FAILED: "generation_failed",
  UNAVAILABLE: "unavailable",
  VALIDATION: "validation",
  CONFLICT: "conflict",
  NOT_FOUND: "not_found",
  NETWORK: "network",
  SERVER: "server",
  CAP: "cap",
  UNKNOWN: "unknown",
};

// Key-issue family (UI pack §3.1): only Settings (or the provider console)
// can fix these — retrying cannot. A failure of this kind must always render
// its honest card, even over older data on screen; never collapse into the
// stale-banner + toast path where no action beyond retry is offered.
export const isKeyIssueError = (error) =>
  [ERROR_KINDS.MISSING_KEY, ERROR_KINDS.AUTH, ERROR_KINDS.QUOTA, ERROR_KINDS.CAP].includes(
    error?.kind,
  );

const KIND_BY_STATUS = {
  401: ERROR_KINDS.AUTH,
  402: ERROR_KINDS.QUOTA,
  403: ERROR_KINDS.AUTH,
  404: ERROR_KINDS.NOT_FOUND,
  409: ERROR_KINDS.CONFLICT,
  429: ERROR_KINDS.RATE_LIMITED,
  503: ERROR_KINDS.UNAVAILABLE,
};

// Backend error codes (provider layer) map to kinds; unknown/absent codes
// fall back to status-based mapping.
const KIND_BY_CODE = {
  MISSING_KEYS: ERROR_KINDS.MISSING_KEY,
  PROVIDER_AUTH: ERROR_KINDS.AUTH,
  PROVIDER_QUOTA: ERROR_KINDS.QUOTA,
  PROVIDER_UNAVAILABLE: ERROR_KINDS.UNAVAILABLE,
  RESEARCH_FAILED: ERROR_KINDS.RESEARCH_FAILED,
  GENERATION_FAILED: ERROR_KINDS.GENERATION_FAILED,
  USAGE_CAP_EXCEEDED: ERROR_KINDS.CAP,
  // Per-trend forge: an unknown/expired/not-owned trend id is the typed 404
  // (trend_cache.TrendNotFoundError) — same not_found kind the status map
  // yields, stated explicitly because the forge flow branches on it.
  TRENDS_NOT_FOUND: ERROR_KINDS.NOT_FOUND,
  INTERNAL_ERROR: ERROR_KINDS.SERVER,
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
  [ERROR_KINDS.RESEARCH_FAILED]:
    "The research service didn't return usable results — try again.",
  [ERROR_KINDS.GENERATION_FAILED]:
    "The model's response wasn't usable after a retry — try again.",
  [ERROR_KINDS.CAP]:
    "Today's bundled allowance is spent — add your own API key in Settings for unlimited use.",
  [ERROR_KINDS.RATE_LIMITED]: "Too many requests — slow down and try again.",
  [ERROR_KINDS.VALIDATION]: "The request was rejected — adjust the input.",
  [ERROR_KINDS.CONFLICT]:
    "That already exists — try logging in instead of creating it again.",
  [ERROR_KINDS.NOT_FOUND]: "That isn't here anymore.",
  [ERROR_KINDS.NETWORK]:
    "Can't reach the IdeaForge server — check your connection and try again.",
  [ERROR_KINDS.SERVER]:
    "IdeaForge's server hit an unexpected failure — try again.",
  [ERROR_KINDS.UNKNOWN]: "Something went wrong — try again.",
};

export class ApiError extends Error {
  constructor({ status, kind, message, provider, detail, code, requestId, retryAfter, fields, caps }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.provider = provider;
    this.detail = detail;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.fields = fields;
    // USAGE_CAP_EXCEEDED payload (app/errors.py `extra` merge): the allowance
    // facts the cap card states — never parsed out of the message string.
    this.caps = caps;
  }
}

// Normalize any thrown value into an ApiError. Extracts the code/kind from the
// response body when the backend provides one (typed errors), else infers from
// the HTTP status. No provider-specific string matching — structure only.
export function normalizeApiError(error) {
  if (error instanceof ApiError) return error;

  if (error?.response) {
    const { status, data, headers } = error.response;
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    // The backend error envelope is {detail, kind, provider, request_id}
    // (app/errors.py): kind names the taxonomy (RESEARCH_FAILED, ...); a
    // plain `code` field is the alternate shape. Body kind wins, then code,
    // then the status fallback.
    const code = data?.code ?? (typeof data?.detail === "object" ? data.detail?.code : undefined);
    const bodyKind = typeof data?.kind === "string" ? data.kind : undefined;
    const kind =
      (bodyKind && KIND_BY_CODE[bodyKind]) ||
      (code && KIND_BY_CODE[code]) ||
      KIND_BY_STATUS[status] ||
      (status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.VALIDATION);
    // 422 Pydantic bodies carry loc-pathed field errors — map them to a
    // {path: message} object so forms can render inline messages.
    const fields = Array.isArray(data?.detail)
      ? Object.fromEntries(
          data.detail
            .filter((entry) => Array.isArray(entry?.loc) && entry.loc.length > 1)
            .map((entry) => [entry.loc[entry.loc.length - 1], entry.msg ?? "Invalid value."]),
        )
      : undefined;
    const retryAfter =
      Number(headers?.["retry-after"]) || Number(data?.retry_after) || undefined;
    const caps =
      data?.allowance != null
        ? {
            allowance: data.allowance,
            resetsAt: data.resets_at,
            resource: data.resource,
          }
        : undefined;
    const requestId = headers?.["x-request-id"] ?? data?.request_id ?? undefined;
    return new ApiError({
      status,
      kind,
      provider: data?.provider ?? (typeof data?.detail === "object" ? data.detail?.provider : undefined),
      detail: data?.detail,
      code,
      requestId,
      retryAfter,
      fields,
      caps,
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

// 401 on an authenticated request triggers one single-flight refresh attempt
// (the backend's refresh token is single-use, so concurrent 401s must share
// one refresh call), then retries the original request. Auth endpoints are
// exempt — a 401 from login/register/refresh/logout is a real credential
// failure, not a stale access token.
let unauthorizedHandler = null;
export const onUnauthorized = (handler) => {
  unauthorizedHandler = handler;
};

const REFRESH_STORAGE_KEY = "ideaforge_refresh";
const AUTH_URLS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

let refreshInFlight = null;

function refreshTokens() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_STORAGE_KEY);
    if (!refreshToken) {
      throw new ApiError({
        status: 401,
        kind: ERROR_KINDS.AUTH,
        message: FALLBACK_MESSAGE[ERROR_KINDS.AUTH],
      });
    }
    // Bare axios: the client's own interceptors would recurse on this call.
    const response = await axios.post(`${API}/auth/refresh`, { refresh_token: refreshToken });
    const { token, refresh_token: nextRefresh } = response.data;
    if (!token || !nextRefresh) {
      throw new ApiError({
        status: 401,
        kind: ERROR_KINDS.AUTH,
        message: FALLBACK_MESSAGE[ERROR_KINDS.AUTH],
      });
    }
    localStorage.setItem("ideaforge_token", token);
    localStorage.setItem(REFRESH_STORAGE_KEY, nextRefresh);
    return token;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// 30s ceiling (F04 diagnosis, art_vqwfyodR): nothing below the browser had a
// deadline, so a wedged proxied request held the UI in its pending state
// forever. A timeout throws with `request` set and no `response`, which
// normalizeApiError maps to the NETWORK kind — the existing honest error card
// with its retry affordance.
const client = axios.create({ baseURL: API, timeout: 30000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("ideaforge_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const normalized = normalizeApiError(error);
    const original = error?.config ?? {};
    const isAuthUrl = AUTH_URLS.some((p) => original.url?.includes(p));

    // Session expired: refresh once (single-flight), then retry. A failed
    // refresh means the session is truly dead — notify handlers and reject.
    // Provider-key 401s (backend kind PROVIDER_AUTH, carrying a provider
    // attribution) are NOT session failures: no refresh can fix a rejected
    // key, and logging the user out over one would be dishonest UX.
    if (
      !isProviderAuthFailure(normalized) &&
      normalized.status === 401 &&
      !isAuthUrl &&
      !original._refreshRetried
    ) {
      try {
        const token = await refreshTokens();
        return client.request({
          ...original,
          headers: { ...original.headers, Authorization: `Bearer ${token}` },
          _refreshRetried: true,
        });
      } catch {
        // Refresh failed — fall through to the unauthorized notification.
      }
    }

    if (
      normalized.status === 401 &&
      !isProviderAuthFailure(normalized) &&
      unauthorizedHandler
    )
      unauthorizedHandler(normalized);
    return Promise.reject(normalized);
  }
);

// A provider-attributed 401 (PROVIDER_AUTH) means the user's BYOK key was
// rejected — the session itself is fine. Session 401s from the auth
// dependency never carry a provider field.
export function isProviderAuthFailure(err) {
  return err?.status === 401 && err?.kind === ERROR_KINDS.AUTH && err?.provider != null;
}

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
  put: (url, data, config) => request("put", url, data, config),
  patch: (url, data, config) => request("patch", url, data, config),
  delete: (url, config) => request("delete", url, undefined, config),
};
