import { record, str, safeUrl, screen } from './validation';
import { ApiError } from './validation';

export type ActorProfile = {
  platform?: string;
  profile_url?: string;
  discovery?: { method: string; url?: string; query?: string };
};
export function actorProfile(value: unknown): ActorProfile {
  const input = value === undefined ? {} : record(value, 'profile');
  const result: ActorProfile = {};
  const platform = str(input.platform, 'platform', 80).trim();
  if (platform) result.platform = platform;
  if (input.profile_url !== undefined)
    result.profile_url = safeUrl(input.profile_url);
  if (input.discovery !== undefined) {
    const discovery = record(input.discovery, 'discovery');
    const method = str(discovery.method, 'discovery.method', 30) || 'unknown';
    if (!['search', 'agent', 'link', 'other', 'unknown'].includes(method))
      throw new ApiError(
        422,
        'invalid_discovery',
        'discovery.method must be search, agent, link, other, or unknown',
      );
    result.discovery = { method };
    if (discovery.url !== undefined)
      result.discovery.url = safeUrl(discovery.url);
    const query = str(discovery.query, 'discovery.query', 240).trim();
    if (query) result.discovery.query = query;
  }
  screen(JSON.stringify(result));
  return result;
}
