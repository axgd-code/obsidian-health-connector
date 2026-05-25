import { describe, expect, test } from 'vitest';
import { SecretSettingsService } from '../src/application/health/services/secretSettingsService';

function makeService() {
  const stored = new Map<string, string>();

  const service = new SecretSettingsService(
    {
      getSecret: (id: string) => stored.get(id) ?? null,
      setSecret: (id: string, secret: string) => {
        stored.set(id, secret);
      },
    },
    { warn: () => {} },
  );

  return { service, stored };
}

describe('SecretSettingsService', () => {
  test('sanitizeSettingsForPersist removes legacy sensitive fields from settings', () => {
    const { service } = makeService();
    const settings: Record<string, unknown> = {
      username: 'user@example.com',
      password: 'secret',
      stravaClientSecret: 'abc',
      stravaAccessToken: 'token',
      stravaRefreshToken: 'refresh',
      googleClientSecret: 'gabc',
      googleAccessToken: 'gtoken',
      googleRefreshToken: 'grefresh',
      tokens: { legacy: true },
      vaultFolder: 'obsidian-garmin-plugin',
    };

    service.sanitizeSettingsForPersist(settings);

    expect(settings.username).toBeUndefined();
    expect(settings.password).toBeUndefined();
    expect(settings.stravaClientSecret).toBeUndefined();
    expect(settings.stravaAccessToken).toBeUndefined();
    expect(settings.stravaRefreshToken).toBeUndefined();
    expect(settings.googleClientSecret).toBeUndefined();
    expect(settings.googleAccessToken).toBeUndefined();
    expect(settings.googleRefreshToken).toBeUndefined();
    expect(settings.tokens).toBeUndefined();
    expect(settings.vaultFolder).toBe('obsidian-garmin-plugin');
  });

  test('migrateLegacySecretsFromSettings stores non-empty values and removes legacy fields', () => {
    const { service, stored } = makeService();
    const settings: Record<string, unknown> = {
      username: 'user@example.com',
      password: '  pass123  ',
      stravaClientSecret: '',
      googleClientSecret: 'google-secret',
      provider: 'garmin',
    };

    const migrated = service.migrateLegacySecretsFromSettings(settings);

    expect(migrated).toBe(true);
    expect(settings.username).toBeUndefined();
    expect(settings.password).toBeUndefined();
    expect(settings.googleClientSecret).toBeUndefined();
    expect(settings.provider).toBe('garmin');

    expect(stored.get('health-connector-garmin-username')).toBe('user@example.com');
    expect(stored.get('health-connector-garmin-password')).toBe('pass123');
    expect(stored.get('health-connector-google-client-secret')).toBe('google-secret');
  });

  test('migrateLegacySecretsFromSettings removes empty legacy fields without migrating values', () => {
    const { service, stored } = makeService();
    const settings: Record<string, unknown> = {
      username: '   ',
      password: '',
      stravaAccessToken: '',
      vaultFolder: 'obsidian-garmin-plugin',
    };

    const migrated = service.migrateLegacySecretsFromSettings(settings);

    expect(migrated).toBe(false);
    expect(settings.username).toBeUndefined();
    expect(settings.password).toBeUndefined();
    expect(settings.stravaAccessToken).toBeUndefined();
    expect(settings.vaultFolder).toBe('obsidian-garmin-plugin');
    expect(stored.size).toBe(0);
  });

  test('hasLegacySensitiveFields detects legacy keys and tokens payload', () => {
    const { service } = makeService();

    expect(service.hasLegacySensitiveFields({ provider: 'garmin' })).toBe(false);
    expect(service.hasLegacySensitiveFields({ username: 'user@example.com' })).toBe(true);
    expect(service.hasLegacySensitiveFields({ tokens: { legacy: true } })).toBe(true);
  });
});