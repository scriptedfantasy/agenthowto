import handler from 'vinext/server/fetch-handler';
import { cachedHome } from './lib/home-cache';

const worker = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const start = performance.now();
    const response = await cachedHome(
      request,
      (next) => handler.fetch(next, env, ctx),
      (work) => ctx.waitUntil(work),
    );
    const headers = new Headers(response.headers);
    headers.append(
      'Server-Timing',
      'agenthow;dur=' + Math.round(performance.now() - start),
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
export default worker;
