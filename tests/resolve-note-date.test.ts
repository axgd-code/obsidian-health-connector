import { describe, expect, test, vi } from 'vitest';
import { resolveDateFromNote } from '../src/application/health/services/resolveNoteDate';

describe('resolveDateFromNote', () => {
  test('resolves date from frontmatter when available', async () => {
    const date = await resolveDateFromNote({
      basename: 'no-date-name',
      readContent: async () => '---\ndate: 2026-05-20\n---\n# Note',
    });

    expect(date?.toISOString().slice(0, 10)).toBe('2026-05-20');
  });

  test('falls back to basename date when frontmatter is missing', async () => {
    const date = await resolveDateFromNote({
      basename: '2026-05-21',
      readContent: async () => '# Note without frontmatter',
    });

    expect(date?.toISOString().slice(0, 10)).toBe('2026-05-21');
  });

  test('returns null when neither frontmatter nor basename has a date', async () => {
    const date = await resolveDateFromNote({
      basename: 'daily-note',
      readContent: async () => '---\ntitle: No date\n---\n# Note',
    });

    expect(date).toBeNull();
  });

  test('logs warning when frontmatter read fails and still checks basename', async () => {
    const warn = vi.fn();

    const date = await resolveDateFromNote({
      basename: '2026-05-22',
      readContent: async () => {
        throw new Error('Read failed');
      },
      warn,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(date?.toISOString().slice(0, 10)).toBe('2026-05-22');
  });
});
