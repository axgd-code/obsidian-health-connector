// Obsidian Plugin: Health Connector (full TypeScript, full JS)

import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, setIcon, FuzzySuggestModal, TFolder } from "obsidian";
import { GarminService } from "../garmin/garmin-service";
import { GarminProvider } from "../providers/GarminProvider";
import { StravaProvider } from "../providers/StravaProvider";
import type { StravaTokens } from "../providers/StravaProvider";
import type { IHealthProvider } from "../providers/IHealthProvider";
import type { HealthData } from "../types/health";
import { HealthService } from "../health/health-service";
import { buildObsidianNote } from "../config/template";
import { DEFAULT_SETTINGS } from "../config/config";
import { getLocale } from "../i18n";
import { logger } from "../common/Logger";

interface HealthConnectorSettings {
  username: string;
  password: string;
  vaultFolder: string;
  provider?: string; // e.g., 'garmin' | 'strava'
  stravaClientId?: string;
  stravaClientSecret?: string;
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaExpiresAt?: number;
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
  private _healthService: HealthService | null = null;
  private _healthServiceCredKey: string = '';

  async onload() {
    await this.loadSettings();
    // Update i18n with Obsidian's language setting
    this.i18n = getLocale((this.app as any).vault?.adapter?.basePath ? (this.app as any).language : undefined);

    // Expose public API for use by other plugins or templating engines
    // NOTE: API callers (e.g. Templater templates) handle their own form –
    // so syncToday/syncDate just fetch provider data and write it silently.
    this.api = {
      syncToday: () => this.writeProviderDataToActiveFile(new Date()),
      syncDate: (date: Date) => this.writeProviderDataToActiveFile(date),
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
          new Notice('⚠️ Date introuvable dans le fichier (frontmatter date: YYYY-MM-DD ou nom de fichier YYYY-MM-DD.md)');
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
    const loadingNotice = new Notice('⏳ Récupération données santé…', 0);
    const data = await this.fetchHealthData(date);
    loadingNotice.hide();
    // Ne pas écrire ici : si appelé depuis un template Templater,
    // celui-ci réécrira le fichier après et écrasera nos valeurs.
    // L'écriture est déléguée au template via setTimeout.
    return data;
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
    const loadingNotice = new Notice('⏳ Récupération des données santé…', 0);
    const providerData = await this.fetchHealthData(date);
    loadingNotice.hide();

    await this.addDataToFile(file, date, providerData ?? {});
    new Notice(this.i18n.notices.addedToFile);
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
  private async fetchHealthData(date: Date): Promise<HealthData | null> {
    try {
      const credKey = `${this.settings.provider || 'garmin'}:${this.settings.username}`;
      if (!this._healthService || this._healthServiceCredKey !== credKey) {
        const provider: IHealthProvider = this.resolveProvider();
        this._healthService = new HealthService(provider);
        this._healthServiceCredKey = credKey;
        await this._healthService.init();
      }
      return await this._healthService.getData(date);
    } catch (e) {
      if ((e as any).message === 'InteractiveAuthRequired') return null;
      this._healthService = null;
      this._healthServiceCredKey = '';
      logger.error('fetchHealthData failed:', e);
      return null;
    }
  }

  // Resolve selected provider
  private resolveProvider(): IHealthProvider {
    const key = (this.settings.provider || 'garmin').toLowerCase();
    switch (key) {
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
      new Notice('Strava: renseigne d\'abord le Client ID et le Client Secret.');
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
            res.end('<html><body><h2>✅ Strava connecté !</h2><p>Tu peux fermer cet onglet et retourner dans Obsidian.</p></body></html>');
            resolveCode(code);
          } else {
            res.end(`<html><body><h2>❌ Erreur</h2><p>${error ?? 'accès refusé'}</p></body></html>`);
            rejectCode(new Error(`Strava OAuth denied: ${error ?? 'unknown'}`) );
          }
        } catch (e) {
          res.end('error');
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

      new Notice('Autorise l\'accès dans le navigateur qui vient de s\'ouvrir…', 6000);

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
      this._healthService = null;
      this._healthServiceCredKey = '';

      new Notice('✅ Strava connecté avec succès !');
    } catch (e) {
      logger.error('Strava connect error:', e);
      new Notice(`❌ Strava: ${(e as Error).message}`);
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
      set('steps', data.steps);
      set('sleep', data.sleep);
      set('sleepScore', data.sleepScore);
      set('weight', data.weight);
      set('averageHeartRate', data.averageHeartRate);
      // Sport as emoji array (excludes cycling)
      if (data.sports && data.sports.length > 0) frontmatter['sport'] = data.sports;
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
      'date', 'steps', 'sleep', 'weight', 'averageHeartRate',
      'didRunning', 'runningDistance_km', 'didSwimming', 'SwimmingDistance_km',
      'didCycling', 'cyclingDistance_km', 'otherActivities'
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

    if (dates.length === 0) { new Notice('⚠️ Plage de dates invalide'); return; }
    if (dates.length > 90) {
      new Notice(`⚠️ Plage trop longue (${dates.length} jours > 90). Réduis la plage.`);
      return;
    }

    // Ensure destination folder exists
    const targetFolder = folder.trim() || this.settings.vaultFolder;
    try {
      const existing = this.app.vault.getAbstractFileByPath(targetFolder);
      if (!existing) await this.app.vault.createFolder(targetFolder);
    } catch (e) { /* folder may already exist */ }

    const notice = new Notice(`⏳ Création de ${dates.length} notes…`, 0);
    let created = 0;
    let skipped = 0;
    let errors = 0;

    // Init health service once for the whole batch
    try {
      const credKey = `${this.settings.provider || 'garmin'}:${this.settings.username}`;
      if (!this._healthService || this._healthServiceCredKey !== credKey) {
        this._healthService = new HealthService(this.resolveProvider());
        this._healthServiceCredKey = credKey;
        await this._healthService.init();
      }
    } catch (e) {
      notice.hide();
      new Notice(`❌ Impossible d'initialiser le provider: ${(e as Error).message}`);
      return;
    }

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
          data = await this._healthService!.getData(date);
        } catch (e) {
          logger.warn(`Fetch failed for ${dateStr}:`, e);
        }

        // Build the note content
        const content = this.buildNoteContent(date, data);
        await this.app.vault.create(filePath, content);
        created++;
        notice.setMessage(`⏳ ${created}/${dates.length} notes créées…`);
      } catch (e) {
        logger.error(`Failed to create note for ${dateStr}:`, e);
        errors++;
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }

    notice.hide();
    const parts = [`✅ ${created} note(s) créée(s)`];
    if (skipped > 0) parts.push(`${skipped} déjà existante(s)`);
    if (errors > 0) parts.push(`${errors} erreur(s)`);
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
    this.result = new Promise(r => { this.resolveResult = r; });
  }

