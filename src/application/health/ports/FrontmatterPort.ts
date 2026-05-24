export type FrontmatterRecord = Record<string, unknown>;

export interface FrontmatterPort<TFile = unknown> {
  processFrontmatter(file: TFile, updater: (frontmatter: FrontmatterRecord) => void): Promise<void>;
}
