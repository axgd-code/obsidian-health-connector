import * as GarminConnectModule from 'garmin-connect';
import { logger } from '../common/Logger';
import type { HealthData } from '../types/health';
import type { IHealthProvider } from './IHealthProvider';

const { GarminConnect } = GarminConnectModule as any;

// Transport activity types (cycling + walking) → counted as transport, not sport
const GARMIN_TRANSPORT_RE = /\bcycl|biking|bike\b|bicycle|velomobile|handcycle|e.bike|\bwalk(ing)?\b|indoor.?walk|casual.?walk|speed.?walk|race.?walk|commute.?walk/;

// Ordered map of sport emoji by activity keyword
const GARMIN_SPORT_EMOJI: Array<{ re: RegExp; emoji: string }> = [
  { re: /\brun|trail.?run|treadmill|indoor.?run|track.?run|virtual.?run/, emoji: '\uD83C\uDFC3' },
  { re: /\bswim/, emoji: '\uD83C\uDFCA' },
  { re: /\bhik|backcountry.?hik|raquette/, emoji: '\uD83E\uDD7E' },
  { re: /\bstrength|gym\b|fitness.?equip|crossfit|weight.?train|bouldering|climbing/, emoji: '\uD83C\uDFCB\uFE0F' },
  { re: /\byoga|pilates|meditation/, emoji: '\uD83E\uDDD8' },
  { re: /\brow|kayak|paddl|canoe/, emoji: '\uD83D\uDEA3' },
  { re: /\btennis|squash|badminton|racquet|pickleball|padel/, emoji: '\uD83C\uDFBE' },
  { re: /\bgolf/, emoji: '\u26F3' },
  { re: /\bski|snowboard|nordic.?ski/, emoji: '\u26F7\uFE0F' },
  { re: /\bsoccer|football\b|basketball|volleyball|hockey|rugby/, emoji: '\u26BD' },
];

function getGarminSportEmoji(lower: string): string {
  for (const { re, emoji } of GARMIN_SPORT_EMOJI) {
    if (re.test(lower)) return emoji;
  }
  return '\uD83C\uDFC5'; // 🏅 generic
}

