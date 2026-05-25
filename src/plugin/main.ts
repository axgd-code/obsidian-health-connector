// Obsidian Plugin: Health Connector (full TypeScript, full JS)

import { Plugin, Notice, TFile } from "obsidian";
import type { HealthData } from "../domain/health/entities/HealthData";
import { DEFAULT_SETTINGS } from "../config/config";
import { GOOGLE_OAUTH_CONFIG } from "../config/oauth";
import { getLocale } from "../i18n";
import { logger } from "../shared/logging/Logger";
import { mergeProviderHealthData } from "../domain/health/services/mergeProviderHealthData";
import { ObsidianFrontmatterPort } from '../infrastructure/obsidian/adapters/ObsidianFrontmatterPort';
import { WriteHealthFrontmatterUseCase } from '../application/health/usecases/WriteHealthFrontmatterUseCase';
import { buildHealthNoteContent } from '../application/health/services/buildHealthNoteContent';
import { SecretSettingsService, type SecretKey } from '../application/health/services/secretSettingsService';
import { buildProviderCredKey, getEnabledProviders, type ProviderKey } from '../application/health/services/providerConfigService';
import { ProviderFetchOrchestrator, type FetchHealthDataResult } from '../application/health/services/providerFetchOrchestrator';
import { createProviderFactory } from '../application/health/services/providerFactory';
import { resolveDateFromNote } from '../application/health/services/resolveNoteDate';
import { DateRangeModal, type DateRangeResult } from '../infrastructure/obsidian/ui/DateRangeModal';
import { HealthConnectorSettingTab } from '../infrastructure/obsidian/ui/HealthConnectorSettingTab';
import { connectGoogleOAuth, connectStravaOAuth } from '../infrastructure/obsidian/auth/oauthConnectors';

interface HealthConnectorSettings {
  username?: string;
  password?: string;
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
  private _providerFetch!: ProviderFetchOrchestrator;
  private _writeHealthFrontmatter!: WriteHealthFrontmatterUseCase<TFile>;
  private _secretSettings!: SecretSettingsService;

  public getSecret(secret: SecretKey): string {
    return this._secretSettings.get(secret);
  }

  public setSecret(secret: SecretKey, value: string) {
    this._secretSettings.set(secret, value);
  }

