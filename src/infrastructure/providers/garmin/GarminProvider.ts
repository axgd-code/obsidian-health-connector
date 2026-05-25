import * as GarminConnectModule from 'garmin-connect-obsidian';
import { logger } from '../../../shared/logging/Logger';
import type { HealthData } from '../../../domain/health/entities/HealthData';
import type { IHealthProvider } from './IHealthProvider';

const { GarminConnect } = GarminConnectModule as any;

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

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseGarminSleepMetrics(rawSleep: any): { sleepMinutes: number | null; sleepScore: number | null; endDate: string | null } {
  const dto = rawSleep?.dailySleepDTO;
  if (!dto) {
    return { sleepMinutes: null, sleepScore: null, endDate: null };
  }

  const sleepTimeSeconds = toNumberOrNull(dto.sleepTimeSeconds);
  const sleepMinutes = sleepTimeSeconds !== null ? Math.round(sleepTimeSeconds / 60) : null;

  const sleepScore =
    toNumberOrNull(dto.sleepScores?.overall?.value) ??
    toNumberOrNull(dto.sleepScores?.overallScore) ??
    toNumberOrNull(dto.overallSleepScore);

  const endTimestamp = String(dto.sleepEndTimestampLocal || dto.sleepEndTimestampGMT || '').trim();
  const endDate = endTimestamp.length >= 10 ? endTimestamp.slice(0, 10) : null;

  return {
    sleepMinutes,
    sleepScore,
    endDate,
  };
}

function extractActivityStress(activity: any): number | null {
  const candidates = [
    activity?.avgStress,
    activity?.summaryDTO?.avgStress,
    activity?.startStress,
    activity?.endStress,
    activity?.maxStress,
  ];

  for (const candidate of candidates) {
    const value = toNumberOrNull(candidate);
    if (value !== null) return value;
  }

  return null;
}

