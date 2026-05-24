export interface HealthData {
  steps: number | null;
  weight: number | null;
  averageHeartRate: number | null;
  hrv: number | null;
  stress: number | null;
  bodyBattery: number | null;
  spO2: number | null;
  sleep: number | null;
  sleepScore: number | null;
  /** Sports performed as emoji strings. Cycling excluded (→ transport_km). */
  sports: string[];
  /** Total cycling km, treated as transport. Null if none. */
  transport_km: number | null;
  didRunning: boolean;
  runningDistance_km: number | null;
  didSwimming: boolean;
  SwimmingDistance_km: number | null;
  didCycling: boolean;
  cyclingDistance_km: number | null;
  otherActivities: boolean;
}
