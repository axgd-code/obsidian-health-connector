import { logger } from '../../../shared/logging/Logger';
import type { HealthData } from '../../../domain/health/entities/HealthData';
import type { IHealthProvider } from '../../../domain/health/ports/IHealthProvider';

let requestUrl: (config: any) => Promise<any>;
try {
  const obsidian = require('obsidian');
  requestUrl = obsidian.requestUrl;
} catch {
  requestUrl = async (config: any) => {
    const response = await fetch(config.url, {
      method: config.method || 'GET',
      headers: config.headers || {},
      body: config.body,
    });
    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, text, json };
  };
}

const GOOGLE_FIT_BASE = 'https://www.googleapis.com/fitness/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const truncate = (value: unknown, max = 1200): string => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix epoch seconds
}

export class GoogleHealthProvider implements IHealthProvider {
  private clientId: string;
  private clientSecret: string;
  private tokens: GoogleTokens;
  private onTokensUpdated: (tokens: GoogleTokens) => Promise<void>;

  constructor(
    clientId: string,
    clientSecret: string,
    tokens: GoogleTokens,
    onTokensUpdated: (tokens: GoogleTokens) => Promise<void>,
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = tokens;
    this.onTokensUpdated = onTokensUpdated;
  }

  private redactToken(token: string): string {
    if (!token) return '(empty)';
    if (token.length <= 10) return `${token.slice(0, 3)}...${token.slice(-2)}`;
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  private async safeRequest(config: any, label: string): Promise<any> {
    try {
      return await requestUrl({
        throw: false,
        ...config,
      });
    } catch (error: any) {
      const status = Number(error?.status ?? error?.response?.status ?? 0) || undefined;
      const body = error?.response?.text ?? error?.body ?? error?.message;
      logger.warn(`[GoogleHealth] ${label} threw before response handling`, {
        status,
        body: truncate(body, 1200),
      });
      throw new Error(`Google request failed (${label}): HTTP ${status ?? 'unknown'}`);
    }
  }

  private parseJsonResponse(response: any): any {
    if (response?.json !== undefined && response?.json !== null) return response.json;
    return JSON.parse(response?.text ?? '{}');
  }

  private handleGoogleHttpError(operation: string, response: any): never {
    const status = Number(response?.status ?? 0) || 0;
    const bodyPreview = truncate(response?.text, 1200);
    let googleMessage = '';
    let googleReason = '';
    let googleService = '';

    try {
      const parsed = this.parseJsonResponse(response);
      googleMessage = String(parsed?.error?.message || '');
      const firstDetail = Array.isArray(parsed?.error?.details) ? parsed.error.details[0] : undefined;
      const firstError = Array.isArray(firstDetail?.errors) ? firstDetail.errors[0] : undefined;
      googleReason = String(firstError?.reason || parsed?.error?.status || '');
      googleService = String(firstDetail?.service || '');
    } catch {
      // keep fallback preview-only logging
    }

    logger.warn(`[GoogleHealth] ${operation} failed`, {
      status,
      body: bodyPreview,
      googleMessage,
      googleReason,
      googleService,
    });

    if (googleMessage) {
      logger.warn('[GoogleHealth] API message:', googleMessage);
    }
    if (googleReason) {
      logger.warn('[GoogleHealth] API reason:', googleReason);
    }

    if (status === 403) {
      logger.warn('[GoogleHealth] 403 diagnostic checklist:');
      logger.warn('[GoogleHealth] 1) Verify Google Fitness API is enabled for this GCP project.');
      logger.warn('[GoogleHealth] 2) Reconnect Google to refresh consent after scope changes.');
      logger.warn('[GoogleHealth] 3) Confirm OAuth app includes your account as test user (if app is in testing mode).');
      logger.warn('[GoogleHealth] 4) Ensure requested scopes include fitness.activity.read, fitness.body.read, fitness.heart_rate.read, fitness.sleep.read.');
    }

    throw new Error(`Google ${operation} failed: HTTP ${status}`);
  }

  async init(): Promise<void> {
    logger.debug('[GoogleHealth] init()');
    await this.ensureValidToken();
  }

  private async ensureValidToken(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    logger.debug('[GoogleHealth] ensureValidToken()', {
      hasAccessToken: !!this.tokens.accessToken,
      hasRefreshToken: !!this.tokens.refreshToken,
      expiresAt: this.tokens.expiresAt,
      now,
      secondsUntilExpiry: this.tokens.expiresAt - now,
      accessTokenPreview: this.redactToken(this.tokens.accessToken),
    });

    if (this.tokens.accessToken && this.tokens.expiresAt > now + 300) {
      logger.debug('Google Health access token still valid');
      return;
    }

    if (!this.tokens.refreshToken) {
      throw new Error('GoogleHealthNotConnected');
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    }).toString();

    logger.info('[GoogleHealth] Refreshing access token...');

    const response = await this.safeRequest({
      url: GOOGLE_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, 'token_refresh');

    logger.debug('[GoogleHealth] Token refresh HTTP status:', response.status);

    if (response.status !== 200) {
      this.handleGoogleHttpError('token refresh', response);
    }

    const data = this.parseJsonResponse(response);
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    };
    logger.info('[GoogleHealth] Token refreshed successfully', {
      expiresAt: this.tokens.expiresAt,
      accessTokenPreview: this.redactToken(this.tokens.accessToken),
    });
    await this.onTokensUpdated(this.tokens);
  }