function extractActivityVo2Max(activity: any): number | null {
  const candidates = [
    activity?.vO2MaxValue,
    activity?.vo2MaxValue,
    activity?.summaryDTO?.vO2MaxValue,
    activity?.summaryDTO?.vo2MaxValue,
  ];

  for (const candidate of candidates) {
    const value = toNumberOrNull(candidate);
    if (value !== null) return value;
  }

  return null;
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
    this.client = new GarminConnect({ username: this.username, password: this.password } as any);
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

    let didRunning = false, runningDistance: number | null = null;
    let didSwimming = false, swimmingDistance: number | null = null;
    let didCycling = false, cyclingDistance: number | null = null;
    let activityStress: number | null = null;
    let activityVo2Max: number | null = null;
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

          if (activityStress === null) {
            activityStress = extractActivityStress(a);
          }

          if (activityVo2Max === null) {
            activityVo2Max = extractActivityVo2Max(a);
          }

          if (!didRunning && /run|running/.test(lower)) {
            didRunning = true;
            if (dist != null) runningDistance = metersToKm(dist);
          }
          if (!didSwimming && /swim|swimming/.test(lower)) {
            didSwimming = true;
            if (dist != null) swimmingDistance = metersToKm(dist);
          }
          if (!didCycling && /bike|cycling|cycle|bicycle/.test(lower)) {
            didCycling = true;
            if (dist != null) cyclingDistance = metersToKm(dist);
          }
        }
      }
    } catch (e) {}

    let sleepMinutes: number | null = null;
    let sleepScore: number | null = null;
    const targetDay = targetDate.toISOString().slice(0, 10);
    const previousDate = new Date(targetDate);
    previousDate.setDate(previousDate.getDate() - 1);
    try {
      const todaySleep = parseGarminSleepMetrics(sleepData);
      let chosenSleep = todaySleep;

      // Garmin sleep often belongs to the previous evening but ends on the target day.
      if (todaySleep.sleepScore === null || todaySleep.sleepMinutes === null || todaySleep.endDate !== targetDay) {
        const previousSleepRaw = await this.client.getSleep(previousDate).catch(() => null);
        const previousSleep = parseGarminSleepMetrics(previousSleepRaw);

        if (previousSleep.endDate === targetDay && (previousSleep.sleepScore !== null || previousSleep.sleepMinutes !== null)) {
          chosenSleep = {
            sleepMinutes: previousSleep.sleepMinutes ?? todaySleep.sleepMinutes,
            sleepScore: previousSleep.sleepScore ?? todaySleep.sleepScore,
            endDate: previousSleep.endDate,
          };
        }
      }

      sleepMinutes = chosenSleep.sleepMinutes;
      sleepScore = chosenSleep.sleepScore;

      // Fallback to dedicated duration endpoint when sleep payload has no duration.
      if (sleepMinutes === null) {
        const todayDuration = toNumberOrNull(await this.client.getSleepDuration?.(targetDate).catch(() => null));
        const previousDuration =
          todayDuration === null
            ? toNumberOrNull(await this.client.getSleepDuration?.(previousDate).catch(() => null))
            : null;
        const resolvedDuration = todayDuration ?? previousDuration;
        if (resolvedDuration !== null) {
          sleepMinutes = Math.round(resolvedDuration);
        }
      }

      logger.debug('🛏️ Sleep data:', {
        targetDay,
        sleepMinutes,
        sleepScore,
        sleepEndDate: chosenSleep.endDate,
      });
    } catch (e) {
      sleepMinutes = null;
      sleepScore = null;
    }

    // Optional Garmin metrics (availability depends on account/device/API capabilities)
    let vo2Max: number | null = null;
    let hrv: number | null = null;
    let stress: number | null = null;
    let bodyBattery: number | null = null;
    let spO2: number | null = null;

    try {
      stress = activityStress;
    } catch {}

    try {
      vo2Max = activityVo2Max;
      if (vo2Max === null) {
        const profile = await this.client.getUserProfile?.().catch(() => null);
        const profileVo2 =
          toNumberOrNull(profile?.userData?.vo2MaxRunning) ??
          toNumberOrNull(profile?.userData?.vo2MaxCycling) ??
          toNumberOrNull(profile?.vo2MaxRunning) ??
          toNumberOrNull(profile?.vo2MaxCycling);
        vo2Max = profileVo2;
      }
    } catch {}

    try {
      const bodyBatteryData = await this.client.getBodyBattery?.(targetDate).catch(() => null);
      const bbAny = bodyBatteryData as any;
      const bbVal = bbAny?.mostRecentValue ?? bbAny?.average ?? bbAny?.bodyBattery;
      if (bbVal !== undefined && bbVal !== null && !isNaN(Number(bbVal))) {
        bodyBattery = Number(bbVal);
      }
    } catch {}

    try {
      const pulseOxData = await this.client.getPulseOx?.(targetDate).catch(() => null);
      const poAny = pulseOxData as any;
      const poVal = poAny?.average ?? poAny?.averageSpo2 ?? poAny?.spo2;
      if (poVal !== undefined && poVal !== null && !isNaN(Number(poVal))) {
        spO2 = Number(poVal);
      }
    } catch {}

    try {
      const hrvData = await this.client.getHrv?.(targetDate).catch(() => null);
      const hrvAny = hrvData as any;
      const hrvVal = hrvAny?.dailyAverage ?? hrvAny?.average ?? hrvAny?.hrv;
      if (hrvVal !== undefined && hrvVal !== null && !isNaN(Number(hrvVal))) {
        hrv = Number(hrvVal);
      }
    } catch {}

    const otherActivities = false;

    return {
      steps: steps ?? null,
      weight,
      averageHeartRate: avgHeartRate,
      vo2Max,
      hrv,
      stress,
      bodyBattery,
      spO2,
      sleep: sleepMinutes,
      sleepScore,
      sports: [],
      transport_km: cyclingDistance,
      didRunning,
      runningDistance_km: runningDistance,
      didSwimming,
      SwimmingDistance_km: swimmingDistance,
      didCycling,
      cyclingDistance_km: cyclingDistance,
      otherActivities,
    };
  }
}
