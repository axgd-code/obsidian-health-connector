import type { HealthData } from '../types/health';

export type HealthProviderKey = 'garmin' | 'strava' | 'google';

export interface ProviderHealthDataEntry {
  key: HealthProviderKey;
  data: HealthData;
}

const maxNullable = (values: Array<number | null | undefined>): number | null => {
  const present = values.filter((value): value is number => value !== null && value !== undefined);
  if (present.length === 0) return null;
  return Number(Math.max(...present).toFixed(2));
};

function pickAverageHeartRate(entries: ProviderHealthDataEntry[]): number | null {
  const garminAverageHeartRate = entries.find((entry) => entry.key === 'garmin' && entry.data.averageHeartRate !== null)
    ?.data.averageHeartRate;

  if (garminAverageHeartRate !== undefined && garminAverageHeartRate !== null) {
    return garminAverageHeartRate;
  }

  return maxNullable(entries.map((entry) => entry.data.averageHeartRate));
}

export function mergeProviderHealthData(entries: ProviderHealthDataEntry[]): HealthData | null {
  if (entries.length === 0) return null;

  const allData = entries.map((entry) => entry.data);
  const sports = [...new Set(allData.flatMap((data) => data.sports ?? []))];

  return {
    steps: maxNullable(allData.map((data) => data.steps)),
    weight: maxNullable(allData.map((data) => data.weight)),
    averageHeartRate: pickAverageHeartRate(entries),
    hrv: maxNullable(allData.map((data) => data.hrv)),
    stress: maxNullable(allData.map((data) => data.stress)),
    bodyBattery: maxNullable(allData.map((data) => data.bodyBattery)),
    spO2: maxNullable(allData.map((data) => data.spO2)),
    sleep: maxNullable(allData.map((data) => data.sleep)),
    sleepScore: maxNullable(allData.map((data) => data.sleepScore)),
    sports,
    transport_km: maxNullable(allData.map((data) => data.transport_km)),
    didRunning: allData.some((data) => data.didRunning),
    runningDistance_km: maxNullable(allData.map((data) => data.runningDistance_km)),
    didSwimming: allData.some((data) => data.didSwimming),
    SwimmingDistance_km: maxNullable(allData.map((data) => data.SwimmingDistance_km)),
    didCycling: allData.some((data) => data.didCycling),
    cyclingDistance_km: maxNullable(allData.map((data) => data.cyclingDistance_km)),
    otherActivities: allData.some((data) => data.otherActivities),
  };
}