  async getData(date: Date): Promise<HealthData> {
    await this.ensureValidToken();

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const aggregateBody = {
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta' },
        { dataTypeName: 'com.google.weight' },
        { dataTypeName: 'com.google.heart_rate.bpm' },
      ],
      bucketByTime: { durationMillis: end.getTime() - start.getTime() + 1 },
      startTimeMillis: start.getTime(),
      endTimeMillis: end.getTime(),
    };

    logger.debug('[GoogleHealth] Fetch aggregate request', {
      date: date.toISOString().slice(0, 10),
      startTimeMillis: aggregateBody.startTimeMillis,
      endTimeMillis: aggregateBody.endTimeMillis,
      scopes: aggregateBody.aggregateBy.map((x) => x.dataTypeName),
      accessTokenPreview: this.redactToken(this.tokens.accessToken),
    });

    const response = await this.safeRequest({
      url: `${GOOGLE_FIT_BASE}/users/me/dataset:aggregate`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(aggregateBody),
    }, 'dataset_aggregate');

    logger.debug('[GoogleHealth] Aggregate HTTP status:', response.status);

    if (response.status !== 200) {
      this.handleGoogleHttpError('aggregate', response);
    }

    const data = this.parseJsonResponse(response);
    const buckets = Array.isArray(data?.bucket) ? data.bucket : [];
    logger.debug('[GoogleHealth] Aggregate parsed buckets:', buckets.length);

    let steps: number | null = null;
    let weight: number | null = null;
    let averageHeartRate: number | null = null;

    const hrValues: number[] = [];

    const collectPoints = (dataset: any): any[] => {
      return Array.isArray(dataset?.point) ? dataset.point : [];
    };

    const collectStepsFromPoints = (points: any[]): number => {
      let total = 0;
      for (const p of points) {
        const val = p?.value?.[0]?.intVal;
        if (typeof val === 'number') total += val;
      }
      return total;
    };

    const collectMaxWeightFromPoints = (points: any[]): number | null => {
      let max: number | null = null;
      for (const p of points) {
        const val = p?.value?.[0]?.fpVal;
        if (typeof val === 'number' && !isNaN(val)) {
          if (max === null || val > max) max = Number(val.toFixed(2));
        }
      }
      return max;
    };

    const collectHeartRateFromPoints = (points: any[]): void => {
      for (const p of points) {
        const val = p?.value?.[0]?.fpVal;
        if (typeof val === 'number' && !isNaN(val)) hrValues.push(val);
      }
    };

    for (let index = 0; index < buckets.length; index++) {
      const bucket = buckets[index];
      const datasets = Array.isArray(bucket?.dataset) ? bucket.dataset : [];
      const usedOrderedParsing = datasets.length >= 3;
      logger.debug('[GoogleHealth] Bucket summary', {
        bucketIndex: index,
        datasetCount: datasets.length,
        pointCounts: datasets.map((d: any) => Array.isArray(d?.point) ? d.point.length : 0),
        usedOrderedParsing,
      });

      // Primary parse strategy: aggregate response usually returns datasets
      // in the same order as aggregateBy.
      const stepDataset = datasets[0];
      const weightDataset = datasets[1];
      const heartDataset = datasets[2];

      if (stepDataset) {
        const total = collectStepsFromPoints(collectPoints(stepDataset));
        if (total > 0) steps = (steps ?? 0) + total;
      }

      if (weightDataset) {
        const maxWeight = collectMaxWeightFromPoints(collectPoints(weightDataset));
        if (maxWeight !== null) {
          if (weight === null || maxWeight > weight) weight = maxWeight;
        }
      }

      if (heartDataset) {
        collectHeartRateFromPoints(collectPoints(heartDataset));
      }

      // Fallback parse strategy: detect by data source/type name when available.
      // Only used when ordered parsing is not reliable.
      if (usedOrderedParsing) continue;
      for (const dataset of datasets) {
        const points = collectPoints(dataset);
        const sourceType = String(dataset?.dataSourceId || dataset?.dataTypeName || '').toLowerCase();

        if (sourceType.includes('step_count')) {
          const total = collectStepsFromPoints(points);
          if (total > 0) steps = Math.max(steps ?? 0, total);
        }

        if (sourceType.includes('weight')) {
          const maxWeight = collectMaxWeightFromPoints(points);
          if (maxWeight !== null) {
            if (weight === null || maxWeight > weight) weight = maxWeight;
          }
        }

        if (sourceType.includes('heart_rate')) {
          collectHeartRateFromPoints(points);
        }
      }
    }

    if (hrValues.length > 0) {
      const avg = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;
      averageHeartRate = Math.round(avg);
    }

    logger.info('[GoogleHealth] Extracted metrics', {
      steps,
      weight,
      averageHeartRate,
      hrSamples: hrValues.length,
    });

    return {
      steps,
      weight,
      averageHeartRate,
      vo2Max: null,
      hrv: null,
      stress: null,
      bodyBattery: null,
      spO2: null,
      sleep: null,
      sleepScore: null,
      sports: [],
      transport_km: null,
      didRunning: false,
      runningDistance_km: null,
      didSwimming: false,
      SwimmingDistance_km: null,
      didCycling: false,
      cyclingDistance_km: null,
      otherActivities: false,
    };
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<GoogleTokens> {
    logger.info('[GoogleHealth] Exchanging OAuth code for tokens');
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString();

    const response = await requestUrl({
      url: GOOGLE_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      throw: false,
    });

    logger.debug('[GoogleHealth] Code exchange HTTP status:', response.status);

    if (response.status !== 200) {
      logger.warn('[GoogleHealth] Code exchange error body:', truncate(response.text, 800));
      throw new Error(`Google code exchange failed: HTTP ${response.status}`);
    }

    const data = response.json ?? JSON.parse(response.text);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    };
  }
}