  async onload() {
    this._secretSettings = new SecretSettingsService(this.app.secretStorage, logger);
    await this.loadSettings();
    this._writeHealthFrontmatter = new WriteHealthFrontmatterUseCase<TFile>(
      new ObsidianFrontmatterPort(this.app.fileManager),
    );
    this._providerFetch = new ProviderFetchOrchestrator({
      getEnabledProviders: () => this.getEnabledProviders(),
      buildProviderCredKey: (key) => this.buildProviderCredKey(key),
      resolveProvider: createProviderFactory({
        settings: this.settings,
        getSecret: (secret) => this.getSecret(secret),
        setSecret: (secret, value) => this.setSecret(secret, value),
        saveSettings: () => this.saveSettings(),
      }),
      mergeProviderHealthData: (entries) => mergeProviderHealthData(entries),
      logger,
    });
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

    // Provide a global token store for garmin-connect via Obsidian Secret Storage
    try {
      (globalThis as any).__HealthConnectorPluginInstance = this;
      const existing = await this.loadData() || {};
      const legacyTokens = (existing as any).tokens ?? null;
      const storedTokens = this._secretSettings.getGarminTokenCache();
      const initialTokens = storedTokens ?? legacyTokens;
      if (!storedTokens && legacyTokens) {
        this._secretSettings.setGarminTokenCache(legacyTokens);
      }
      (globalThis as any).__GarminTokenCache = initialTokens;
      (globalThis as any).__GarminTokenStore = {
        syncLoad: () => {
          return (globalThis as any).__GarminTokenCache || null;
        },
        syncSave: (tokens: any) => {
          (globalThis as any).__GarminTokenCache = tokens;
          setTimeout(async () => {
            try {
              this._secretSettings.setGarminTokenCache(tokens);
              logger.info('Tokens persisted via secret storage');
            } catch (e) {
              logger.warn('Failed to persist tokens via secret storage', e);
            }
          }, 0);
        },
        syncClear: () => {
          (globalThis as any).__GarminTokenCache = null;
          setTimeout(async () => {
            try {
              this._secretSettings.setGarminTokenCache(null);
              logger.info('Tokens cleared via secret storage');
            } catch (e) {
              logger.warn('Failed to clear tokens via secret storage', e);
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

  private async resolveDateFromFile(file: TFile): Promise<Date | null> {
    return resolveDateFromNote({
      basename: String(file.basename || ''),
      readContent: async () => this.app.vault.read(file),
      warn: (message, error) => logger.warn(message, error),
    });
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
    return this._providerFetch.fetch(date);
  }

  private getProviderDisplayName(key: ProviderKey): string {
    if (key === 'garmin') return this.i18n.settings.providerGarminName;
    if (key === 'strava') return this.i18n.settings.providerStravaName;
    return this.i18n.settings.providerGoogleName;
  }

  private clearHealthServiceCache() {
    this._providerFetch.clearCache();
  }

  public invalidateProviderCache() {
    this.clearHealthServiceCache();
  }

  private getEnabledProviders(): ProviderKey[] {
    return getEnabledProviders(this.settings);
  }

  private buildProviderCredKey(key: ProviderKey): string {
    return buildProviderCredKey(key, this.settings, (secret) => this.getSecret(secret));
  }

  /** Open Strava OAuth flow in the browser and exchange the code for tokens */
  async connectStrava(): Promise<void> {
    const clientId = this.settings.stravaClientId?.trim();
    const clientSecret = this.getSecret('stravaClientSecret').trim();
    if (!clientId || !clientSecret) {
      new Notice(this.i18n.notices.stravaMissingCredentials);
      return;
    }
    await connectStravaOAuth({
      clientId,
      clientSecret,
      i18n: this.i18n,
      logger,
      onTokens: async (tokens) => {
        this.setSecret('stravaAccessToken', tokens.accessToken);
        this.setSecret('stravaRefreshToken', tokens.refreshToken);
        this.settings.stravaExpiresAt = tokens.expiresAt;
        await this.saveSettings();
        this.clearHealthServiceCache();
      },
    });
  }

  /** Open Google OAuth flow and exchange code for Google Health tokens */
  async connectGoogleHealth(): Promise<void> {
    const clientId = String(this.settings.googleClientId || '').trim();
    const clientSecret = this.getSecret('googleClientSecret').trim();
    const redirectUri = String((GOOGLE_OAUTH_CONFIG as any).redirectUri || '').trim();
    if (!clientId || !clientSecret || !redirectUri) {
      new Notice(this.i18n.notices.googleMissingCredentials);
      return;
    }
    await connectGoogleOAuth({
      clientId,
      clientSecret,
      redirectUri,
      i18n: this.i18n,
      logger,
      onTokens: async (tokens) => {
        this.setSecret('googleAccessToken', tokens.accessToken);
        this.setSecret('googleRefreshToken', tokens.refreshToken);
        this.settings.googleExpiresAt = tokens.expiresAt;
        await this.saveSettings();
        this.clearHealthServiceCache();
      },
    });
  }

  

  // Write health data into a specific file's frontmatter
  async addDataToFile(file: TFile, date: Date, data: Partial<HealthData> & Record<string, unknown>) {
    await this._writeHealthFrontmatter.execute(file, date, data);
  }

  // Legacy wrapper kept for any external callers
  async addDataToActiveFile(date: Date, data: any) {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(this.i18n.notices.noActiveFile); return; }
    await this.addDataToFile(file, date, data);
  }

  async loadSettings() {
    const persisted = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, persisted);
    const hadLegacySensitiveFields = this._secretSettings.hasLegacySensitiveFields(
      persisted as Record<string, unknown>,
    );

    const migrated = this._secretSettings.migrateLegacySecretsFromSettings(this.settings as unknown as Record<string, unknown>);

    // One-time migration support from legacy static oauth.ts values.
    if (!this.settings.googleClientId && String(GOOGLE_OAUTH_CONFIG.clientId || '').trim()) {
      this.settings.googleClientId = String(GOOGLE_OAUTH_CONFIG.clientId || '').trim();
    }
    if (!this.getSecret('googleClientSecret') && String(GOOGLE_OAUTH_CONFIG.clientSecret || '').trim()) {
      this.setSecret('googleClientSecret', String(GOOGLE_OAUTH_CONFIG.clientSecret || '').trim());
    }

    if (!Array.isArray(this.settings.enabledProviders)) {
      const legacy = String(this.settings.provider || 'garmin').toLowerCase();
      if (legacy === 'strava') this.settings.enabledProviders = ['strava'];
      else if (legacy === 'google') this.settings.enabledProviders = ['google'];
      else this.settings.enabledProviders = ['garmin'];
    }

    this._secretSettings.sanitizeSettingsForPersist(this.settings as unknown as Record<string, unknown>);
    if (migrated || hadLegacySensitiveFields) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    this._secretSettings.sanitizeSettingsForPersist(this.settings as unknown as Record<string, unknown>);
    await this.saveData(this.settings);
  }

  // ── Date-range prompt ──────────────────────────────────────────────────────
  private promptForDateRange(): Promise<DateRangeResult | null> {
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
        const content = buildHealthNoteContent(date, data);
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

}
