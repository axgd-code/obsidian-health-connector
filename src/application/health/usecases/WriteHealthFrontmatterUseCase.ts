import type { HealthData } from '../../../domain/health/entities/HealthData';
import type { FrontmatterPort, FrontmatterRecord } from '../ports/FrontmatterPort';

export class WriteHealthFrontmatterUseCase<TFile = unknown> {
  private frontmatterPort: FrontmatterPort<TFile>;

  constructor(frontmatterPort: FrontmatterPort<TFile>) {
    this.frontmatterPort = frontmatterPort;
  }

  async execute(file: TFile, date: Date, data: Partial<HealthData> & Record<string, unknown>): Promise<void> {
    await this.frontmatterPort.processFrontmatter(file, (frontmatter) => {
      this.applyDate(frontmatter, date);
      this.applyMetrics(frontmatter, data);
      this.applySports(frontmatter, data);
      this.applyDistances(frontmatter, data);
    });
  }

  private applyDate(frontmatter: FrontmatterRecord, date: Date) {
    frontmatter.date = date.toISOString().slice(0, 10);
  }

  private applyMetrics(frontmatter: FrontmatterRecord, data: Partial<HealthData>) {
    this.set(frontmatter, 'steps', data.steps);
    this.set(frontmatter, 'sleep', data.sleep);
    this.set(frontmatter, 'sleepScore', data.sleepScore);
    this.set(frontmatter, 'weight', data.weight);
    this.set(frontmatter, 'averageHeartRate', data.averageHeartRate);
    this.set(frontmatter, 'hrv', data.hrv);
    this.set(frontmatter, 'stress', data.stress);
    this.set(frontmatter, 'bodyBattery', data.bodyBattery);
    this.set(frontmatter, 'spO2', data.spO2);
  }

  private applySports(frontmatter: FrontmatterRecord, data: Partial<HealthData>) {
    if (!data.sports || data.sports.length === 0) return;

    const incoming = data.sports.map((sport) => String(sport)).filter(Boolean);
    if (incoming.length === 0) return;

    const merged = [...new Set([
      ...this.toSportList(frontmatter.sport),
      ...this.toSportList(frontmatter.sports),
      ...incoming,
    ])];

    frontmatter.sport = merged;
  }

  private applyDistances(frontmatter: FrontmatterRecord, data: Partial<HealthData>) {
    this.set(frontmatter, 'runningDistance_km', data.runningDistance_km);
    this.set(frontmatter, 'SwimmingDistance_km', data.SwimmingDistance_km);
    this.set(frontmatter, 'transport_km', data.transport_km);
  }

  private set(frontmatter: FrontmatterRecord, key: string, value: unknown) {
    if (value !== undefined && value !== null) {
      frontmatter[key] = value;
    }
  }

  private toSportList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }
}
