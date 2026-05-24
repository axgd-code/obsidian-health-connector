import { describe, expect, test } from 'vitest';
import { mergeProviderHealthData, type ProviderHealthDataEntry } from '../src/common/mergeHealthData';
import type { HealthData } from '../src/types/health';

function makeHealthData(overrides: Partial<HealthData>): HealthData {
  return {
    steps: null,
    weight: null,
    averageHeartRate: null,
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
    ...overrides,
  };
}

describe('mergeProviderHealthData', () => {
  test('prefers Garmin average heart rate over Strava when both are available', () => {
    const entries: ProviderHealthDataEntry[] = [
      { key: 'strava', data: makeHealthData({ averageHeartRate: 154 }) },
      { key: 'garmin', data: makeHealthData({ averageHeartRate: 62 }) },
    ];

    const merged = mergeProviderHealthData(entries);

    expect(merged?.averageHeartRate).toBe(62);
  });

  test('falls back to non-Garmin average heart rate when Garmin has no value', () => {
    const entries: ProviderHealthDataEntry[] = [
      { key: 'garmin', data: makeHealthData({ averageHeartRate: null }) },
      { key: 'strava', data: makeHealthData({ averageHeartRate: 148 }) },
    ];

    const merged = mergeProviderHealthData(entries);

    expect(merged?.averageHeartRate).toBe(148);
  });
});