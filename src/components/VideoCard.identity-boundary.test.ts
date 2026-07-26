import { readFileSync } from 'fs';
import path from 'path';

describe('VideoCard resource identity boundary', () => {
  it('does not generate Favorite/Remark identity for aggregate search cards', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/components/VideoCard.tsx'),
      'utf8',
    );
    const boundaryStart = source.indexOf(
      'const blocksAggregateResourceState = from ===',
    );
    const boundaryEnd = source.indexOf('useEffect(() => {', boundaryStart);
    const boundary = source.slice(boundaryStart, boundaryEnd);

    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundaryEnd).toBeGreaterThan(boundaryStart);
    // Stage 7.7: aggregate cards are display groups. They must not synthesize
    // resource-state identities such as search_aggregate/title keys or douban
    // metadata identities before a concrete source/id has been selected.
    expect(boundary).toContain("from === 'search' && isAggregate");
    expect(boundary).toContain("blocksAggregateResourceState ? '' : actualSource");
    expect(boundary).toContain("blocksAggregateResourceState ? '' : actualId");
    expect(boundary).not.toContain('search_aggregate');
    expect(boundary).not.toContain('searchAggregateFavoriteId');
  });
});
