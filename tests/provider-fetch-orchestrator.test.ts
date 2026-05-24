import { describe, expect, test } from 'vitest';
import { ProviderFetchOrchestrator } from '../src/application/health/services/providerFetchOrchestrator';
import type { IHealthProvider } from '../src/domain/health/ports/IHealthProvider';
import type { HealthData } from '../src/domain/health/entities/HealthData';
import type { ProviderKey } from '../src/application/health/services/providerConfigService';

function makeHealthData(overrides: Partial<HealthData> = {}): HealthData {
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

class FakeProvider implements IHealthProvider {
  private data: HealthData;
  private shouldFailInit: boolean;
  private shouldFailFetch: boolean;

  constructor(data: HealthData, opts?: { failInit?: boolean; failFetch?: boolean }) {
    this.data = data;
    this.shouldFailInit = !!opts?.failInit;
    this.shouldFailFetch = !!opts?.failFetch;
  }

  async init(): Promise<void> {
    if (this.shouldFailInit) {
      throw new Error('InitFailure');
    }
  }

  async getData(): Promise<HealthData> {
    if (this.shouldFailFetch) {
      throw new Error('FetchFailure');
    }
    return this.data;
  }
}

describe('ProviderFetchOrchestrator', () => {
  test('returns empty result when no providers are enabled', async () => {
    const orchestrator = new ProviderFetchOrchestrator({
      getEnabledProviders: () => [],
      buildProviderCredKey: () => '',
      resolveProvider: () => new FakeProvider(makeHealthData()),
      mergeProviderHealthData: () => null,
      logger: { warn: () => {}, error: () => {} },
    });

    const result = await orchestrator.fetch(new Date('2026-05-25'));

    expect(result.data).toBeNull();
    expect(result.successfulProviders).toEqual([]);
    expect(result.attemptedProviders).toEqual([]);
  });

  test('reuses initialized providers while credentials key is unchanged', async () => {
    let resolveCount = 0;
    const providerKeys: ProviderKey[] = ['garmin'];

    const orchestrator = new ProviderFetchOrchestrator({
      getEnabledProviders: () => providerKeys,
      buildProviderCredKey: () => 'same-key',
      resolveProvider: () => {
        resolveCount += 1;
        return new FakeProvider(makeHealthData({ steps: 1234 }));
      },
      mergeProviderHealthData: (entries) => entries[0]?.data ?? null,
      logger: { warn: () => {}, error: () => {} },
    });

    const day = new Date('2026-05-25');
    const first = await orchestrator.fetch(day);
    const second = await orchestrator.fetch(day);

    expect(first.data?.steps).toBe(1234);
    expect(second.data?.steps).toBe(1234);
    expect(resolveCount).toBe(1);
  });

  test('rebuilds provider service when credentials key changes', async () => {
    let resolveCount = 0;
    let credVersion = 1;

    const orchestrator = new ProviderFetchOrchestrator({
      getEnabledProviders: () => ['garmin'],
      buildProviderCredKey: () => `cred-${credVersion}`,
      resolveProvider: () => {
        resolveCount += 1;
        return new FakeProvider(makeHealthData({ steps: 2000 + resolveCount }));
      },
      mergeProviderHealthData: (entries) => entries[0]?.data ?? null,
      logger: { warn: () => {}, error: () => {} },
    });

    await orchestrator.fetch(new Date('2026-05-25'));
    credVersion = 2;
    const refreshed = await orchestrator.fetch(new Date('2026-05-25'));

    expect(resolveCount).toBe(2);
    expect(refreshed.data?.steps).toBe(2002);
  });

  test('skips failed providers and keeps successful ones', async () => {
    const loggerCalls: string[] = [];

    const orchestrator = new ProviderFetchOrchestrator({
      getEnabledProviders: () => ['garmin', 'strava'],
      buildProviderCredKey: (key) => `k-${key}`,
      resolveProvider: (key) => {
        if (key === 'garmin') {
          return new FakeProvider(makeHealthData({ steps: 3210 }), { failFetch: true });
        }
        return new FakeProvider(makeHealthData({ steps: 7890 }));
      },
      mergeProviderHealthData: (entries) => entries[0]?.data ?? null,
      logger: {
        warn: (message: string) => loggerCalls.push(message),
        error: () => {},
      },
    });

    const result = await orchestrator.fetch(new Date('2026-05-25'));

    expect(result.successfulProviders).toEqual(['strava']);
    expect(result.data?.steps).toBe(7890);
    expect(loggerCalls.some((msg) => msg.includes('failed to fetch data'))).toBe(true);
  });
});
