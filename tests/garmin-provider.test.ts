import { GarminProvider } from "../src/infrastructure/providers/garmin/GarminProvider";

describe('GarminProvider', () => {
  test('getData returns mapped fields when client methods exist', async () => {
    const provider = new GarminProvider('u','p');
    // mock client with necessary methods
    provider.client = {
      getSteps: async (_d: Date) => 2000,
      getWeight: async (_d: Date) => ({ weight: 72 }),
      getHeartRate: async (_d: Date) => ({ average: 58 }),
      getSleep: async (_d: Date) => ({ dailySleepDTO: { sleepTimeSeconds: 3600 } }),
      getActivities: async (_start: number, _limit: number) => [
        { startTimeLocal: '2025-12-24T07:00:00', activityType: 'running', distance: 5000 },
        { startTimeLocal: '2025-12-24T12:00:00', activityType: 'cycling', distance: 20000 }
      ]
    } as any;

    const data = await provider.getData(new Date('2025-12-24'));
    expect(data.steps).toBe(2000);
    expect(data.weight).toBe(72);
    expect(data.averageHeartRate).toBe(58);
    expect(data.sleep).toBe(60);
    expect(data.didRunning).toBe(true);
    expect(data.runningDistance_km).toBeCloseTo(5.00, 2);
    expect(data.didCycling).toBe(true);
    expect(data.cyclingDistance_km).toBeCloseTo(20.00, 2);
  });

  test('getData handles missing values gracefully', async () => {
    const provider = new GarminProvider('u','p');
    provider.client = {
      getSteps: async () => null,
      getWeight: async () => null,
      getHeartRate: async () => null,
      getSleep: async () => null,
      getActivities: async () => []
    } as any;

    const data = await provider.getData(new Date());
    expect(data.steps).toBeNull();
    expect(data.weight).toBeNull();
    expect(data.averageHeartRate).toBeNull();
    expect(data.sleep).toBeNull();
    expect(data.didRunning).toBe(false);
  });
});
