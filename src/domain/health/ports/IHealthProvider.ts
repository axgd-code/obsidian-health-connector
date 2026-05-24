import type { HealthData } from '../entities/HealthData';

export interface IHealthProvider {
  init(): Promise<void>;
  getData(date: Date): Promise<HealthData>;
}
