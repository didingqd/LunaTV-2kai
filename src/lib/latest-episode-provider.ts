import { getAvailableApiSites } from './config';
import { getDetailFromApi } from './downstream';

export interface LatestEpisodeRequest {
  userId: string;
  source: string;
  resourceId: string;
  title?: string;
}

export interface LatestEpisodeSnapshot {
  latestEpisode: number;
  metadata?: {
    sourceName?: string;
    cover?: string;
    year?: string;
    type?: string;
  };
}

export interface LatestEpisodeProvider {
  supports(source: string): boolean;
  getLatestEpisode(
    request: LatestEpisodeRequest,
  ): Promise<LatestEpisodeSnapshot>;
}

/** CMS provider: only retrieves the current detail and episode count. */
export class CmsLatestEpisodeProvider implements LatestEpisodeProvider {
  supports(source: string): boolean {
    return source !== 'emby' && !source.startsWith('emby_');
  }

  async getLatestEpisode(
    request: LatestEpisodeRequest,
  ): Promise<LatestEpisodeSnapshot> {
    const sites = await getAvailableApiSites(request.userId);
    const site = sites.find((candidate) => candidate.key === request.source);
    if (!site) throw new Error(`Invalid API source: ${request.source}`);

    const detail = await getDetailFromApi(site, request.resourceId);
    return {
      latestEpisode: Array.isArray(detail.episodes)
        ? detail.episodes.length
        : 0,
      metadata: {
        sourceName: detail.source_name,
        cover: detail.poster,
        year: detail.year,
        type: detail.type_name,
      },
    };
  }
}

/** Emby provider: resource access is scoped to the requesting user. */
export class EmbyLatestEpisodeProvider implements LatestEpisodeProvider {
  supports(source: string): boolean {
    return source === 'emby' || source.startsWith('emby_');
  }

  async getLatestEpisode(
    request: LatestEpisodeRequest,
  ): Promise<LatestEpisodeSnapshot> {
    const { embyManager } = await import('./emby-manager');
    const embyKey = request.source.startsWith('emby_')
      ? request.source.substring(5)
      : undefined;
    const client = await embyManager.getClientForUser(request.userId, embyKey);
    const item = await client.getItem(request.resourceId);

    if (item.Type === 'Movie') {
      return {
        latestEpisode: 1,
        metadata: {
          sourceName: 'Emby',
          year: item.ProductionYear?.toString() || '',
          type: 'movie',
        },
      };
    }

    if (item.Type !== 'Series') throw new Error('Unsupported Emby media type');

    const seasons = await client.getSeasons(item.Id);
    let latestEpisode = 0;
    for (const season of seasons) {
      const episodes = await client.getEpisodes(item.Id, season.Id);
      latestEpisode += episodes.length;
    }

    return {
      latestEpisode,
      metadata: {
        sourceName: 'Emby',
        year: item.ProductionYear?.toString() || '',
        type: 'tv',
      },
    };
  }
}

export class LatestEpisodeProviderRegistry {
  constructor(
    private readonly providers: LatestEpisodeProvider[] = [
      new EmbyLatestEpisodeProvider(),
      new CmsLatestEpisodeProvider(),
    ],
  ) {}

  get(source: string): LatestEpisodeProvider {
    const provider = this.providers.find((candidate) =>
      candidate.supports(source),
    );
    if (!provider) throw new Error(`No latest episode provider for ${source}`);
    return provider;
  }
}

export const latestEpisodeProviderRegistry =
  new LatestEpisodeProviderRegistry();
