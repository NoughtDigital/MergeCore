import type { ProdRiskRule } from '../types';

/**
 * Missing rate limits: public endpoints, authentication endpoints, and
 * expensive operations exposed without any throttle. These are the
 * paths that turn a tiny spike into an incident.
 */
export const NO_RATE_LIMIT_RULES: readonly ProdRiskRule[] = [
  {
    id: 'php:rl:laravel-route-group-no-throttle',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'warning',
    title: 'Public Laravel route group without throttle middleware',
    description:
      'A route group that is not `auth:*` protected and carries no `throttle:` middleware is reachable at unbounded rates — which login, password-reset, and signup endpoints cannot afford.',
    fixHint:
      'Apply `->middleware(["throttle:60,1"])` or a named limiter (`RateLimiter::for("api", …)`) and revisit the values per endpoint sensitivity.',
    origin: 'builtin',
    languages: ['php'],
    filePathIncludes: ['routes/', '/web.php', '/api.php'],
    patterns: [
      String.raw`Route::(?:post|put|patch|delete)\s*\(`,
    ],
    negativePatterns: [
      String.raw`throttle\s*:`,
      String.raw`->middleware\s*\([^)]*throttle`,
      String.raw`RateLimiter::for\s*\(`,
    ],
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'routing'],
  },
  {
    id: 'ts:rl:express-no-rate-limit',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'warning',
    title: 'Express app mounts routes without a rate limiter',
    description:
      'An Express app that never registers `express-rate-limit` or a reverse-proxy rate limit is exposed to trivially easy brute-force and scraping.',
    fixHint:
      'Add `app.use(rateLimit({ windowMs: 60_000, max: 100 }))` at minimum, and tighter limits on `/login`, `/register`, `/password-reset`.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`(?:express\s*\(\s*\)|app\s*=\s*express\s*\(\s*\))`,
    ],
    negativePatterns: [
      String.raw`express-rate-limit`,
      String.raw`rateLimit\s*\(`,
      String.raw`rate-limiter-flexible`,
    ],
    tags: ['express', 'node'],
  },
  {
    id: 'ts:rl:fastify-no-rate-limit',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'hint',
    title: 'Fastify instance without @fastify/rate-limit',
    description:
      'Fastify servers benefit from `@fastify/rate-limit`; without it, endpoints have no default throttling at the app layer.',
    fixHint:
      'Register `await app.register(import("@fastify/rate-limit"), { max: 100, timeWindow: "1 minute" })`.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`(?:Fastify\s*\(|fastify\s*\()`,
    ],
    negativePatterns: [
      String.raw`@fastify/rate-limit`,
    ],
    tags: ['fastify', 'node'],
  },
  {
    id: 'py:rl:flask-no-rate-limit',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'warning',
    title: 'Flask app without Flask-Limiter',
    description:
      'Flask apps that never import `flask_limiter` have no in-process rate limit; the auth endpoints are the first thing scraped.',
    fixHint:
      'Add `Limiter(get_remote_address, app=app, default_limits=["100/hour"])` and decorate sensitive routes with tighter `@limiter.limit(...)`.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`Flask\s*\(\s*__name__\s*\)`,
    ],
    negativePatterns: [
      String.raw`flask_limiter`,
      String.raw`Flask-Limiter`,
    ],
    tags: ['flask', 'python'],
  },
  {
    id: 'py:rl:fastapi-no-rate-limit',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'hint',
    title: 'FastAPI app without slowapi / equivalent limiter',
    description:
      'FastAPI does not ship a rate limiter. Without `slowapi`, a cloud reverse-proxy policy, or an API gateway, every endpoint is unbounded.',
    fixHint:
      'Install `slowapi`, register its middleware, and tag sensitive routes with `@limiter.limit("5/minute")`.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`FastAPI\s*\(`,
    ],
    negativePatterns: [
      String.raw`slowapi`,
      String.raw`Limiter\s*\(`,
    ],
    tags: ['fastapi', 'python'],
  },
  {
    id: 'go:rl:http-handler-no-limiter',
    ruleVersion: '1',
    category: 'no-rate-limits',
    severity: 'hint',
    title: 'Go HTTP mux has no golang.org/x/time/rate limiter',
    description:
      'A `net/http` or `chi.Router` server with no middleware from `golang.org/x/time/rate` or a CDN policy in front has no limit on requests per second.',
    fixHint:
      'Wrap the handler in a `rate.Limiter` middleware (`func(next http.Handler) http.Handler { … }`).',
    origin: 'builtin',
    languages: ['go'],
    patterns: [
      String.raw`http\.ListenAndServe\s*\(`,
    ],
    negativePatterns: [
      String.raw`golang\.org/x/time/rate`,
      String.raw`rate\.NewLimiter\s*\(`,
    ],
    tags: ['go', 'net/http'],
  },
];
