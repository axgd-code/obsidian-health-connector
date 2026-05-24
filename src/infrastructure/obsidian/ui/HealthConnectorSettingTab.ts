import { App, PluginSettingTab, setIcon, Setting } from 'obsidian';
import type { SecretKey } from '../../../application/health/services/secretSettingsService';

interface PluginSettingsFacade {
  settings: {
    enabledProviders?: string[];
    provider?: string;
    stravaClientId?: string;
    googleClientId?: string;
  };
  i18n: any;
  getSecret(secret: SecretKey): string;
  setSecret(secret: SecretKey, value: string): void;
  invalidateProviderCache(): void;
  saveSettings(): Promise<void>;
  connectStrava(): Promise<void>;
  connectGoogleHealth(): Promise<void>;
}

export class HealthConnectorSettingTab extends PluginSettingTab {
  plugin: PluginSettingsFacade;

  constructor(app: App, plugin: PluginSettingsFacade) {
    super(app, plugin as any);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: this.plugin.i18n.settings.title });

    const enabledProviders = new Set(
      Array.isArray(this.plugin.settings.enabledProviders)
        ? this.plugin.settings.enabledProviders.map((p) => String(p).toLowerCase())
        : [String(this.plugin.settings.provider || 'garmin').toLowerCase()],
    );

    const persistEnabledProviders = async () => {
      const normalized = [...enabledProviders].filter((p) => p === 'garmin' || p === 'strava' || p === 'google');
      this.plugin.settings.enabledProviders = normalized;
      this.plugin.settings.provider = normalized[0] || 'garmin';
      this.plugin.invalidateProviderCache();
      await this.plugin.saveSettings();
      this.display();
    };

    new Setting(containerEl)
      .setName(this.plugin.i18n.settings.providerGarminName)
      .setDesc(this.plugin.i18n.settings.providerGarminDesc)
      .addToggle((toggle: any) => {
        toggle.setValue(enabledProviders.has('garmin'));
        toggle.onChange(async (value: boolean) => {
          if (value) enabledProviders.add('garmin');
          else enabledProviders.delete('garmin');
          await persistEnabledProviders();
        });
      });

    new Setting(containerEl)
      .setName(this.plugin.i18n.settings.providerStravaName)
      .setDesc(this.plugin.i18n.settings.providerStravaDesc)
      .addToggle((toggle: any) => {
        toggle.setValue(enabledProviders.has('strava'));
        toggle.onChange(async (value: boolean) => {
          if (value) enabledProviders.add('strava');
          else enabledProviders.delete('strava');
          await persistEnabledProviders();
        });
      });

    new Setting(containerEl)
      .setName(this.plugin.i18n.settings.providerGoogleName)
      .setDesc(this.plugin.i18n.settings.providerGoogleDesc)
      .addToggle((toggle: any) => {
        toggle.setValue(enabledProviders.has('google'));
        toggle.onChange(async (value: boolean) => {
          if (value) enabledProviders.add('google');
          else enabledProviders.delete('google');
          await persistEnabledProviders();
        });
      });

    const showGarmin = enabledProviders.has('garmin');
    const showStrava = enabledProviders.has('strava');
    const showGoogle = enabledProviders.has('google');

    if (showGarmin) {
      containerEl.createEl('h3', { text: this.plugin.i18n.settings.garminSectionTitle });

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.username)
        .setDesc(this.plugin.i18n.settings.usernameDesc)
        .addText((text: any) =>
          text
            .setPlaceholder(this.plugin.i18n.settings.garminEmailPlaceholder)
            .setValue(this.plugin.getSecret('garminUsername'))
            .onChange(async (value: string) => {
              this.plugin.setSecret('garminUsername', value.trim());
              this.plugin.invalidateProviderCache();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.password)
        .setDesc(this.plugin.i18n.settings.passwordDesc)
        .addText((text: any) => {
          text
            .setPlaceholder(this.plugin.i18n.settings.password)
            .setValue(this.plugin.getSecret('garminPassword'))
            .onChange(async (value: string) => {
              this.plugin.setSecret('garminPassword', value.trim());
              this.plugin.invalidateProviderCache();
              await this.plugin.saveSettings();
            });
          try {
            const inputEl = (text as any).inputEl as HTMLInputElement | undefined;
            if (inputEl) {
              inputEl.setAttribute('type', 'password');
              const btn = document.createElement('button') as HTMLButtonElement;
              btn.className = 'health-password-toggle';
              btn.type = 'button';
              btn.setAttribute('aria-label', this.plugin.i18n.settings.labelShowPassword);
              const iconEl = document.createElement('span');
              iconEl.className = 'icon';
              setIcon(iconEl, 'eye');
              btn.appendChild(iconEl);
              btn.addEventListener('click', () => {
                if (inputEl.type === 'password') {
                  inputEl.type = 'text';
                  setIcon(iconEl, 'eye-off');
                  btn.setAttribute('aria-label', this.plugin.i18n.settings.labelHidePassword);
                } else {
                  inputEl.type = 'password';
                  setIcon(iconEl, 'eye');
                  btn.setAttribute('aria-label', this.plugin.i18n.settings.labelShowPassword);
                }
              });
              inputEl.parentElement?.appendChild(btn);
            }
          } catch {
            // ignore if inputEl not available at runtime
          }
          return text;
        });
    }

    if (showStrava) {
      containerEl.createEl('h3', { text: this.plugin.i18n.settings.stravaSectionTitle });

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.stravaClientIdName)
        .setDesc(this.plugin.i18n.settings.stravaClientIdDesc)
        .addText((text: any) =>
          text
            .setPlaceholder('ex. 123456')
            .setValue(this.plugin.settings.stravaClientId || '')
            .onChange(async (value: string) => {
              this.plugin.settings.stravaClientId = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.stravaClientSecretName)
        .setDesc(this.plugin.i18n.settings.stravaClientSecretDesc)
        .addText((text: any) => {
          text
            .setPlaceholder('••••••••••••')
            .setValue(this.plugin.getSecret('stravaClientSecret'))
            .onChange(async (value: string) => {
              this.plugin.setSecret('stravaClientSecret', value.trim());
              this.plugin.invalidateProviderCache();
              await this.plugin.saveSettings();
            });
          try {
            const inputEl = (text as any).inputEl as HTMLInputElement | undefined;
            if (inputEl) inputEl.setAttribute('type', 'password');
          } catch {
            // ignore missing input element
          }
          return text;
        });

      const isConnected = !!this.plugin.getSecret('stravaRefreshToken');
      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.stravaConnectName)
        .setDesc(isConnected ? this.plugin.i18n.settings.stravaConnectedDesc : this.plugin.i18n.settings.stravaDisconnectedDesc)
        .addButton((btn: any) => {
          btn.setButtonText(isConnected ? this.plugin.i18n.settings.reconnectButton : this.plugin.i18n.settings.stravaConnectButton);
          if (!isConnected) btn.setCta?.();
          btn.onClick(async () => {
            await this.plugin.connectStrava();
            this.display();
          });
        });
    }

    if (showGoogle) {
      containerEl.createEl('h3', { text: this.plugin.i18n.settings.googleSectionTitle });

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.googleClientIdName)
        .setDesc(this.plugin.i18n.settings.googleClientIdDesc)
        .addText((text: any) =>
          text
            .setPlaceholder(this.plugin.i18n.settings.googleClientIdPlaceholder)
            .setValue(this.plugin.settings.googleClientId || '')
            .onChange(async (value: string) => {
              this.plugin.settings.googleClientId = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.googleClientSecretName)
        .setDesc(this.plugin.i18n.settings.googleClientSecretDesc)
        .addText((text: any) => {
          text
            .setPlaceholder('••••••••••••')
            .setValue(this.plugin.getSecret('googleClientSecret'))
            .onChange(async (value: string) => {
              this.plugin.setSecret('googleClientSecret', value.trim());
              this.plugin.invalidateProviderCache();
              await this.plugin.saveSettings();
            });
          try {
            const inputEl = (text as any).inputEl as HTMLInputElement | undefined;
            if (inputEl) inputEl.setAttribute('type', 'password');
          } catch {
            // ignore missing input element
          }
          return text;
        });

      const isGoogleConnected = !!this.plugin.getSecret('googleRefreshToken');
      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.googleConnectName)
        .setDesc(isGoogleConnected ? this.plugin.i18n.settings.googleConnectedDesc : this.plugin.i18n.settings.googleDisconnectedDesc)
        .addButton((btn: any) => {
          btn.setButtonText(isGoogleConnected ? this.plugin.i18n.settings.reconnectButton : this.plugin.i18n.settings.googleConnectButton);
          if (!isGoogleConnected) btn.setCta?.();
          btn.onClick(async () => {
            await this.plugin.connectGoogleHealth();
            this.display();
          });
        });
    }

    new Setting(containerEl)
      .setName(this.plugin.i18n.settings.supportTitle)
      .setDesc(this.plugin.i18n.settings.supportDesc)
      .addButton((btn: any) => {
        btn.setButtonText(this.plugin.i18n.settings.supportButton);
        btn.setCta?.();
        btn.onClick(() => {
          try {
            const a = document.createElement('a') as HTMLAnchorElement;
            a.href = 'https://paypal.me/axgdcode';
            a.target = '_blank';
            a.rel = 'noopener';
            a.click();
          } catch {
            try {
              (window as any).open('https://paypal.me/axgdcode', '_blank');
            } catch {
              // ignore browser open failure
            }
          }
        });
      });
  }
}
