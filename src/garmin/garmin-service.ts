import type { HealthData } from "../types/health";
import { GarminProvider } from "../providers/GarminProvider";

// Backward-compat wrapper to keep tests and existing imports working
export class GarminService {
  private provider: GarminProvider;

  constructor(username: string, password: string) {
    this.provider = new GarminProvider(username, password);
  }

  async init() {
    await this.provider.init();
  }

  async getData(date: Date): Promise<HealthData> {
    return this.provider.getData(date);
  }

  // For test compatibility: allow overriding the underlying client
  get client(): any {
    return this.provider.client;
  }
  set client(c: any) {
    this.provider.client = c;
  }
}
