import type { HealthData } from '../types/health';

export interface IHealthProvider {
  init(): Promise<void>;
  getData(date: Date): Promise<HealthData>;
}
