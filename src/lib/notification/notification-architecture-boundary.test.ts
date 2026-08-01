/** @jest-environment node */

import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const forbiddenImportPatterns = [
  /from\s+['"].*(watching|update-check|download|reminder|play-record|latest-episode|manual-trigger|scheduler)/,
  /import\s+['"].*(watching|update-check|download|reminder|play-record|latest-episode|manual-trigger|scheduler)/,
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe('notification architecture boundary', () => {
  it('does not import business-domain modules into the framework', () => {
    const root = path.join(__dirname);
    const violations = listSourceFiles(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbiddenImportPatterns.some((pattern) => pattern.test(source))
        ? [path.relative(root, file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
