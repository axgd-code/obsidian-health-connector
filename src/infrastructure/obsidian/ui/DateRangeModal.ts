import { App, FuzzySuggestModal, Modal, TFolder } from 'obsidian';
import { getLocale } from '../../../i18n';

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

export interface DateRangeResult {
  startDate: Date;
  endDate: Date;
  folder: string;
}

export class DateRangeModal extends Modal {
  private i18n: any;
  private defaultFolder: string;
  private resolve: (result: DateRangeResult | null) => void;

  constructor(
    app: App,
    i18n: any,
    defaultFolder: string,
    resolve: (result: DateRangeResult | null) => void,
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
    const endInput = addDateRow(this.i18n.modal.batchEndLabel);

    let selectedFolder = this.defaultFolder;
    const folderRow = form.createDiv({ cls: 'health-entry-row' });
    folderRow.createEl('label', { text: this.i18n.modal.batchFolder, cls: 'health-entry-label' });
    const folderCell = folderRow.createDiv({ attr: { style: 'display:flex;gap:0.4rem;align-items:center;flex:1;' } });
    const folderDisplay = folderCell.createEl('span', {
      cls: 'health-entry-folder-display',
      attr: {
        style: 'flex:1;padding:0.3rem 0.5rem;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);font-size:0.9em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
      },
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
    const okBtn = btnRow.createEl('button', { text: this.i18n.modal.batchSubmit, cls: 'mod-cta' });

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