function extractDistanceFromActivity(activity: any): number | null {
  if (!activity) return null;
  const keys = ['distance', 'activityDistance', 'totalDistance', 'distanceMeters', 'activityDistanceInMeters', 'distanceInMeters', 'totalDistanceInMeters'];
  for (const k of keys) {
    const v = activity[k];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  if (activity.activitySummary && activity.activitySummary.distance) {
    const n = Number(activity.activitySummary.distance);
    if (!isNaN(n)) return n;
  }
  try {
    const s = JSON.stringify(activity);
    const m = s.match(/"distance"\s*:\s*(\d+(?:\.\d+)?)/i);
    if (m && m[1]) return Number(m[1]);
  } catch (e) {}
  return null;
}

function metersToKm(m: number | null): number | null {
  if (m === null || m === undefined) return null;
  return Number((m / 1000).toFixed(2));
}

export class GarminProvider implements IHealthProvider {
  public client: any;
  private username: string;
  private password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
    this.client = null;
  }

  async init() {
    if (this.client) return;
    this.client = new GarminConnect(
      { username: this.username, password: this.password } as any,
      'garmin.com',
      { httpClientConfig: { logLevel: 'error' } }
    );
    await this.client.login();
  }

  async getData(date: Date): Promise<HealthData> {
    logger.debug('📍 GarminProvider.getData() called with date:', date);
    const targetDate = date;
    const steps = await this.client.getSteps(targetDate).catch(() => null);
    logger.debug('👣 getSteps result:', steps);

    const weightData = await this.client.getWeight(targetDate).catch(() => null);
    const heartRate = await this.client.getHeartRate(targetDate).catch(() => null);
    const sleepData = await this.client.getSleep(targetDate).catch(() => null);

    logger.debug('⚖️ getWeight result:', JSON.stringify(weightData, null, 2));

    let weight: number | null = null;
    try {
      const w = weightData as any;
      if (w && w.weight) {
        weight = Number(w.weight);
      } else if (w && w.weightInGrams) {
        weight = Number(w.weightInGrams) / 1000;
      } else if (w && w.value) {
        weight = Number(w.value);
      } else if (w && typeof w === 'number') {
        weight = w;
      }
      if (weight !== null && isNaN(weight)) weight = null;
    } catch (e) {
      logger.error('Weight extraction error:', e);
      weight = null;
    }

    logger.debug('❤️ getHeartRate result:', heartRate);

    let avgHeartRate: number | null = null;
    try {
      const hrAny = heartRate as any;
      if (hrAny) {
        if (hrAny.restingHeartRate) avgHeartRate = Number(hrAny.restingHeartRate);
        else if (hrAny.average) avgHeartRate = Number(hrAny.average);
        else if (hrAny.avg) avgHeartRate = Number(hrAny.avg);
      }
      if (avgHeartRate !== null && isNaN(avgHeartRate)) avgHeartRate = null;
    } catch (e) { avgHeartRate = null; }

    const sportsSet = new Set<string>();
    let transportKm = 0;
    let didRunning = false, runningDistance: number | null = null;
    let didSwimming = false, swimmingDistance: number | null = null;
    let didCycling = false;
    try {
      const activities = await this.client.getActivities(0, 100).catch(() => null);
      if (activities && Array.isArray(activities)) {
        const targetDay = targetDate.toISOString().slice(0, 10);
        const todays = activities.filter((a: any) => {
          const s = a.startTimeLocal || a.startTimeGMT || a.startTime;
          if (!s) return false;
          return s.slice(0, 10) === targetDay;
        });
        for (const a of todays) {
          const lower = JSON.stringify(a).toLowerCase();
          const dist = extractDistanceFromActivity(a);
          const distKm = dist != null ? metersToKm(dist) : null;

          if (GARMIN_TRANSPORT_RE.test(lower)) {
            // Cycling / walking → transport, not sport
            didCycling = lower.includes('cycl') || lower.includes('bik');
            transportKm = Number((transportKm + (distKm ?? 0)).toFixed(2));
          } else {
            // Sport activity
            sportsSet.add(getGarminSportEmoji(lower));
            if (/\brun|trail.?run|treadmill|indoor.?run/.test(lower)) {
              didRunning = true;
              runningDistance = Number(((runningDistance ?? 0) + (distKm ?? 0)).toFixed(2));
            }
            if (/\bswim/.test(lower)) {
              didSwimming = true;
              swimmingDistance = Number(((swimmingDistance ?? 0) + (distKm ?? 0)).toFixed(2));
            }
          }
        }
      }
    } catch (e) {}

    let sleepMinutes: number | null = null;
    let sleepScore: number | null = null;
    try {
      if (sleepData && sleepData.dailySleepDTO) {
        const dto = sleepData.dailySleepDTO;
        if (dto.sleepTimeSeconds) {
          sleepMinutes = Math.round(dto.sleepTimeSeconds / 60);
        }
        if (dto.sleepScores?.overall?.value) {
          sleepScore = dto.sleepScores.overall.value;
        }
        logger.debug('🛏️ Sleep data:', {
          minutes: sleepMinutes,
          score: sleepScore,
          deepMin: Math.round((dto.deepSleepSeconds || 0) / 60),
          lightMin: Math.round((dto.lightSleepSeconds || 0) / 60),
          remMin: Math.round((dto.remSleepSeconds || 0) / 60)
        });
      }
    } catch (e) {
      sleepMinutes = null;
      sleepScore = null;
    }

    const otherActivities = false;

    return {
      steps: steps ?? null,
      weight,
      averageHeartRate: avgHeartRate,
      sleep: sleepMinutes,
      sleepScore,
      sports: [...sportsSet],
      transport_km: transportKm > 0 ? transportKm : null,
      didRunning,
      runningDistance_km: runningDistance,
      didSwimming,
      SwimmingDistance_km: swimmingDistance,
      didCycling,
      cyclingDistance_km: transportKm > 0 ? transportKm : null,
      otherActivities,
    };
  }
}
