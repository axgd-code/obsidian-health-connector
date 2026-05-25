import { getLocale } from '../i18n';

/**
 * Build Obsidian frontmatter YAML with Garmin data properties.
 * 
 * Expected output format:
 * ---
 * date: 2025-12-22
 * steps: 20239
 * sleep: 642
 * weight: 70.5
 * averageHeartRate: 60
 * didRunning: true
 * runningDistance_km: 18.63
 * didSwimming: false
 * SwimmingDistance_km: 0
 * didCycling: false
 * cyclingDistance_km: 0
 * otherActivities: false
 * ---
 */
export function buildGarminFrontmatter(date: Date, data: any): string {
  const d = date.toISOString().slice(0,10);
  let fm = `date: ${d}\n`;
  if (data.steps !== null && data.steps !== undefined) fm += `steps: ${data.steps}\n`;
  if (data.sleep !== null && data.sleep !== undefined) fm += `sleep: ${data.sleep}\n`;
  if (data.sleepScore !== null && data.sleepScore !== undefined) fm += `sleepScore: ${data.sleepScore}\n`;
  if (data.weight !== null && data.weight !== undefined) fm += `weight: ${data.weight}\n`;
  if (data.averageHeartRate !== null && data.averageHeartRate !== undefined) fm += `averageHeartRate: ${data.averageHeartRate}\n`;
  if (data.vo2Max !== null && data.vo2Max !== undefined) fm += `vo2Max: ${data.vo2Max}\n`;
  if (data.hrv !== null && data.hrv !== undefined) fm += `hrv: ${data.hrv}\n`;
  if (data.stress !== null && data.stress !== undefined) fm += `stress: ${data.stress}\n`;
  if (data.bodyBattery !== null && data.bodyBattery !== undefined) fm += `bodyBattery: ${data.bodyBattery}\n`;
  if (data.spO2 !== null && data.spO2 !== undefined) fm += `spO2: ${data.spO2}\n`;
  fm += `didRunning: ${data.didRunning}\n`;
  if (data.runningDistance_km !== null && data.runningDistance_km !== undefined) fm += `runningDistance_km: ${data.runningDistance_km}\n`;
  fm += `didSwimming: ${data.didSwimming}\n`;
  if (data.SwimmingDistance_km !== null && data.SwimmingDistance_km !== undefined) fm += `SwimmingDistance_km: ${data.SwimmingDistance_km}\n`;
  fm += `didCycling: ${data.didCycling}\n`;
  if (data.cyclingDistance_km !== null && data.cyclingDistance_km !== undefined) fm += `cyclingDistance_km: ${data.cyclingDistance_km}\n`;
  fm += `otherActivities: ${data.otherActivities}\n`;
  return fm;
}

export function buildObsidianNote(date: Date, data: any, locale?: string): string {
  const day = date.toISOString().slice(0,10);
  const front = buildGarminFrontmatter(date, data);
  const i18n = getLocale(locale);
  const avgHeartRate = data.averageHeartRate ?? data.avgHeartRate;
  const runningDistance = data.runningDistance_km ?? data.runningDistance;
  const cyclingDistance = data.cyclingDistance_km ?? data.cyclingDistance;
  const swimmingDistance = data.SwimmingDistance_km ?? data.swimmingDistance;
  // human readable body
  const bodyLines = [] as string[];
  bodyLines.push(`# ${i18n.template.title} (${day})`);
  bodyLines.push('');
  bodyLines.push(`- ${i18n.template.steps} : ${data.steps ?? i18n.template.noData}`);
  if (data.weight !== null && data.weight !== undefined) bodyLines.push(`- ${i18n.template.weight} : ${data.weight} kg`);
  if (avgHeartRate !== null && avgHeartRate !== undefined) bodyLines.push(`- ${i18n.template.avgHeartRate} : ${avgHeartRate} bpm`);
  bodyLines.push(`- ${i18n.template.running} : ${data.didRunning}`);
  if (runningDistance) bodyLines.push(`  - ${i18n.template.running} km : ${runningDistance} km`);
  bodyLines.push(`- ${i18n.template.cycling} : ${data.didCycling}`);
  if (cyclingDistance) bodyLines.push(`  - ${i18n.template.cycling} km : ${cyclingDistance} km`);
  bodyLines.push(`- ${i18n.template.swimming} : ${data.didSwimming}`);
  if (swimmingDistance) bodyLines.push(`  - ${i18n.template.swimming} km : ${swimmingDistance} km`);

  return '---\n' + front + '---\n\n' + bodyLines.join('\n') + '\n';
}
