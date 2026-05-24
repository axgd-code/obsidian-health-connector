interface ResolveNoteDateDeps {
  basename: string;
  readContent: () => Promise<string>;
  warn?: (message: string, error: unknown) => void;
}

export async function resolveDateFromNote(deps: ResolveNoteDateDeps): Promise<Date | null> {
  // 1) Frontmatter date: YYYY-MM-DD
  try {
    const content = await deps.readContent();
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
    deps.warn?.('Failed reading date from frontmatter:', e);
  }

  // 2) Filename date: YYYY-MM-DD
  const nameMatch = deps.basename.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (nameMatch?.[1]) {
    const d = new Date(nameMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}
