/** @jest-environment node */

import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const domainTerms = [
  ['watch', 'ing'].join(''),
  ['update', 'check'].join('-'),
  ['epi', 'sode'].join(''),
  ['fol', 'low'].join(''),
  ['down', 'load'].join(''),
  ['rem', 'inder'].join(''),
  ['play', 'record'].join('-'),
  ['latest', 'episode'].join('-'),
  ['manual', 'trigger'].join('-'),
  ['sche', 'duler'].join(''),
];

const compatibilityFiles = new Set([
  'notification-event-adapter.ts',
  'notification-event-builder.ts',
  'notification-dispatcher.ts',
  'notification-manager.ts',
  'notification-types.ts',
]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function readSources() {
  const root = __dirname;
  return listSourceFiles(root)
    .filter((file) => path.basename(file) !== path.basename(__filename))
    .map((file) => ({
      file,
      relative: path.relative(root, file),
      source: readFileSync(file, 'utf8'),
    }));
}

describe('notification architecture boundary', () => {
  it('does not import business-domain modules into the framework', () => {
    const violations = readSources().flatMap(({ relative, source }) => {
      const hasForbiddenImport = domainTerms.some((term) =>
        new RegExp(
          String.raw`(?:from|import)\s+['"].*${term.replace('-', '[-_]')}`,
          'i',
        ).test(source),
      );
      return hasForbiddenImport ? [relative] : [];
    });

    expect(violations).toEqual([]);
  });

  it('does not contain business-domain event strings in framework sources', () => {
    const violations = readSources().flatMap(({ relative, source }) => {
      const hasForbiddenString = domainTerms.some((term) =>
        source.toLowerCase().includes(term.toLowerCase()),
      );
      return hasForbiddenString ? [relative] : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps legacy NotificationEvent APIs inside compatibility files only', () => {
    const violations = readSources().flatMap(({ relative, source }) => {
      if (compatibilityFiles.has(relative)) return [];
      if (relative.endsWith('.test.ts') || relative.endsWith('.test.tsx')) {
        return [];
      }
      return /\bNotificationEvent\b|\bNotificationEventType\b|dispatchEvent\(|\.emit\(/.test(
        source,
      )
        ? [relative]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps providers on the NotificationMessage send boundary', () => {
    const providerRoot = path.join(__dirname, 'providers');
    const channelRoot = path.join(__dirname, 'channels');
    const violations = [
      ...listSourceFiles(providerRoot),
      ...listSourceFiles(channelRoot),
    ]
      .filter((file) => !file.endsWith('.test.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const relative = path.relative(__dirname, file);
        if (/NotificationEvent/.test(source)) return [relative];
        return /NotificationMessage/.test(source) ? [] : [relative];
      });

    expect(violations).toEqual([]);
  });
});
