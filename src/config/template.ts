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
  // human readable body
  const bodyLines = [] as string[];
  bodyLines.push(`# ${i18n.template.title} (${day})`);
  bodyLines.push('');
  bodyLines.push(`- ${i18n.template.steps} : ${data.steps ?? i18n.template.noData}`);
  if (data.weight !== null && data.weight !== undefined) bodyLines.push(`- ${i18n.template.weight} : ${data.weight} kg`);
  if (data.avgHeartRate !== null && data.avgHeartRate !== undefined) bodyLines.push(`- ${i18n.template.avgHeartRate} : ${data.avgHeartRate} bpm`);
  bodyLines.push(`- ${i18n.template.running} : ${data.didRunning}`);
  if (data.runningDistance) bodyLines.push(`  - ${i18n.template.running} km : ${data.runningDistance} km`);
  bodyLines.push(`- ${i18n.template.cycling} : ${data.didCycling}`);
  if (data.cyclingDistance) bodyLines.push(`  - ${i18n.template.cycling} km : ${data.cyclingDistance} km`);
  bodyLines.push(`- ${i18n.template.swimming} : ${data.didSwimming}`);
  if (data.swimmingDistance) bodyLines.push(`  - ${i18n.template.swimming} km : ${data.swimmingDistance} km`);

  return '---\n' + front + '---\n\n' + bodyLines.join('\n') + '\n';
}
