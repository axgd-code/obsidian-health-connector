import { GarminProvider } from '../../../infrastructure/providers/garmin/GarminProvider';
import { StravaProvider, type StravaTokens } from '../../../infrastructure/providers/strava/StravaProvider';
import { GoogleHealthProvider, type GoogleTokens } from '../../../infrastructure/providers/google/GoogleHealthProvider';
import type { IHealthProvider } from '../../../domain/health/ports/IHealthProvider';
import type { SecretKey } from './secretSettingsService';
import type { ProviderKey } from './providerConfigService';

export interface ProviderFactorySettings {
  stravaClientId?: string;
  stravaExpiresAt?: number;
  googleClientId?: string;
  googleExpiresAt?: number;
}

interface ProviderFactoryDeps {
  settings: ProviderFactorySettings;
  getSecret: (secret: SecretKey) => string;
  setSecret: (secret: SecretKey, value: string) => void;
  saveSettings: () => Promise<void>;
}

export function createProviderFactory(deps: ProviderFactoryDeps) {
  return (key: ProviderKey): IHealthProvider => {
    switch (key) {
      case 'google': {
        const tokens: GoogleTokens = {
          accessToken: deps.getSecret('googleAccessToken'),
          refreshToken: deps.getSecret('googleRefreshToken'),
          expiresAt: deps.settings.googleExpiresAt || 0,
        };
        return new GoogleHealthProvider(
          deps.settings.googleClientId || '',
          deps.getSecret('googleClientSecret'),
          tokens,
          async (updated) => {
            deps.setSecret('googleAccessToken', updated.accessToken);
            deps.setSecret('googleRefreshToken', updated.refreshToken);
            deps.settings.googleExpiresAt = updated.expiresAt;
            await deps.saveSettings();
          },
        );
      }
      case 'strava': {
        const tokens: StravaTokens = {
          accessToken: deps.getSecret('stravaAccessToken'),
          refreshToken: deps.getSecret('stravaRefreshToken'),
          expiresAt: deps.settings.stravaExpiresAt || 0,
        };
        return new StravaProvider(
          deps.settings.stravaClientId || '',
          deps.getSecret('stravaClientSecret'),
          tokens,
          async (updated) => {
            deps.setSecret('stravaAccessToken', updated.accessToken);
            deps.setSecret('stravaRefreshToken', updated.refreshToken);
            deps.settings.stravaExpiresAt = updated.expiresAt;
            await deps.saveSettings();
          },
        );
      }
      case 'garmin':
      default:
        return new GarminProvider(deps.getSecret('garminUsername'), deps.getSecret('garminPassword'));
    }
  };
}
