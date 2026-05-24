import type { FileManager, TFile } from 'obsidian';
import type { FrontmatterPort, FrontmatterRecord } from '../../../application/health/ports/FrontmatterPort';

export class ObsidianFrontmatterPort implements FrontmatterPort<TFile> {
  private fileManager: FileManager;

  constructor(fileManager: FileManager) {
    this.fileManager = fileManager;
  }

  async processFrontmatter(file: TFile, updater: (frontmatter: FrontmatterRecord) => void): Promise<void> {
    await this.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
      updater(frontmatter as FrontmatterRecord);
    });
  }
}
