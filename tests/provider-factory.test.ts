import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SecretKey } from '../src/application/health/services/secretSettingsService';

const mocks = vi.hoisted(() => ({
  garminCtor: vi.fn(),
  stravaCtor: vi.fn(),
  googleCtor: vi.fn(),
}));

vi.mock('../src/infrastructure/providers/garmin/GarminProvider', () => ({
  GarminProvider: class GarminProviderMock {
    kind = 'garmin';
    username: string;
    password: string;
    constructor(username: string, password: string) {
      mocks.garminCtor(username, password);
      this.username = username;
      this.password = password;
    }
  },
}));

vi.mock('../src/infrastructure/providers/strava/StravaProvider', () => ({
  StravaProvider: class StravaProviderMock {
    kind = 'strava';
    clientId: string;
    clientSecret: string;
    tokens: unknown;
    onTokens: (updated: any) => Promise<void>;
    constructor(clientId: string, clientSecret: string, tokens: unknown, onTokens: (updated: any) => Promise<void>) {
      mocks.stravaCtor(clientId, clientSecret, tokens, onTokens);
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.tokens = tokens;
      this.onTokens = onTokens;
    }
  },
}));

vi.mock('../src/infrastructure/providers/google/GoogleHealthProvider', () => ({
  GoogleHealthProvider: class GoogleHealthProviderMock {
    kind = 'google';
    clientId: string;
    clientSecret: string;
    tokens: unknown;
    onTokens: (updated: any) => Promise<void>;
    constructor(clientId: string, clientSecret: string, tokens: unknown, onTokens: (updated: any) => Promise<void>) {
      mocks.googleCtor(clientId, clientSecret, tokens, onTokens);
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.tokens = tokens;
      this.onTokens = onTokens;
    }
  },
}));

import { createProviderFactory } from '../src/application/health/services/providerFactory';

describe('createProviderFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('creates garmin provider with secret credentials', () => {
    const settings = { stravaClientId: 'sid', googleClientId: 'gid' };
    const secrets: Record<string, string> = {
      garminUsername: 'g-user',
      garminPassword: 'g-pass',
    };

    const resolveProvider = createProviderFactory({
      settings,
      getSecret: (secret: SecretKey) => secrets[secret] || '',
      setSecret: () => {},
      saveSettings: async () => {},
    });

    const provider = resolveProvider('garmin') as { kind: string; username: string; password: string };

    expect(provider.kind).toBe('garmin');
    expect(provider.username).toBe('g-user');
    expect(provider.password).toBe('g-pass');
    expect(mocks.garminCtor).toHaveBeenCalledTimes(1);
  });

  test('creates strava provider and persists refreshed tokens', async () => {
    const settings = { stravaClientId: 'strava-client', stravaExpiresAt: 1000 };
    const secrets: Record<string, string> = {
      stravaClientSecret: 'strava-secret',
      stravaAccessToken: 'old-access',
      stravaRefreshToken: 'old-refresh',
    };
    const saved: string[] = [];

    const resolveProvider = createProviderFactory({
      settings,
      getSecret: (secret: SecretKey) => secrets[secret] || '',
      setSecret: (secret: SecretKey, value: string) => {
        secrets[secret] = value;
      },
      saveSettings: async () => {
        saved.push('saved');
      },
    });

    const provider = resolveProvider('strava') as {
      kind: string;
      tokens: { accessToken: string; refreshToken: string; expiresAt: number };
      onTokens: (updated: { accessToken: string; refreshToken: string; expiresAt: number }) => Promise<void>;
    };

    expect(provider.kind).toBe('strava');
    expect(provider.tokens).toEqual({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1000,
    });

    await provider.onTokens({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 9999,
    });

    expect(secrets.stravaAccessToken).toBe('new-access');
    expect(secrets.stravaRefreshToken).toBe('new-refresh');
    expect(settings.stravaExpiresAt).toBe(9999);
    expect(saved).toHaveLength(1);
  });

  test('creates google provider and persists refreshed tokens', async () => {
    const settings = { googleClientId: 'google-client', googleExpiresAt: 500 };
    const secrets: Record<string, string> = {
      googleClientSecret: 'google-secret',
      googleAccessToken: 'g-old-access',
      googleRefreshToken: 'g-old-refresh',
    };
    let saveCount = 0;

    const resolveProvider = createProviderFactory({
      settings,
      getSecret: (secret: SecretKey) => secrets[secret] || '',
      setSecret: (secret: SecretKey, value: string) => {
        secrets[secret] = value;
      },
      saveSettings: async () => {
        saveCount += 1;
      },
    });

    const provider = resolveProvider('google') as {
      kind: string;
      tokens: { accessToken: string; refreshToken: string; expiresAt: number };
      onTokens: (updated: { accessToken: string; refreshToken: string; expiresAt: number }) => Promise<void>;
    };

    expect(provider.kind).toBe('google');
    expect(provider.tokens).toEqual({
      accessToken: 'g-old-access',
      refreshToken: 'g-old-refresh',
      expiresAt: 500,
    });

    await provider.onTokens({
      accessToken: 'g-new-access',
      refreshToken: 'g-new-refresh',
      expiresAt: 7777,
    });

    expect(secrets.googleAccessToken).toBe('g-new-access');
    expect(secrets.googleRefreshToken).toBe('g-new-refresh');
    expect(settings.googleExpiresAt).toBe(7777);
    expect(saveCount).toBe(1);
  });
});
