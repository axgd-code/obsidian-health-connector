import type { HealthData } from '../../../domain/health/entities/HealthData';

export function buildHealthNoteContent(date: Date, data: HealthData | null): string {
  const dateStr = date.toISOString().slice(0, 10);
  const yv = (v: unknown) => (v !== null && v !== undefined) ? String(v) : '""';
  const sportYaml = data?.sports && data.sports.length > 0
    ? '\n  - ' + data.sports.join('\n  - ')
    : ' []';

  return [
    '---',
    `date: "${dateStr}"`,
    `weight: ${yv(data?.weight)}`,
    `steps: ${yv(data?.steps)}`,
    `sports:${sportYaml}`,
    `sleep: ${yv(data?.sleep)}`,
    `sleepScore: ${yv(data?.sleepScore)}`,
    `averageHeartRate: ${yv(data?.averageHeartRate)}`,
    `vo2Max: ${yv(data?.vo2Max)}`,
    `hrv: ${yv(data?.hrv)}`,
    `stress: ${yv(data?.stress)}`,
    `bodyBattery: ${yv(data?.bodyBattery)}`,
    `spO2: ${yv(data?.spO2)}`,
    `transport_km: ${yv(data?.transport_km)}`
  ].join('\n');
}
