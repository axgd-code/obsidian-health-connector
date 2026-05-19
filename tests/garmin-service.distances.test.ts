import { GarminService } from "../src/garmin/garmin-service";

describe('GarminService distance extraction variations', () => {
  test('parses various distance key names and formats', async () => {
    const svc = new GarminService('u','p');
    svc.client = {
      getSteps: async () => null,
      getWeight: async () => null,
      getHeartRate: async () => null,
      getSleep: async () => null,
      getActivities: async () => [
        { startTimeLocal: '2025-12-24T06:00:00', activityType: 'running', activityDistanceInMeters: 3000 },
        { startTimeLocal: '2025-12-24T07:00:00', activityType: 'cycling', distanceMeters: 15000 },
        { startTimeLocal: '2025-12-24T08:00:00', activityType: 'swimming', activitySummary: { distance: 800 } },
        { startTimeLocal: '2025-12-24T09:00:00', activityType: 'running', distance: "2500" }
      ]
    } as any;

    const data = await svc.getData(new Date('2025-12-24'));
    expect(data.didRunning).toBe(true);
    // should pick the first running distance found (3000m -> 3.00 km)
    expect(data.runningDistance_km).toBeCloseTo(3.00, 2);
    expect(data.didCycling).toBe(true);
    expect(data.cyclingDistance_km).toBeCloseTo(15.00, 2);
    expect(data.didSwimming).toBe(true);
    expect(data.SwimmingDistance_km).toBeCloseTo(0.8, 2);
  });
});
