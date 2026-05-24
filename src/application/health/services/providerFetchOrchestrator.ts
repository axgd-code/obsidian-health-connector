import type { HealthData } from '../../../domain/health/entities/HealthData';
import { HealthService } from '../../../domain/health/services/HealthService';
import type { IHealthProvider } from '../../../domain/health/ports/IHealthProvider';
import type { ProviderKey } from './providerConfigService';

export interface FetchHealthDataResult {
  data: HealthData | null;
  successfulProviders: ProviderKey[];
  attemptedProviders: ProviderKey[];
}

interface LoggerLike {
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

interface ProviderFetchOrchestratorDeps {
  getEnabledProviders: () => ProviderKey[];
  buildProviderCredKey: (key: ProviderKey) => string;
  resolveProvider: (key: ProviderKey) => IHealthProvider;
  mergeProviderHealthData: (entries: Array<{ key: ProviderKey; data: HealthData }>) => HealthData | null;
  logger: LoggerLike;
}

export class ProviderFetchOrchestrator {
  private deps: ProviderFetchOrchestratorDeps;
  private healthServices = new Map<ProviderKey, HealthService>();
  private healthServiceCredKeys = new Map<ProviderKey, string>();

  constructor(deps: ProviderFetchOrchestratorDeps) {
    this.deps = deps;
  }

  clearCache() {
    this.healthServices.clear();
    this.healthServiceCredKeys.clear();
  }

  async fetch(date: Date): Promise<FetchHealthDataResult> {
    const enabledProviders = this.deps.getEnabledProviders();
    if (enabledProviders.length === 0) {
      return { data: null, successfulProviders: [], attemptedProviders: [] };
    }

    const services: Array<{ key: ProviderKey; service: HealthService }> = [];
    const attemptedProviders = [...enabledProviders];

    try {
      for (const key of enabledProviders) {
        const credKey = this.deps.buildProviderCredKey(key);
        const existingService = this.healthServices.get(key);
        const existingCredKey = this.healthServiceCredKeys.get(key);

        if (!existingService || existingCredKey !== credKey) {
          try {
            const provider = this.deps.resolveProvider(key);
            const service = new HealthService(provider);
            await service.init();
            this.healthServices.set(key, service);
            this.healthServiceCredKeys.set(key, credKey);
            services.push({ key, service });
          } catch (e) {
            this.deps.logger.warn(`Provider ${key} initialization failed:`, e);
          }
          continue;
        }

        services.push({ key, service: existingService });
      }

      if (services.length === 0) {
        return { data: null, successfulProviders: [], attemptedProviders };
      }

      const successfulProviders: ProviderKey[] = [];
      const fetched = await Promise.all(
        services.map(async ({ key, service }) => {
          try {
            const data = await service.getData(date);
            successfulProviders.push(key);
            return { key, data };
          } catch (e) {
            this.deps.logger.warn(`Provider ${key} failed to fetch data:`, e);
            return null;
          }
        }),
      );

      return {
        data: this.deps.mergeProviderHealthData(
          fetched.filter((entry): entry is { key: ProviderKey; data: HealthData } => entry !== null),
        ),
        successfulProviders,
        attemptedProviders,
      };
    } catch (e: any) {
      if (e?.message === 'InteractiveAuthRequired') {
        return { data: null, successfulProviders: [], attemptedProviders };
      }
      this.clearCache();
      this.deps.logger.error('fetchHealthData failed:', e);
      return { data: null, successfulProviders: [], attemptedProviders };
    }
  }
}
