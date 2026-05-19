import { buildObsidianNote, buildGarminFrontmatter } from "../src/config/template";

describe('template', () => {
  test('frontmatter contains requested keys', () => {
    const date = new Date('2025-12-24');
    const data = {
      steps: 20239,
      sleep: 642,
      weight: 70.5,
      averageHeartRate: 60,
      didRunning: true,
      runningDistance_km: 18.63,
      didCycling: false,
      cyclingDistance_km: null,
      didSwimming: false,
      SwimmingDistance_km: null,
      otherActivities: false,
    };

    const fm = buildGarminFrontmatter(date, data);
    expect(fm).not.toContain('garmin:');
    expect(fm).toContain('steps: 20239');
    expect(fm).toContain('sleep: 642');
    expect(fm).toContain('weight: 70.5');
    expect(fm).toContain('averageHeartRate: 60');
    expect(fm).toContain('didRunning: true');
    expect(fm).toContain('runningDistance_km: 18.63');
    expect(fm).toContain('didCycling: false');
    expect(fm).toContain('didSwimming: false');
    expect(fm).toContain('otherActivities: false');
  });

  test('note body includes human readable lines', () => {
    const date = new Date('2025-12-24');
    const data = { steps: 0, sleep: 480, weight: null, averageHeartRate: null, didRunning: false, didCycling: false, didSwimming: false, otherActivities: false };
    const note = buildObsidianNote(date, data as any, 'fr');
    expect(note).toContain('# Statistiques Santé (2025-12-24)');
    expect(note).toContain('- Pas : 0');
  });
});
