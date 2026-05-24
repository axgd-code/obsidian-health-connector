import type { SecretKey } from './secretSettingsService';

export type ProviderKey = 'garmin' | 'strava' | 'google';

export interface ProviderConfigSettings {
  provider?: string;
  enabledProviders?: string[];
  stravaClientId?: string;
  stravaExpiresAt?: number;
  googleClientId?: string;
  googleExpiresAt?: number;
}

export type SecretGetter = (secret: SecretKey) => string;

export function getEnabledProviders(settings: ProviderConfigSettings): ProviderKey[] {
  if (Array.isArray(settings.enabledProviders)) {
    return settings.enabledProviders
      .map((p) => String(p).toLowerCase())
      .filter((p): p is ProviderKey => p === 'garmin' || p === 'strava' || p === 'google');
  }

  const legacy = String(settings.provider || 'garmin').toLowerCase();
  if (legacy === 'strava') return ['strava'];
  if (legacy === 'google') return ['google'];
  return ['garmin'];
}

export function buildProviderCredKey(
  key: ProviderKey,
  settings: ProviderConfigSettings,
  getSecret: SecretGetter,
): string {
  if (key === 'strava') {
    return [
      key,
      settings.stravaClientId || '',
      getSecret('stravaClientSecret'),
      getSecret('stravaAccessToken'),
      getSecret('stravaRefreshToken'),
      String(settings.stravaExpiresAt || 0),
    ].join(':');
  }

  if (key === 'google') {
    return [
      key,
      settings.googleClientId || '',
      getSecret('googleClientSecret'),
      getSecret('googleAccessToken'),
      getSecret('googleRefreshToken'),
      String(settings.googleExpiresAt || 0),
    ].join(':');
  }

  return [key, getSecret('garminUsername'), getSecret('garminPassword')].join(':');
}
