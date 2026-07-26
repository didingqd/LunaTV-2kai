import { readFileSync } from 'fs';
import path from 'path';

describe('play page favorite identity boundary', () => {
  it('matches favorites only with current source and id', () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), 'src/app/play/page.tsx'),
      'utf8',
    );
    const matcherStart = pageSource.indexOf('const findMatchedFavoriteKey');
    const matcherEnd = pageSource.indexOf(
      '  // 每当真实资源 source/id 变化时检查收藏状态',
      matcherStart,
    );
    const matcher = pageSource.slice(matcherStart, matcherEnd);

    expect(matcherStart).toBeGreaterThanOrEqual(0);
    expect(matcherEnd).toBeGreaterThan(matcherStart);
    // Stage 7.7: the matcher must not inspect title/douban/bangumi/shortdrama
    // metadata. Same-title resources from different sources remain independent,
    // and unfavoriting B cannot resolve or delete A's favorite key.
    expect(matcher).toContain('findResourceFavoriteReminderKey');
    expect(matcher).toContain('source: currentSource');
    expect(matcher).toContain('id: currentId');
    expect(matcher).not.toContain('videoTitleRef.current');
    expect(matcher).not.toContain("source: 'douban'");
    expect(matcher).not.toContain("source: 'bangumi'");
    expect(matcher).not.toContain("source: 'shortdrama'");
    expect(matcher).not.toContain('fav as any');
  });
});
