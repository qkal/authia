import type {
  EntrypointMethodMap,
  EntrypointPathMap,
  EntrypointTransportMap,
  SessionTransportMode,
  SupportedAction
} from './actions.js';
import type { AuthError, DeniedCode } from './errors.js';
import type {
  AuthenticatedSession,
  PresentedCredential,
  SessionRecord,
  SessionTransport,
  User
} from './session.js';
import type { Policy } from './plugin.js';

export type CookieMutation = {
  name: string;
  value?: string;
  options?: {
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    domain?: string;
    path?: string;
    httpOnly?: true;
    expires?: string;
    maxAge?: number;
  };
};

export type ResponseMutations = {
  headers?: Record<string, string | string[]>;
  setCookies?: CookieMutation[];
  clearCookies?: CookieMutation[];
  clearBearer?: boolean;
  redirectTo?: string;
};

export type AdapterResponse = {
  status: number;
  headers: Record<string, string | string[]>;
  setCookies?: CookieMutation[];
  clearCookies?: CookieMutation[];
  clearBearer?: boolean;
  body?: unknown;
};

export type NotHandled = {
  kind: 'notHandled';
};

export type RequestContext = {
  action: SupportedAction;
  runtime: 'node';
  method: string;
  url: string;
  transport: 'cookie' | 'bearer';
  headers: Record<string, string>;
  cookies: Record<string, string>;
  credential?: PresentedCredential;
  body?: {
    email?: string;
    password?: string;
    provider?: string;
    redirectTo?: string;
    code?: string;
    state?: string;
  };
  session?: AuthenticatedSession | null;
};

export type AuthResult =
  | {
      kind: 'success';
      action: 'signUpWithPassword' | 'signInWithPassword' | 'refreshSession' | 'finishOAuth';
      subject: User;
      session: SessionRecord;
      transport: SessionTransport;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'success';
      action: 'getSession';
      subject: User;
      session: SessionRecord;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'success';
      action: 'logout' | 'logoutAll';
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'denied';
      code: DeniedCode;
      responseMutations?: ResponseMutations;
    }
  | {
      kind: 'redirect';
      responseMutations: ResponseMutations & { redirectTo: string };
    }
  | {
      kind: 'unauthenticated';
      code: 'INVALID_CREDENTIALS' | 'SESSION_EXPIRED' | 'SESSION_REVOKED';
      responseMutations?: ResponseMutations;
    };

export type AuthConfig = {
  sessionTransportMode: SessionTransportMode;
  entrypointMethods: EntrypointMethodMap;
  entrypointTransport: EntrypointTransportMap;
  entrypointPaths: EntrypointPathMap;
  policies: Policy[];
  runtimeAdapter: 'node';
  storageAdapter: 'postgres';
  cryptoProvider: 'default';
  plugins: Array<'emailPassword' | 'oauth'>;
  publicOrigin: string;
  trustedForwardedHeaders: Array<'x-forwarded-host' | 'x-forwarded-proto'>;
  cookieOptions: {
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
    httpOnly: true;
  };
  sessionCookieName: string;
};

export type RuntimeAdapter = {
  parseRequest: (input: {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
    cookies: Record<string, string>;
    body?: unknown;
  }) => Promise<RequestContext | NotHandled | AuthResult | AuthError>;
  applyResult: (result: AuthResult | AuthError) => Promise<AdapterResponse | AuthError>;
  capabilities: () => { cookies: true; headers: true; redirects: boolean };
};
