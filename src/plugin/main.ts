// Obsidian Plugin: Health Connector (full TypeScript, full JS)

import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, setIcon, FuzzySuggestModal, TFolder } from "obsidian";
import { GarminProvider } from "../providers/GarminProvider";
import { StravaProvider } from "../providers/StravaProvider";
import type { StravaTokens } from "../providers/StravaProvider";
import { GoogleHealthProvider } from "../providers/GoogleHealthProvider";
import type { GoogleTokens } from "../providers/GoogleHealthProvider";
import type { IHealthProvider } from "../providers/IHealthProvider";
import type { HealthData } from "../types/health";
import { HealthService } from "../health/health-service";
import { DEFAULT_SETTINGS } from "../config/config";
import { GOOGLE_OAUTH_CONFIG } from "../config/oauth";
import { getLocale } from "../i18n";
import { logger } from "../common/Logger";
import { mergeProviderHealthData } from "../common/mergeHealthData";

interface HealthConnectorSettings {
  username: string;
  password: string;
  vaultFolder: string;
  provider?: string; // legacy single-provider setting
  enabledProviders?: string[];
  stravaClientId?: string;
  stravaClientSecret?: string;
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaExpiresAt?: number;
  googleClientId?: string;
  googleClientSecret?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleExpiresAt?: number;
}

type ProviderKey = 'garmin' | 'strava' | 'google';

interface FetchHealthDataResult {
  data: HealthData | null;
  successfulProviders: ProviderKey[];
  attemptedProviders: ProviderKey[];
}

export interface HealthConnectorAPI {
  /** Sync today's health data into the active file's frontmatter */
  syncToday(): Promise<void>;
  /** Sync health data for a specific date into the active file's frontmatter */
  syncDate(date: Date): Promise<void>;
}

export default class HealthConnectorPlugin extends Plugin {
  settings!: HealthConnectorSettings;
  public i18n = getLocale();
  public api!: HealthConnectorAPI;
  private _healthServices = new Map<ProviderKey, HealthService>();
  private _healthServiceCredKeys = new Map<ProviderKey, string>();