  onOpen() {
    const { contentEl } = this;
    const dateStr = this.date.toISOString().slice(0, 10);
    contentEl.empty();
    contentEl.createEl('h2', { text: `Données santé – ${dateStr}` });

    this.statusEl = contentEl.createDiv({ cls: 'health-entry-status' });
    this.statusEl.setText('⏳ Récupération provider en cours…');

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

    addField('steps', '👣 Pas');
    addField('sleep', '💤 Sommeil (min)');
    addField('sleepScore', '💤 Score sommeil');
    addField('averageHeartRate', '❤️ FC repos (bpm)');
    addField('weight', '⚖️ Poids (kg)');
    addField('sport', '🏅 Sport', 'text', 'ex : 🏃 🏊');
    addField('transport_km', '🚲 Vélo – transport (km)');

    const btnRow = contentEl.createDiv({ cls: 'health-modal-buttons' });
    const cancelBtn = btnRow.createEl('button', { text: 'Annuler' });
    const okBtn = btnRow.createEl('button', { text: '✅ Enregistrer', cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => { this.closed = true; this.resolveResult(null); this.close(); });
    okBtn.addEventListener('click', () => { this.closed = true; this.resolveResult(this.collectData()); this.close(); });

    // Listen for provider data arriving asynchronously
    this.providerPromise
      .then(data => {
        if (data) {
          this.fillFromProvider(data);
          this.filledByProvider = true;
        } else if (!this.closed) {
          this.statusEl.setText('⚠️ Provider indisponible – saisie manuelle');
          this.statusEl.removeClass('loading');
          this.statusEl.addClass('error');
        }
      })
      .catch(() => {
        if (!this.closed) {
          this.statusEl.setText('⚠️ Provider indisponible – saisie manuelle');
          this.statusEl.addClass('error');
        }
      });
  }

  private fillFromProvider(data: HealthData): void {
    if (this.closed) return;
    this.statusEl.setText('✅ Données reçues du provider');
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
    this.setPlaceholder('Rechercher un dossier…');
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
    const folderCell = folderRow.createDiv({ style: 'display:flex;gap:0.4rem;align-items:center;flex:1;' });
    const folderDisplay = folderCell.createEl('span', {
      cls: 'health-entry-folder-display',
      attr: { style: 'flex:1;padding:0.3rem 0.5rem;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);font-size:0.9em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
    });
    folderDisplay.setText(selectedFolder || '/');
    const browseBtn = folderCell.createEl('button', { text: '📂 Parcourir', attr: { style: 'flex-shrink:0;' } });
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
        infoEl.setText(`📅 ${days} note(s) à créer`);
      } else {
        infoEl.setText('⚠️ Plage invalide');
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
        infoEl.setText('⚠️ Plage invalide — vérifie les dates');
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

    // Provider selection
    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Source de données santé")
      .addDropdown((dd: any) => {
        dd.addOption('garmin', 'Garmin');
        dd.addOption('strava', 'Strava');
        dd.setValue(this.plugin.settings.provider || 'garmin');
        dd.onChange(async (value: string) => {
          this.plugin.settings.provider = value;
          await this.plugin.saveSettings();
          // Re-render to show the correct provider section
          this.display();
        });
      });

    const provider = this.plugin.settings.provider || 'garmin';

    // --- Garmin settings ---
    if (provider === 'garmin') {
      containerEl.createEl('h3', { text: 'Garmin Connect' });

      new Setting(containerEl)
        .setName(this.plugin.i18n.settings.username)
        .setDesc(this.plugin.i18n.settings.usernameDesc)
        .addText((text: any) =>
          text
            .setPlaceholder("email Garmin")
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
    if (provider === 'strava') {
      containerEl.createEl('h3', { text: 'Strava' });

      new Setting(containerEl)
        .setName('Client ID')
        .setDesc('ID de ton application Strava (strava.com/settings/api)')
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
        .setName('Client Secret')
        .setDesc('Secret de ton application Strava')
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
        .setName('Connexion Strava')
        .setDesc(isConnected ? '✅ Compte connecté. Clique pour reconnecter.' : 'Clique pour autoriser l\'accès à tes activités Strava.')
        .addButton((btn: any) => {
          btn.setButtonText(isConnected ? 'Reconnecter' : 'Connecter Strava');
          if (!isConnected) btn.setCta?.();
          btn.onClick(async () => {
            await this.plugin.connectStrava();
            this.display();
          });
        });
    } // end if (provider === 'strava')

    // Support / tip button (i18n)
    new Setting(containerEl)
      .setName(this.plugin.i18n.settings.supportTitle)
      .setDesc(this.plugin.i18n.settings.supportDesc)
      .addButton((btn: any) => {
        btn.setButtonText(this.plugin.i18n.settings.supportButton);
        btn.setCta?.();
        btn.onClick(() => {
          try {
            const a = document.createElement('a') as HTMLAnchorElement;
            a.href = 'https://paypal.me/axgdco';
            a.target = '_blank';
            a.rel = 'noopener';
            a.click();
          } catch (e) {
            try {
              (window as any).open('https://paypal.me/axgdco', '_blank');
            } catch {}
          }
        });
      });
  }
}
