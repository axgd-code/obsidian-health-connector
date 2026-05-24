import { logger } from '../../../shared/logging/Logger';
import type { HealthData } from '../../../domain/health/entities/HealthData';
import type { IHealthProvider } from '../../../domain/health/ports/IHealthProvider';

// Import requestUrl from Obsidian (with fallback for tests/Node)
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

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

// Sport type sets from Strava's SportType enum
const RUNNING_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
// Cycling + walking → transport (not sport)
const TRANSPORT_TYPES = new Set([
  'Ride', 'MountainBikeRide', 'GravelRide', 'VirtualRide',
  'EBikeRide', 'EMountainBikeRide', 'Handcycle', 'Velomobile',
  'Walk', 'VirtualWalk',
]);
const SWIMMING_TYPES = new Set(['Swim']);

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix epoch seconds
}

export class StravaProvider implements IHealthProvider {
  private clientId: string;
  private clientSecret: string;
  private tokens: StravaTokens;
  private onTokensUpdated: (tokens: StravaTokens) => Promise<void>;

  constructor(
    clientId: string,
    clientSecret: string,
    tokens: StravaTokens,
    onTokensUpdated: (tokens: StravaTokens) => Promise<void>,
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = tokens;
    this.onTokensUpdated = onTokensUpdated;
  }

  async init(): Promise<void> {
    await this.ensureValidToken();
  }

  private async ensureValidToken(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokens.accessToken && this.tokens.expiresAt > now + 300) {
      logger.debug('♻️ Strava access token still valid');
      return;
    }

    if (!this.tokens.refreshToken) {
      throw new Error('StravaNotConnected');
    }

    logger.info('🔄 Refreshing Strava access token...');

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    }).toString();

    const response = await requestUrl({
      url: STRAVA_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (response.status !== 200) {
      throw new Error(`Strava token refresh failed: HTTP ${response.status}`);
    }

    const data = response.json ?? JSON.parse(response.text);
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };

    await this.onTokensUpdated(this.tokens);
    logger.info('✅ Strava token refreshed successfully');
  }

  async getData(date: Date): Promise<HealthData> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const after = Math.floor(startOfDay.getTime() / 1000);
    const before = Math.floor(endOfDay.getTime() / 1000);

    const url = `${STRAVA_BASE}/athlete/activities?after=${after}&before=${before}&per_page=100`;

    logger.debug('📡 Fetching Strava activities for', date.toISOString().slice(0, 10));

    const response = await requestUrl({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    });

    if (response.status !== 200) {
      throw new Error(`Strava activities fetch failed: HTTP ${response.status}`);
    }

    const activities: any[] = response.json ?? JSON.parse(response.text);
    logger.debug(`📊 Strava returned ${activities.length} activities`);

    const sportsSet = new Set<string>();
    let transportKm = 0;
    let didRunning = false;
    let runningDistance_km: number | null = null;
    let didSwimming = false;
    let SwimmingDistance_km: number | null = null;
    let didCycling = false;
    let otherActivities = false;
    let heartRateSum = 0;
    let heartRateCount = 0;

    for (const activity of activities) {
      const sportType: string = activity.sport_type || activity.type || '';
      const distanceM: number = activity.distance ?? 0;
      const distanceKm = distanceM > 0 ? Number((distanceM / 1000).toFixed(2)) : null;

      if (TRANSPORT_TYPES.has(sportType)) {
        // Cycling / walking → transport, not sport
        didCycling = sportType.toLowerCase().includes('ride') || sportType.toLowerCase().includes('cycl') || sportType.toLowerCase().includes('bike');
        transportKm = Number((transportKm + (distanceKm ?? 0)).toFixed(2));
      } else if (RUNNING_TYPES.has(sportType)) {
        didRunning = true;
        sportsSet.add('\uD83C\uDFC3');
        runningDistance_km = runningDistance_km !== null
          ? Number((runningDistance_km + (distanceKm ?? 0)).toFixed(2))
          : (distanceKm ?? 0);
      } else if (SWIMMING_TYPES.has(sportType)) {
        didSwimming = true;
        sportsSet.add('\uD83C\uDFCA');
        SwimmingDistance_km = SwimmingDistance_km !== null
          ? Number((SwimmingDistance_km + (distanceKm ?? 0)).toFixed(2))
          : (distanceKm ?? 0);
      } else {
        otherActivities = true;
        sportsSet.add('\uD83C\uDFC5');
      }

      if (activity.has_heartrate && activity.average_heartrate) {
        heartRateSum += activity.average_heartrate;
        heartRateCount++;
      }
    }

    const averageHeartRate = heartRateCount > 0
      ? Math.round(heartRateSum / heartRateCount)
      : null;

    return {
      steps: null,
      weight: null,
      averageHeartRate,
      hrv: null,
      stress: null,
      bodyBattery: null,
      spO2: null,
      sleep: null,
      sleepScore: null,
      sports: [...sportsSet],
      transport_km: transportKm > 0 ? transportKm : null,
      didRunning,
      runningDistance_km,
      didSwimming,
      SwimmingDistance_km,
      didCycling,
      cyclingDistance_km: transportKm > 0 ? transportKm : null,
      otherActivities,
    };
  }

  /** Exchange an authorization code for tokens (one-time, during OAuth setup) */
  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
  ): Promise<StravaTokens> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }).toString();

    const response = await requestUrl({
      url: STRAVA_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (response.status !== 200) {
      throw new Error(`Strava code exchange failed: HTTP ${response.status}`);
    }

    const data = response.json ?? JSON.parse(response.text);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };
  }
}
