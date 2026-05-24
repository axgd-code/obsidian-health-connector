export type SecretKey =
  | 'garminUsername'
  | 'garminPassword'
  | 'garminTokenCache'
  | 'stravaClientSecret'
  | 'stravaAccessToken'
  | 'stravaRefreshToken'
  | 'googleClientSecret'
  | 'googleAccessToken'
  | 'googleRefreshToken';

interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

interface LoggerLike {
  warn(message: string, error?: unknown): void;
}

const SECRET_IDS: Record<SecretKey, string> = {
  garminUsername: 'health-connector-garmin-username',
  garminPassword: 'health-connector-garmin-password',
  garminTokenCache: 'health-connector-garmin-token-cache',
  stravaClientSecret: 'health-connector-strava-client-secret',
  stravaAccessToken: 'health-connector-strava-access-token',
  stravaRefreshToken: 'health-connector-strava-refresh-token',
  googleClientSecret: 'health-connector-google-client-secret',
  googleAccessToken: 'health-connector-google-access-token',
  googleRefreshToken: 'health-connector-google-refresh-token',
};

const LEGACY_SECRET_FIELDS: Array<{ field: string; secret: SecretKey }> = [
  { field: 'username', secret: 'garminUsername' },
  { field: 'password', secret: 'garminPassword' },
  { field: 'stravaClientSecret', secret: 'stravaClientSecret' },
  { field: 'stravaAccessToken', secret: 'stravaAccessToken' },
  { field: 'stravaRefreshToken', secret: 'stravaRefreshToken' },
  { field: 'googleClientSecret', secret: 'googleClientSecret' },
  { field: 'googleAccessToken', secret: 'googleAccessToken' },
  { field: 'googleRefreshToken', secret: 'googleRefreshToken' },
];

export class SecretSettingsService {
  private secretStorage: SecretStorageLike;
  private logger: LoggerLike;

  constructor(secretStorage: SecretStorageLike, logger: LoggerLike) {
    this.secretStorage = secretStorage;
    this.logger = logger;
  }

  get(secret: SecretKey): string {
    try {
      return this.secretStorage.getSecret(SECRET_IDS[secret]) ?? '';
    } catch (e) {
      this.logger.warn(`Unable to read secret ${secret}:`, e);
      return '';
    }
  }

  set(secret: SecretKey, value: string) {
    try {
      this.secretStorage.setSecret(SECRET_IDS[secret], value);
    } catch (e) {
      this.logger.warn(`Unable to store secret ${secret}:`, e);
    }
  }

  getGarminTokenCache(): unknown | null {
    const raw = this.get('garminTokenCache');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      this.logger.warn('Unable to parse Garmin token cache secret:', e);
      return null;
    }
  }

  setGarminTokenCache(tokens: unknown | null) {
    if (tokens === null || tokens === undefined) {
      this.set('garminTokenCache', '');
      return;
    }

    try {
      this.set('garminTokenCache', JSON.stringify(tokens));
    } catch (e) {
      this.logger.warn('Unable to serialize Garmin token cache secret:', e);
    }
  }

  sanitizeSettingsForPersist(settings: Record<string, unknown>) {
    for (const { field } of LEGACY_SECRET_FIELDS) {
      settings[field] = '';
    }
    delete settings.tokens;
  }

  migrateLegacySecretsFromSettings(settings: Record<string, unknown>): boolean {
    let migrated = false;

    for (const { field, secret } of LEGACY_SECRET_FIELDS) {
      const raw = settings[field];
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) continue;
      this.set(secret, value);
      settings[field] = '';
      migrated = true;
    }

    return migrated;
  }
}
