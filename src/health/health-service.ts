import type { IHealthProvider } from '../providers/IHealthProvider';
import type { HealthData } from '../types/health';

export class HealthService {
  private provider: IHealthProvider;

  constructor(provider: IHealthProvider) {
    this.provider = provider;
  }

  async init() {
    await this.provider.init();
  }

  async getData(date: Date): Promise<HealthData> {
    return this.provider.getData(date);
  }
}
