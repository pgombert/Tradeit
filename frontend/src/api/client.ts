import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
  AccountSnapshot,
  AuthTokens,
  EconSeriesDetail,
  EconSeriesSummary,
  LoginResponse,
  SchwabAccountOption,
  YieldCurveSnapshot,
} from '@tradeit/shared';

const ACCESS_KEY = 'tradeit.accessToken';
const REFRESH_KEY = 'tradeit.refreshToken';

// Tokens are the one thing that legitimately lives in browser storage.
// Anything Pete authors or curates belongs in Postgres — see CLAUDE.md.
export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(next: AuthTokens) {
    localStorage.setItem(ACCESS_KEY, next.accessToken);
    localStorage.setItem(REFRESH_KEY, next.refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post<AuthTokens>('/api/auth/refresh', { refreshToken });
    tokens.set(data);
    return data.accessToken;
  } catch {
    tokens.clear();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status !== 401 || !original || original._retried) {
      return Promise.reject(error);
    }

    original._retried = true;

    // One refresh in flight at a time, so a burst of 401s doesn't rotate the
    // token several times over.
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });

    const token = await refreshing;
    if (!token) {
      window.location.href = '/login';
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);

export interface RiskStatus {
  limits: {
    startingCapital: number;
    maxDrawdown: number;
    floor: number;
    halveSizeAt: number;
    pauseAt: number;
    hardStopAt: number;
  };
  currentEquity: number | null;
  peakEquity: number | null;
  drawdown: number | null;
  breaker: 'NONE' | 'HALVE_SIZE' | 'PAUSE_AND_REVIEW' | 'HARD_STOP';
  targetWeeklyReturn: number;
}

export interface CollectorRunDto {
  id: string;
  collector: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  recordsWritten: number;
  error: string | null;
}

export const authApi = {
  google: (idToken: string) =>
    api.post<LoginResponse>('/auth/google', { idToken }).then((r) => r.data),
};

export interface RegimeSignal {
  key: string;
  label: string;
  reading: string;
  score: number;
}

export interface RegimeResponse {
  regime: 'RISK_ON_TREND' | 'CHOP' | 'RISK_OFF' | 'CRISIS';
  score: number;
  signals: RegimeSignal[];
  missing: string[];
  cappedByMissingTrend: boolean;
  leverageAllowed: boolean;
  riskBudget: number;
  rationale: string;
  asOf: string | null;
}

export const dataApi = {
  regime: () => api.get<RegimeResponse>('/regime').then((r) => r.data),
  yieldCurve: () => api.get<YieldCurveSnapshot>('/econ/yield-curve').then((r) => r.data),
  series: () => api.get<EconSeriesSummary[]>('/econ/series').then((r) => r.data),
  seriesDetail: (id: string, days = 365) =>
    api.get<EconSeriesDetail>(`/econ/series/${id}`, { params: { days } }).then((r) => r.data),
  account: () => api.get<AccountSnapshot>('/account').then((r) => r.data),
  risk: () => api.get<RiskStatus>('/risk').then((r) => r.data),
  collectorRuns: () => api.get<CollectorRunDto[]>('/collectors/runs').then((r) => r.data),
};

export const schwabApi = {
  /** Ask the server where to send the user to grant read-only Schwab access. */
  loginUrl: () => api.get<{ url: string }>('/schwab/login').then((r) => r.data.url),
  /** The accounts this login exposes, for the "which account?" picker. */
  accounts: () => api.get<SchwabAccountOption[]>('/schwab/accounts').then((r) => r.data),
  /** Choose which account to track; returns the fresh snapshot for it. */
  selectAccount: (token: string) =>
    api.post<AccountSnapshot>('/schwab/select-account', { token }).then((r) => r.data),
};