  async onload() {
    await this.loadSettings();
    // Update i18n with Obsidian's language setting
    this.i18n = getLocale((this.app as any).vault?.adapter?.basePath ? (this.app as any).language : undefined);

    // Expose public API for use by other plugins or templating engines
    // NOTE: API callers (e.g. Templater templates) handle their own form –
    // so syncToday/syncDate just fetch provider data and write it silently.
    this.api = {
      syncToday: async () => {
        await this.writeProviderDataToActiveFile(new Date());
      },
      syncDate: async (date: Date) => {
        await this.writeProviderDataToActiveFile(date);
      },
    };

    // Provide a global token store for garmin-connect to persist tokens via plugin data (mobile-safe)
    try {
      (globalThis as any).__HealthConnectorPluginInstance = this;
      const existing = await this.loadData() || {};
      (globalThis as any).__GarminTokenCache = existing.tokens || null;
      (globalThis as any).__GarminTokenStore = {
        syncLoad: () => {
          return (globalThis as any).__GarminTokenCache || null;
        },
        syncSave: (tokens: any) => {
          (globalThis as any).__GarminTokenCache = tokens;
          setTimeout(async () => {
            try {
              const data = await this.loadData() || {};
              data.tokens = tokens;
              await this.saveData(data);
              logger.info('Tokens persisted via plugin data');
            } catch (e) {
              logger.warn('Failed to persist tokens via plugin data', e);
            }
          }, 0);
        },
        syncClear: () => {
          (globalThis as any).__GarminTokenCache = null;
          setTimeout(async () => {
            try {
              const data = await this.loadData() || {};
              delete data.tokens;
              await this.saveData(data);
              logger.info('Tokens cleared via plugin data');
            } catch (e) {
              logger.warn('Failed to clear tokens via plugin data', e);
            }
          }, 0);
        }
      };
    } catch (e) {
      logger.warn('Failed to initialize token store', e);
    }

    // Commands for creating standalone notes have been removed.

    // Command: insert today's health data into active file frontmatter
    this.addCommand({
      id: "health-add-today-to-frontmatter",
      name: this.i18n.commands.addTodayToFrontmatter,
      callback: async () => {
        await this.addHealthDataForDateToActiveFile(new Date());
      }
    });

    // Command: prompt date and insert health data for that date into active file
    this.addCommand({
      id: "health-add-date-to-frontmatter",
      name: this.i18n.commands.addDateToFrontmatter,
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice(this.i18n.notices.noActiveFile);
          return;
        }

        const d = await this.resolveDateFromFile(file);
        if (!d) {
          new Notice(this.i18n.notices.dateNotFoundInFile);
          return;
        }

        await this.addHealthDataForDateToActiveFile(d);
      }
    });

    this.addSettingTab(new HealthConnectorSettingTab(this.app, this));

    // Command: batch create notes for a range of dates
    this.addCommand({
      id: "health-batch-create-notes",
      name: this.i18n.commands.batchCreateNotes,
      callback: async () => {
        const params = await this.promptForDateRange();
        if (!params) return;
        await this.batchCreateNotes(params.startDate, params.endDate, params.folder);
      }
    });
  }

  async onunload() {
    // No-op
  }

  // Health data access handled by `HealthService` with provider pattern
  // The method to create standalone notes has been removed per configuration.

  // Prompt the user for a date (YYYY-MM-DD) using a simple Modal and return the string or null.
  async promptForDate(): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        result: string | null = null;
        resolve: (v: string | null) => void;
        parentPlugin: HealthConnectorPlugin;
        constructor(app: App, resolveFn: (v: string | null) => void, plugin: HealthConnectorPlugin) {
          super(app);
          this.resolve = resolveFn;
          this.parentPlugin = plugin;
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.createEl('h2', { text: this.parentPlugin.i18n.modal.dateLabel });
          const inputContainer = contentEl.createDiv({ cls: 'health-date-input-container' });
          const input = inputContainer.createEl('input', { cls: 'health-date-input' }) as HTMLInputElement;
          input.type = 'date';
          const btnRow = contentEl.createDiv({ cls: 'health-modal-buttons' });
          const ok = btnRow.createEl('button', { text: this.parentPlugin.i18n.modal.ok, cls: 'mod-cta' });
          const cancel = btnRow.createEl('button', { text: this.parentPlugin.i18n.modal.cancel });
          ok.onclick = () => {
            const v = input.value;
            this.close();
            this.resolve(v || null);
          };
          cancel.onclick = () => {
            this.close();
            this.resolve(null);
          };
        }
        onClose() {
          const { contentEl } = this;
          contentEl.empty();
        }
      })(this.app, resolve, this);

      modal.open();
    });
  }

  // Retrieve health data for a date: open data-entry modal immediately, fetch
  /**
   * Silent write — used by the public API (Templater templates, etc.).
   * Fetches provider data and writes it to the active file without opening any modal.
   */
  async writeProviderDataToActiveFile(date: Date): Promise<HealthData | null> {
    const file = this.app.workspace.getActiveFile();
    const loadingNotice = new Notice(this.i18n.notices.loadingHealthData, 0);
    const result = await this.fetchHealthData(date);
    loadingNotice.hide();
    // Ne pas écrire ici : si appelé depuis un template Templater,
    // celui-ci réécrira le fichier après et écrasera nos valeurs.
    // L'écriture est déléguée au template via setTimeout.
    return result.data;
  }

  // from provider in background, fill/override modal when data arrives.
  async addHealthDataForDateToActiveFile(date: Date) {
    logger.debug('🔄 addHealthDataForDateToActiveFile called for date:', date);

    // Capture the active file now — before the modal may shift focus
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(this.i18n.notices.noActiveFile);
      return;
    }

    // Silent mode: fetch provider data and write directly to the active file.
    const loadingNotice = new Notice(this.i18n.notices.loadingHealthData, 0);
    const result = await this.fetchHealthData(date);
    loadingNotice.hide();

    await this.addDataToFile(file, date, result.data ?? {});

    if (result.successfulProviders.length > 0) {
      const names = result.successfulProviders.map((key) => this.getProviderDisplayName(key)).join(', ');
      new Notice(this.i18n.notices.addedToFileFromProviders(names));
      return;
    }

    new Notice(this.i18n.notices.fetchError);
  }

  private async resolveDateFromFile(file: any): Promise<Date | null> {
    // 1) Frontmatter date: YYYY-MM-DD
    try {
      const content = await this.app.vault.read(file);
      if (content.startsWith('---\n')) {
        const endIdx = content.indexOf('\n---', 4);
        if (endIdx !== -1) {
          const fmText = content.slice(4, endIdx);
          const fmMatch = fmText.match(/(?:^|\n)\s*date:\s*(\d{4}-\d{2}-\d{2})\s*(?:\n|$)/);
          if (fmMatch?.[1]) {
            const d = new Date(fmMatch[1]);
            if (!isNaN(d.getTime())) return d;
          }
        }
      }
    } catch (e) {
      logger.warn('Failed reading date from frontmatter:', e);
    }

    // 2) Filename date: YYYY-MM-DD.md
    const nameMatch = String(file.basename || '').match(/^(\d{4}-\d{2}-\d{2})$/);
    if (nameMatch?.[1]) {
      const d = new Date(nameMatch[1]);
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }

  /** Build the `values` object for Modal Form's `openForm` pre-fill option. */
  private buildModalFormValues(data: HealthData | null): Record<string, any> {
    if (!data) return {};
    const v: Record<string, any> = {};
    if (data.steps != null)        v['Pas']   = data.steps;
    if (data.weight != null)       v['Poids'] = data.weight;
    if (data.transport_km != null) v['km']    = data.transport_km;
    // Sport: pass the first emoji if it matches a known option, else skip
    const knownSports = new Set(['🏃', '🏊', '🧗‍♀', '🚴', '🏋‍♀', '∅']);
    const firstSport = data.sports?.find(s => knownSports.has(s));
    if (firstSport) v['Sport'] = firstSport;
    return v;
  }

  /**
   * Merge the Modal Form result (field names like 'Pas', 'Poids', …) with
   * provider-only fields (sleep, HR, distances) that are not in the form.
   */
  private mergeModalFormResult(
    formData: Record<string, any>,
    provider: HealthData | null,
  ): Partial<HealthData> {
    const num = (v: any): number | null => {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };
    const sport = formData['Sport'];
    const sports = sport && sport !== '∅' ? [sport] : (provider?.sports ?? []);
    return {
      steps:            formData['Pas']   != null ? Math.round(Number(formData['Pas']))   : (provider?.steps   ?? null),
      weight:           formData['Poids'] != null ? num(formData['Poids'])                : (provider?.weight  ?? null),
      transport_km:     formData['km']    != null ? num(formData['km'])                   : (provider?.transport_km ?? null),
      sports,
      // Provider-only fields (not in the Modal Form)
      sleep:            provider?.sleep            ?? null,
      sleepScore:       provider?.sleepScore       ?? null,
      averageHeartRate: provider?.averageHeartRate ?? null,
      runningDistance_km:  provider?.runningDistance_km  ?? null,
      SwimmingDistance_km: provider?.SwimmingDistance_km ?? null,
      // backward-compat stubs
      didRunning: false, didSwimming: false, didCycling: false,
      cyclingDistance_km: null, otherActivities: false,
    } as Partial<HealthData>;
  }

  // Start provider fetch in background; returns null on error (graceful)
  private async fetchHealthData(date: Date): Promise<FetchHealthDataResult> {
    const enabledProviders = this.getEnabledProviders();
    if (enabledProviders.length === 0) {
      return { data: null, successfulProviders: [], attemptedProviders: [] };
    }

    const services: Array<{ key: ProviderKey; service: HealthService }> = [];
    const attemptedProviders = [...enabledProviders];
    try {
      for (const key of enabledProviders) {
        const credKey = this.buildProviderCredKey(key);
        const existingService = this._healthServices.get(key);
        const existingCredKey = this._healthServiceCredKeys.get(key);

        if (!existingService || existingCredKey !== credKey) {
          try {
            const provider: IHealthProvider = this.resolveProvider(key);
            const service = new HealthService(provider);
            await service.init();
            this._healthServices.set(key, service);
            this._healthServiceCredKeys.set(key, credKey);
            services.push({ key, service });
          } catch (e) {
            logger.warn(`Provider ${key} initialization failed:`, e);
          }
          continue;
        }

        services.push({ key, service: existingService });
      }

      if (services.length === 0) {
        return { data: null, successfulProviders: [], attemptedProviders };
      }

      const successfulProviders: ProviderKey[] = [];

      const fetched = await Promise.all(
        services.map(async ({ key, service }) => {
          try {
            const data = await service.getData(date);
            successfulProviders.push(key);
            return { key, data };
          } catch (e) {
            logger.warn(`Provider ${key} failed to fetch data:`, e);
            return null;
          }
        }),
      );

      return {
        data: mergeProviderHealthData(fetched.filter((entry): entry is { key: ProviderKey; data: HealthData } => entry !== null)),
        successfulProviders,
        attemptedProviders,
      };
    } catch (e) {
      if ((e as any).message === 'InteractiveAuthRequired') {
        return { data: null, successfulProviders: [], attemptedProviders };
      }
      this.clearHealthServiceCache();
      logger.error('fetchHealthData failed:', e);
      return { data: null, successfulProviders: [], attemptedProviders };
    }
  }

  private getProviderDisplayName(key: ProviderKey): string {
    if (key === 'garmin') return this.i18n.settings.providerGarminName;
    if (key === 'strava') return this.i18n.settings.providerStravaName;
    return this.i18n.settings.providerGoogleName;
  }

  private clearHealthServiceCache() {
    this._healthServices.clear();
    this._healthServiceCredKeys.clear();
  }

  private renderAuthHtml(title: string, message: string): string {
    return `<html><body><h2>${title}</h2><p>${message}</p></body></html>`;
  }

  public invalidateProviderCache() {
    this.clearHealthServiceCache();
  }

  private getEnabledProviders(): ProviderKey[] {
    if (Array.isArray(this.settings.enabledProviders)) {
      return this.settings.enabledProviders
        .map((p) => String(p).toLowerCase())
        .filter((p): p is ProviderKey => p === 'garmin' || p === 'strava' || p === 'google');
    }

    const legacy = String(this.settings.provider || 'garmin').toLowerCase();
    if (legacy === 'strava') return ['strava'];
    if (legacy === 'google') return ['google'];
    return ['garmin'];
  }

  private buildProviderCredKey(key: ProviderKey): string {
    if (key === 'strava') {
      return [
        key,
        this.settings.stravaClientId || '',
        this.settings.stravaClientSecret || '',
        this.settings.stravaAccessToken || '',
        this.settings.stravaRefreshToken || '',
        String(this.settings.stravaExpiresAt || 0),
      ].join(':');
    }

    if (key === 'google') {
      return [
        key,
        this.settings.googleClientId || '',
        this.settings.googleClientSecret || '',
        this.settings.googleAccessToken || '',
        this.settings.googleRefreshToken || '',
        String(this.settings.googleExpiresAt || 0),
      ].join(':');
    }

    return [key, this.settings.username || '', this.settings.password || ''].join(':');
  }

  // Resolve a provider by key
  private resolveProvider(key: ProviderKey): IHealthProvider {
    switch (key) {
      case 'google': {
        const tokens: GoogleTokens = {
          accessToken: this.settings.googleAccessToken || '',
          refreshToken: this.settings.googleRefreshToken || '',
          expiresAt: this.settings.googleExpiresAt || 0,
        };
        return new GoogleHealthProvider(
          this.settings.googleClientId || '',
          this.settings.googleClientSecret || '',
          tokens,
          async (updated) => {
            this.settings.googleAccessToken = updated.accessToken;
            this.settings.googleRefreshToken = updated.refreshToken;
            this.settings.googleExpiresAt = updated.expiresAt;
            await this.saveSettings();
          },
        );
      }
      case 'strava': {
        const tokens: StravaTokens = {
          accessToken: this.settings.stravaAccessToken || '',
          refreshToken: this.settings.stravaRefreshToken || '',
          expiresAt: this.settings.stravaExpiresAt || 0,
        };
        return new StravaProvider(
          this.settings.stravaClientId || '',
          this.settings.stravaClientSecret || '',
          tokens,
          async (updated) => {
            this.settings.stravaAccessToken = updated.accessToken;
            this.settings.stravaRefreshToken = updated.refreshToken;
            this.settings.stravaExpiresAt = updated.expiresAt;
            await this.saveSettings();
          },
        );
      }
      case 'garmin':
      default:
        return new GarminProvider(this.settings.username, this.settings.password);
    }
  }

  /** Open Strava OAuth flow in the browser and exchange the code for tokens */
  async connectStrava(): Promise<void> {
    const clientId = this.settings.stravaClientId?.trim();
    const clientSecret = this.settings.stravaClientSecret?.trim();
    if (!clientId || !clientSecret) {
      new Notice(this.i18n.notices.stravaMissingCredentials);
      return;
    }

    // Start a temporary localhost HTTP server to catch the OAuth redirect
    let server: any;
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    try {
      const http = (window as any).require('http');
      server = http.createServer((req: any, res: any) => {
        try {
          const url = new URL(`http://localhost${req.url}`);
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          if (code) {
            res.end(this.renderAuthHtml(`✅ ${this.i18n.auth.successTitle('Strava')}`, this.i18n.auth.successCloseTab));
            resolveCode(code);
          } else {
            res.end(this.renderAuthHtml(`❌ ${this.i18n.auth.errorTitle}`, error ?? this.i18n.auth.deniedDefault));
            rejectCode(new Error(`Strava OAuth denied: ${error ?? 'unknown'}`) );
          }
        } catch (e) {
          res.end(this.i18n.auth.internalError);
          rejectCode(e as Error);
        }
      });

      // Find a free port by binding to 0
      await new Promise<void>((res, rej) => server.listen(0, '127.0.0.1', (err: any) => err ? rej(err) : res()));
      const port = (server.address() as any).port;

      const redirectUri = `http://localhost:${port}`;
      const authUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&approval_prompt=force&scope=activity%3Aread_all`;

      // Open auth URL in the user's default browser
      const { shell } = (window as any).require('electron');
      await shell.openExternal(authUrl);

      new Notice(this.i18n.notices.stravaAuthorizeBrowser, 6000);

      // Wait for the redirect (timeout 5 min)
      const timeoutHandle = setTimeout(() => rejectCode(new Error('Timeout: pas de réponse Strava après 5 minutes')), 5 * 60 * 1000);
      const code = await codePromise;
      clearTimeout(timeoutHandle);

      const tokens = await StravaProvider.exchangeCode(clientId, clientSecret, code);
      this.settings.stravaAccessToken = tokens.accessToken;
      this.settings.stravaRefreshToken = tokens.refreshToken;
      this.settings.stravaExpiresAt = tokens.expiresAt;
      await this.saveSettings();

      // Invalidate cached HealthService so next call uses fresh tokens
      this.clearHealthServiceCache();

      new Notice(this.i18n.notices.stravaConnected);
    } catch (e) {
      logger.error('Strava connect error:', e);
      new Notice(this.i18n.notices.stravaError((e as Error).message));
    } finally {
      if (server) server.close();
    }
  }

  /** Open Google OAuth flow and exchange code for Google Health tokens */
  async connectGoogleHealth(): Promise<void> {
    const clientId = String(this.settings.googleClientId || '').trim();
    const clientSecret = String(this.settings.googleClientSecret || '').trim();
    const redirectUri = String((GOOGLE_OAUTH_CONFIG as any).redirectUri || '').trim();
    if (!clientId || !clientSecret || !redirectUri) {
      new Notice(this.i18n.notices.googleMissingCredentials);
      return;
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(redirectUri);
    } catch {
      new Notice(this.i18n.notices.googleError('redirect_uri invalide dans src/config/oauth.ts'));
      return;
    }
    const listenHost = redirectUrl.hostname;
    const listenPort = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80));
    const callbackPath = redirectUrl.pathname || '/';

    let server: any;
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    try {
      const http = (window as any).require('http');
      server = http.createServer((req: any, res: any) => {
        try {
          const url = new URL(req.url, redirectUrl.origin);
          if (url.pathname !== callbackPath) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
          }
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          if (code) {
            res.end(this.renderAuthHtml(this.i18n.auth.successTitle('Google Health'), this.i18n.auth.successCloseTab));
            resolveCode(code);
          } else {
            res.end(this.renderAuthHtml(this.i18n.auth.errorTitle, error ?? this.i18n.auth.deniedDefault));
            rejectCode(new Error(`Google OAuth denied: ${error ?? 'unknown'}`));
          }
        } catch (e) {
          res.end(this.i18n.auth.internalError);
          rejectCode(e as Error);
        }
      });

      await new Promise<void>((res, rej) => server.listen(listenPort, listenHost, (err: any) => err ? rej(err) : res()));

      const scopes = [
        'https://www.googleapis.com/auth/fitness.activity.read',
        'https://www.googleapis.com/auth/fitness.body.read',
        'https://www.googleapis.com/auth/fitness.heart_rate.read',
        'https://www.googleapis.com/auth/fitness.sleep.read',
      ].join(' ');

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(scopes)}`;

      const { shell } = (window as any).require('electron');
      await shell.openExternal(authUrl);
      new Notice(this.i18n.notices.googleAuthorizeBrowser, 6000);

      const timeoutHandle = setTimeout(() => rejectCode(new Error('Timeout: pas de réponse Google après 5 minutes')), 5 * 60 * 1000);
      const code = await codePromise;
      clearTimeout(timeoutHandle);

      const tokens = await GoogleHealthProvider.exchangeCode(clientId, clientSecret, code, redirectUri);
      this.settings.googleAccessToken = tokens.accessToken;
      this.settings.googleRefreshToken = tokens.refreshToken;
      this.settings.googleExpiresAt = tokens.expiresAt;
      await this.saveSettings();
      this.clearHealthServiceCache();
      new Notice(this.i18n.notices.googleConnected);
    } catch (e) {
      logger.error('Google Health connect error:', e);
      new Notice(this.i18n.notices.googleError((e as Error).message));
    } finally {
      if (server) server.close();
    }
  }

  

  // Write health data into a specific file's frontmatter
  async addDataToFile(file: any, date: Date, data: Partial<HealthData> & Record<string, any>) {
    const fileManager = this.app.fileManager;
    await fileManager.processFrontMatter(file, (frontmatter: any) => {
      frontmatter['date'] = date.toISOString().slice(0, 10);
      const set = (key: string, value: any) => {
        if (value !== undefined && value !== null) frontmatter[key] = value;
      };

      const toSportList = (value: any): string[] => {
        if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
        if (typeof value === 'string') return value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
        return [];
      };

      set('steps', data.steps);
      set('sleep', data.sleep);
      set('sleepScore', data.sleepScore);
      set('weight', data.weight);
      set('averageHeartRate', data.averageHeartRate);
      set('hrv', data.hrv);
      set('stress', data.stress);
      set('bodyBattery', data.bodyBattery);
      set('spO2', data.spO2);
      // Sport as emoji array (excludes cycling)
      if (data.sports && data.sports.length > 0) {
        const merged = [...new Set([
          ...toSportList(frontmatter['sport']),
          ...toSportList(frontmatter['sports']),
          ...data.sports.map((s) => String(s)).filter(Boolean),
        ])];
        frontmatter['sport'] = merged;
      }
      // Running / swimming distances (informational)
      set('runningDistance_km', data.runningDistance_km);
      set('SwimmingDistance_km', data.SwimmingDistance_km);
      // Cycling counted as transport
      set('transport_km', data.transport_km);
    });
  }

  // Legacy wrapper kept for any external callers
  async addDataToActiveFile(date: Date, data: any) {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(this.i18n.notices.noActiveFile); return; }
    await this.addDataToFile(file, date, data);
  }

  // Merge new frontmatter keys with existing ones, updating values if keys exist
  private mergeFrontmatterKeys(existingFm: string, newFrontmatter: string): string {
    const keysToUpdate = [
      'date', 'steps', 'sleep', 'sleepScore', 'weight', 'averageHeartRate', 'hrv', 'stress', 'bodyBattery', 'spO2',
      'didRunning', 'runningDistance_km', 'didSwimming', 'SwimmingDistance_km',
      'didCycling', 'cyclingDistance_km', 'transport_km', 'otherActivities'
    ];

    // Parse new frontmatter into key-value pairs
    const newKeys = new Map<string, string>();
    newFrontmatter.split('\n').forEach(line => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        newKeys.set(match[1], match[2]);
      }
    });

    // Update existing frontmatter
    let updatedFm = existingFm;
    keysToUpdate.forEach(key => {
      if (newKeys.has(key)) {
        const newValue = newKeys.get(key);
        // Replace existing key or add it
        const keyPattern = new RegExp(`^${key}:.*$`, 'm');
        if (keyPattern.test(updatedFm)) {
          updatedFm = updatedFm.replace(keyPattern, `${key}: ${newValue}`);
        } else {
          updatedFm = updatedFm.trim() + '\n' + `${key}: ${newValue}` + '\n';
        }
      }
    });

    // Ensure trailing newline
    return updatedFm.trim() + '\n';
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // One-time migration support from legacy static oauth.ts values.
    if (!this.settings.googleClientId && String(GOOGLE_OAUTH_CONFIG.clientId || '').trim()) {
      this.settings.googleClientId = String(GOOGLE_OAUTH_CONFIG.clientId || '').trim();
    }
    if (!this.settings.googleClientSecret && String(GOOGLE_OAUTH_CONFIG.clientSecret || '').trim()) {
      this.settings.googleClientSecret = String(GOOGLE_OAUTH_CONFIG.clientSecret || '').trim();
    }

    if (!Array.isArray(this.settings.enabledProviders)) {
      const legacy = String(this.settings.provider || 'garmin').toLowerCase();
      if (legacy === 'strava') this.settings.enabledProviders = ['strava'];
      else if (legacy === 'google') this.settings.enabledProviders = ['google'];
      else this.settings.enabledProviders = ['garmin'];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Date-range prompt ──────────────────────────────────────────────────────
  private promptForDateRange(): Promise<{ startDate: Date; endDate: Date; folder: string } | null> {
    // Default folder = parent of the currently active file (or vaultFolder setting)
    const activeFile = this.app.workspace.getActiveFile();
    const defaultFolder = activeFile?.parent?.path || this.settings.vaultFolder;
    return new Promise((resolve) => {
      new DateRangeModal(this.app, this.i18n, defaultFolder, resolve).open();
    });
  }

  // ── Batch note creation ────────────────────────────────────────────────────
  async batchCreateNotes(startDate: Date, endDate: Date, folder: string): Promise<void> {
    // Collect all dates in range (inclusive)
    const dates: Date[] = [];
    const cur = new Date(startDate);
    cur.setHours(12, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(12, 0, 0, 0);
    while (cur <= end) {
      dates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    if (dates.length === 0) { new Notice(this.i18n.notices.batchInvalidRange); return; }
    if (dates.length > 90) {
      new Notice(this.i18n.notices.batchRangeTooLong(dates.length));
      return;
    }

    // Ensure destination folder exists
    const targetFolder = folder.trim() || this.settings.vaultFolder;
    try {
      const existing = this.app.vault.getAbstractFileByPath(targetFolder);
      if (!existing) await this.app.vault.createFolder(targetFolder);
    } catch (e) { /* folder may already exist */ }

    const notice = new Notice(this.i18n.notices.batchCreating(dates.length), 0);
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const date of dates) {
      const dateStr = date.toISOString().slice(0, 10);
      const filePath = `${targetFolder}/${dateStr}.md`;

      // Skip if file already exists
      if (this.app.vault.getAbstractFileByPath(filePath)) {
        skipped++;
        continue;
      }

      try {
        // Fetch health data for this date
        let data: HealthData | null = null;
        try {
          data = (await this.fetchHealthData(date)).data;
        } catch (e) {
          logger.warn(`Fetch failed for ${dateStr}:`, e);
        }

        // Build the note content
        const content = this.buildNoteContent(date, data);
        await this.app.vault.create(filePath, content);
        created++;
        notice.setMessage(this.i18n.notices.batchProgress(created, dates.length));
      } catch (e) {
        logger.error(`Failed to create note for ${dateStr}:`, e);
        errors++;
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }

    notice.hide();
    const parts = [this.i18n.notices.batchCreated(created)];
    if (skipped > 0) parts.push(this.i18n.notices.batchSkipped(skipped));
    if (errors > 0) parts.push(this.i18n.notices.batchErrors(errors));
    new Notice(parts.join(', '), 5000);
  }

  /** Build a markdown note with YAML frontmatter for a given date + health data */
  private buildNoteContent(date: Date, data: HealthData | null): string {
    const dateStr = date.toISOString().slice(0, 10);
    const yv = (v: any) => (v !== null && v !== undefined) ? String(v) : '""';
    const sportYaml = data?.sports && data.sports.length > 0
      ? '\n  - ' + data.sports.join('\n  - ')
      : ' []';

    return [
      '---',
      'étiquettes:',
      '  - mHealth',
      '  - tracker',
      `date: "${dateStr}"`,
      `weight: ${yv(data?.weight)}`,
      `steps: ${yv(data?.steps)}`,
      `sports:${sportYaml}`,
      `sleep: ${yv(data?.sleep)}`,
      `sleepScore: ${yv(data?.sleepScore)}`,
      `averageHeartRate: ${yv(data?.averageHeartRate)}`,
      `hrv: ${yv(data?.hrv)}`,
      `stress: ${yv(data?.stress)}`,
      `bodyBattery: ${yv(data?.bodyBattery)}`,
      `spO2: ${yv(data?.spO2)}`,
      `transport_km: ${yv(data?.transport_km)}`,
      'alcool: ""',
      'fruits&vegetables: ""',
      'mood: ""',
      'reading: ""',
      'transport: ""',
      'km: 0',
      'co2: 0',
      '---',
      '',
      '# 💭 Rêves',
      '- ',
      '# 🧠  Faits marquants ',
      '- ',
      '# 😎 Pensées positives ',
      '1. Pensée 1',
      '2. ',
    ].join('\n');
  }
}


// ---------------------------------------------------------------------------
// Health Data Entry Modal
// Opens immediately when the command is invoked. The provider fetch runs in
// background and fills the fields when it resolves (overriding any manual
// input, since provider data is considered more reliable).
// ---------------------------------------------------------------------------
class HealthDataEntryModal extends Modal {
  private date: Date;
  private providerPromise: Promise<HealthData | null>;
  private i18n: any;
  private inputs = new Map<string, HTMLInputElement>();
  private statusEl!: HTMLElement;
  private resolveResult!: (data: Partial<HealthData> | null) => void;
  public readonly result: Promise<Partial<HealthData> | null>;
  /** True once provider data has been applied to the modal fields. */
  public filledByProvider = false;
  private closed = false;

  constructor(app: App, date: Date, providerPromise: Promise<HealthData | null>) {
    super(app);
    this.date = date;
    this.providerPromise = providerPromise;
    this.i18n = getLocale((this.app as any).language);
    this.result = new Promise(r => { this.resolveResult = r; });
  }

  onOpen() {
    const { contentEl } = this;
    const dateStr = this.date.toISOString().slice(0, 10);
    contentEl.empty();
    contentEl.createEl('h2', { text: this.i18n.modal.healthEntryTitle(dateStr) });

    this.statusEl = contentEl.createDiv({ cls: 'health-entry-status' });
    this.statusEl.setText(this.i18n.modal.healthEntryLoading);

    const form = contentEl.createDiv({ cls: 'health-entry-form' });

    const addField = (key: string, label: string, type: 'number' | 'text' = 'number', placeholder = '') => {
      const row = form.createDiv({ cls: 'health-entry-row' });
      row.createEl('label', { text: label, cls: 'health-entry-label' });
      const input = row.createEl('input', { cls: 'health-entry-input' }) as HTMLInputElement;
      input.type = type;
      if (type === 'number') input.step = 'any';
      if (placeholder) input.placeholder = placeholder;
      this.inputs.set(key, input);
    };

    addField('steps', this.i18n.modal.healthEntrySteps);
    addField('sleep', this.i18n.modal.healthEntrySleep);
    addField('sleepScore', this.i18n.modal.healthEntrySleepScore);
    addField('averageHeartRate', this.i18n.modal.healthEntryHeartRate);
    addField('weight', this.i18n.modal.healthEntryWeight);
    addField('sport', this.i18n.modal.healthEntrySport, 'text', this.i18n.modal.healthEntrySportPlaceholder);
    addField('transport_km', this.i18n.modal.healthEntryTransport);

    const btnRow = contentEl.createDiv({ cls: 'health-modal-buttons' });
    const cancelBtn = btnRow.createEl('button', { text: this.i18n.modal.cancel });
    const okBtn = btnRow.createEl('button', { text: `✅ ${this.i18n.modal.healthEntrySave}`, cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => { this.closed = true; this.resolveResult(null); this.close(); });
    okBtn.addEventListener('click', () => { this.closed = true; this.resolveResult(this.collectData()); this.close(); });

    // Listen for provider data arriving asynchronously
    this.providerPromise
      .then(data => {
        if (data) {
          this.fillFromProvider(data);
          this.filledByProvider = true;
        } else if (!this.closed) {
          this.statusEl.setText(`⚠️ ${this.i18n.modal.healthEntryProviderUnavailable}`);
          this.statusEl.removeClass('loading');
          this.statusEl.addClass('error');
        }
      })
      .catch(() => {
        if (!this.closed) {
          this.statusEl.setText(`⚠️ ${this.i18n.modal.healthEntryProviderUnavailable}`);
          this.statusEl.addClass('error');
        }
      });
  }

  private fillFromProvider(data: HealthData): void {
    if (this.closed) return;
    this.statusEl.setText(`✅ ${this.i18n.modal.healthEntryProviderReceived}`);
    this.statusEl.removeClass('loading');
    this.statusEl.addClass('success');

    const setNum = (key: string, value: number | null | undefined) => {
      if (value !== null && value !== undefined && !isNaN(value)) {
        const el = this.inputs.get(key);
        if (el) el.value = String(value);
      }
    };

    setNum('steps', data.steps);
    setNum('sleep', data.sleep);
    setNum('sleepScore', data.sleepScore);
    setNum('averageHeartRate', data.averageHeartRate);
    setNum('weight', data.weight);
    setNum('transport_km', data.transport_km);

    if (data.sports && data.sports.length > 0) {
      const el = this.inputs.get('sport');
      if (el) el.value = data.sports.join(' ');
    }
  }

  private collectData(): Partial<HealthData> {
    const num = (key: string): number | null => {
      const v = parseFloat(this.inputs.get(key)?.value ?? '');
      return isNaN(v) ? null : v;
    };
    const sportText = (this.inputs.get('sport')?.value ?? '').trim();
    const sports = sportText ? sportText.split(/\s+/).filter(Boolean) : [];
    return {
      steps: num('steps') != null ? Math.round(num('steps')!) : null,
      sleep: num('sleep'),
      sleepScore: num('sleepScore'),
      averageHeartRate: num('averageHeartRate'),
      weight: num('weight'),
      transport_km: num('transport_km'),
      sports,
    } as Partial<HealthData>;
  }

  onClose() {
    if (!this.closed) { this.resolveResult(null); this.closed = true; }
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------
// Folder Suggest Modal — lets user pick a vault folder from a fuzzy list
// ---------------------------------------------------------------------------
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private onChoose: (folderPath: string) => void;

  constructor(app: App, onChoose: (folderPath: string) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(getLocale((this.app as any).language).modal.folderSearchPlaceholder);
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder.path);
  }
}

// ---------------------------------------------------------------------------
// Date Range Modal — prompts user for a start/end date + destination folder
// ---------------------------------------------------------------------------
class DateRangeModal extends Modal {
  private i18n: any;
  private defaultFolder: string;
  private resolve: (result: { startDate: Date; endDate: Date; folder: string } | null) => void;

  constructor(
    app: App,
    i18n: any,
    defaultFolder: string,
    resolve: (result: { startDate: Date; endDate: Date; folder: string } | null) => void,
  ) {
    super(app);
    this.i18n = i18n;
    this.defaultFolder = defaultFolder;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.i18n.modal.batchTitle });

    const form = contentEl.createDiv({ cls: 'health-entry-form' });

    const addDateRow = (labelText: string): HTMLInputElement => {
      const row = form.createDiv({ cls: 'health-entry-row' });
      row.createEl('label', { text: labelText, cls: 'health-entry-label' });
      const input = row.createEl('input', { cls: 'health-entry-input' }) as HTMLInputElement;
      input.type = 'date';
      input.value = new Date().toISOString().slice(0, 10);
      return input;
    };

    const startInput = addDateRow(this.i18n.modal.batchStartLabel);
    const endInput   = addDateRow(this.i18n.modal.batchEndLabel);

    // Folder row — display + Browse button
    let selectedFolder = this.defaultFolder;
    const folderRow = form.createDiv({ cls: 'health-entry-row' });
    folderRow.createEl('label', { text: this.i18n.modal.batchFolder, cls: 'health-entry-label' });
    const folderCell = folderRow.createDiv({ attr: { style: 'display:flex;gap:0.4rem;align-items:center;flex:1;' } });
    const folderDisplay = folderCell.createEl('span', {
      cls: 'health-entry-folder-display',
      attr: { style: 'flex:1;padding:0.3rem 0.5rem;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);font-size:0.9em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
    });
    folderDisplay.setText(selectedFolder || '/');
    const browseBtn = folderCell.createEl('button', { text: `📂 ${this.i18n.modal.browseFolder}`, attr: { style: 'flex-shrink:0;' } });
    browseBtn.addEventListener('click', () => {
      new FolderSuggestModal(this.app, (folder) => {
        selectedFolder = folder;
        folderDisplay.setText(folder || '/');
      }).open();
    });

    const infoEl = contentEl.createDiv({ cls: 'health-entry-status', attr: { style: 'font-size:0.85em;color:var(--text-muted);margin-bottom:0.5rem;' } });
    const updateInfo = () => {
      const s = new Date(startInput.value);
      const e = new Date(endInput.value);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        infoEl.setText(`📅 ${this.i18n.modal.batchCount(days)}`);
      } else {
        infoEl.setText(`⚠️ ${this.i18n.modal.batchInvalidRange}`);
      }
    };
    startInput.addEventListener('change', updateInfo);
    endInput.addEventListener('change', updateInfo);
    updateInfo();

    const btnRow = contentEl.createDiv({ cls: 'health-modal-buttons' });
    const cancelBtn = btnRow.createEl('button', { text: this.i18n.modal.cancel });
    const okBtn     = btnRow.createEl('button', { text: this.i18n.modal.batchSubmit, cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => { this.resolve(null); this.close(); });
    okBtn.addEventListener('click', () => {
      const s = new Date(startInput.value);
      const e = new Date(endInput.value);
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
        infoEl.setText(`⚠️ ${this.i18n.modal.batchInvalidRangeCheck}`);
        return;
      }
      this.resolve({ startDate: s, endDate: e, folder: selectedFolder });
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class HealthConnectorSettingTab extends PluginSettingTab {
  plugin: HealthConnectorPlugin;

  constructor(app: App, plugin: HealthConnectorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: this.plugin.i18n.settings.title });

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

    // Provider selection (cumulative)
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

    // --- Garmin settings ---
    if (showGarmin) {
      containerEl.createEl('h3', { text: this.plugin.i18n.settings.garminSectionTitle });

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.username)
        .setDesc(this.plugin.i18n.settings.usernameDesc)
        .addText((text: any) =>
          text
            .setPlaceholder(this.plugin.i18n.settings.garminEmailPlaceholder)
            .setValue(this.plugin.settings.username)
            .onChange(async (value: string) => {
              this.plugin.settings.username = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.password)
        .setDesc(this.plugin.i18n.settings.passwordDesc)
        .addText((text: any) => {
          text
            .setPlaceholder(this.plugin.i18n.settings.password)
            .setValue(this.plugin.settings.password)
            .onChange(async (value: string) => {
              this.plugin.settings.password = value;
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
          } catch (e) {
            // ignore if inputEl not available at runtime
          }
          return text;
        });
    } // end Garmin

    // --- Strava settings ---
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
            .setValue(this.plugin.settings.stravaClientSecret || '')
            .onChange(async (value: string) => {
              this.plugin.settings.stravaClientSecret = value.trim();
              await this.plugin.saveSettings();
            });
          try {
            const inputEl = (text as any).inputEl as HTMLInputElement | undefined;
            if (inputEl) inputEl.setAttribute('type', 'password');
          } catch {}
          return text;
        });

      const isConnected = !!(this.plugin.settings.stravaRefreshToken);
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
    } // end if (provider === 'strava')

    // --- Google Health settings ---
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
            .setValue(this.plugin.settings.googleClientSecret || '')
            .onChange(async (value: string) => {
              this.plugin.settings.googleClientSecret = value.trim();
              await this.plugin.saveSettings();
            });
          try {
            const inputEl = (text as any).inputEl as HTMLInputElement | undefined;
            if (inputEl) inputEl.setAttribute('type', 'password');
          } catch {}
          return text;
        });

      const isGoogleConnected = !!(this.plugin.settings.googleRefreshToken);
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

    // Support / tip button
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
            } catch {}
          }
        });
      });

  }
}
