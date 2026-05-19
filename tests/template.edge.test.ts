import { buildGarminFrontmatter, buildObsidianNote } from "../src/config/template";

describe('template edge cases', () => {
  test('handles null and undefined values', () => {
    const date = new Date('2025-12-24');
    const data: any = {
      steps: null,
      sleep: null,
      weight: undefined,
      averageHeartRate: null,
      didRunning: false,
      runningDistance_km: null,
      didCycling: false,
      cyclingDistance_km: undefined,
      didSwimming: false,
      SwimmingDistance_km: null,
      otherActivities: false,
    };

    const fm = buildGarminFrontmatter(date, data);
    // should include date and boolean flags (flat keys)
    expect(fm).not.toContain('garmin:');
    expect(fm).toContain('didRunning: false');
    expect(fm).toContain('didCycling: false');
    expect(fm).toContain('didSwimming: false');
    expect(fm).toContain('otherActivities: false');

    const note = buildObsidianNote(date, data);
    expect(note).toContain('# Health Stats (2025-12-24)'); // default English
    expect(note).toContain('- Steps : N/A'); // default English
  });
});
