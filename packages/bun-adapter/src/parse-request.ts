import { supportedActions, type AuthConfig, type AuthError, type NotHandled, type RequestContext, type RuntimeAdapter, type SupportedAction } from '@authia/contracts';

type ParseInput = Parameters<RuntimeAdapter['parseRequest']>[0];

const sensitiveHeaders = new Set(['authorization', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto']);

function runtimeMisconfigured(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'RUNTIME_MISCONFIGURED',
    message,
    retryable: false
  };
}

function invalidInputResult() {
  return {
    kind: 'denied' as const,
    code: 'INVALID_INPUT' as const
  };
}

type ParseDeniedResult = ReturnType<typeof invalidInputResult> | { kind: 'denied'; code: 'AMBIGUOUS_CREDENTIALS' };

function normalizeHeaders(inputHeaders: Record<string, string | string[]>) {
  const normalized: Record<string, string> = {};
  const duplicates = new Set<string>();

  for (const [rawName, rawValue] of Object.entries(inputHeaders)) {
    const name = rawName.toLowerCase();
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (values.length !== 1 || name in normalized) {
      duplicates.add(name);
      continue;
    }
    normalized[name] = values[0];
  }

  return { normalized, duplicates };
}

function resolveAction(config: AuthConfig, method: string, pathname: string): SupportedAction | null {
  for (const action of supportedActions) {
    if (config.entrypointMethods[action] === method && config.entrypointPaths[action] === pathname) {
      return action;
    }
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRelativeRedirect(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

export async function parseRequest(
  input: ParseInput,
  config: Pick<
    AuthConfig,
    'entrypointMethods' | 'entrypointPaths' | 'entrypointTransport' | 'sessionCookieName' | 'publicOrigin' | 'trustedForwardedHeaders'
  >
): Promise<RequestContext | NotHandled | ParseDeniedResult | AuthError> {
  const parsedUrl = new URL(input.url);
  const action = resolveAction(config as AuthConfig, input.method.toUpperCase(), parsedUrl.pathname);
  if (!action) {
    return { kind: 'notHandled' };
  }

  const { normalized: headers, duplicates } = normalizeHeaders(input.headers);
  for (const name of duplicates) {
    if (sensitiveHeaders.has(name) || config.trustedForwardedHeaders.includes(name as 'x-forwarded-host' | 'x-forwarded-proto')) {
      return invalidInputResult();
    }
  }

  const trustedForwardedHost = headers['x-forwarded-host'];
  const trustedForwardedProto = headers['x-forwarded-proto'];
  const expectsForwarded = config.trustedForwardedHeaders.length > 0;
  if (expectsForwarded && Boolean(trustedForwardedHost) !== Boolean(trustedForwardedProto)) {
    return runtimeMisconfigured('Both x-forwarded-host and x-forwarded-proto must be present together.');
  }
  if (expectsForwarded && trustedForwardedHost && trustedForwardedProto) {
    const forwardedOrigin = `${trustedForwardedProto}://${trustedForwardedHost}`;
    const expectedOrigin = new URL(config.publicOrigin).origin;
    if (forwardedOrigin !== expectedOrigin) {
      return runtimeMisconfigured('Forwarded host/proto must match publicOrigin.');
    }
  }

  const cookieToken = input.cookies[config.sessionCookieName];
  const authorization = headers.authorization;
  let bearerToken: string | undefined;
  if (authorization !== undefined) {
    if (!authorization.startsWith('Bearer ')) {
      return invalidInputResult();
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token || token.includes(' ')) {
      return invalidInputResult();
    }
    bearerToken = token;
  }

  if (cookieToken && bearerToken) {
    return { kind: 'denied', code: 'AMBIGUOUS_CREDENTIALS' };
  }

  const expectedTransport = config.entrypointTransport[action];
  if (!expectedTransport) {
    return invalidInputResult();
  }
  const credential = bearerToken ? { kind: 'bearer' as const, token: bearerToken } : cookieToken ? { kind: 'cookie' as const, token: cookieToken } : undefined;
  if (credential && credential.kind !== expectedTransport) {
    return invalidInputResult();
  }

  let body: RequestContext['body'] = undefined;
  if (input.body !== undefined) {
    if (typeof input.body === 'string') {
      try {
        const parsedBody = JSON.parse(input.body);
        if (!parsedBody || typeof parsedBody !== 'object') {
          return invalidInputResult();
        }
        body = parsedBody as RequestContext['body'];
      } catch {
        return invalidInputResult();
      }
    } else if (typeof input.body === 'object' && input.body !== null) {
      body = input.body as RequestContext['body'];
    } else {
      return invalidInputResult();
    }
  }

  if (action === 'startOAuth') {
    if (!body || !isNonEmptyString(body.provider)) {
      return invalidInputResult();
    }
    if (body.redirectTo !== undefined) {
      if (typeof body.redirectTo !== 'string' || !isRelativeRedirect(body.redirectTo)) {
        return invalidInputResult();
      }
    }
  }

  if (action === 'finishOAuth') {
    if (!body || !isNonEmptyString(body.provider) || !isNonEmptyString(body.code) || !isNonEmptyString(body.state)) {
      return invalidInputResult();
    }
  }

  return {
    action,
    runtime: 'node',
    method: input.method.toUpperCase(),
    url: input.url,
    transport: credential?.kind ?? expectedTransport,
    headers,
    cookies: input.cookies,
    credential,
    body
  };
}
