import type { AuthConfig, AuthError, AuthResult, Plugin, PluginServices, RequestContext } from '@authia/contracts';
import { createRollbackSignal } from '../../kernel/rollback-signal.js';

function isAuthError<T>(value: T | AuthError): value is AuthError {
  return typeof value === 'object' && value !== null && 'category' in value && 'code' in value;
}

function isRollbackSignal(error: unknown): error is { outcome: AuthResult | AuthError } {
  return typeof error === 'object' && error !== null && 'outcome' in error;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().normalize('NFC');
}

function hasExactlyOneAt(email: string): boolean {
  return email.split('@').length === 2;
}

function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

function invalidInput() {
  return { kind: 'denied' as const, code: 'INVALID_INPUT' as const };
}

function storageUnavailable(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: false
  };
}

async function executeSignUp(context: RequestContext, services: PluginServices): Promise<AuthResult | AuthError> {
  const email = context.body?.email;
  const password = context.body?.password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return invalidInput();
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !hasExactlyOneAt(normalizedEmail) || !isValidPassword(password)) {
    return invalidInput();
  }

  try {
    const outcome = await services.storage.beginTransaction(async (tx) => {
      const hash = await services.crypto.hashSecret(password);
      if (isAuthError(hash)) {
        throw createRollbackSignal(hash);
      }

      const user = await tx.users.create({});
      if (isAuthError(user)) {
        throw createRollbackSignal(user);
      }

      const identity = await tx.identities.create({
        userId: user.id,
        normalizedEmail,
        passwordHash: hash
      });
      if (isAuthError(identity)) {
        if (identity.code === 'DUPLICATE_IDENTITY') {
          throw createRollbackSignal({ kind: 'denied', code: 'DUPLICATE_IDENTITY' });
        }
        throw createRollbackSignal(identity);
      }

      const issued = await services.sessions.issueSession(user, tx, context);
      if (isAuthError(issued)) {
        throw createRollbackSignal(issued);
      }

      return {
        kind: 'success' as const,
        action: 'signUpWithPassword' as const,
        subject: user,
        session: issued.session,
        transport: issued.transport
      };
    });

    return outcome;
  } catch (error) {
    if (isRollbackSignal(error)) {
      return error.outcome;
    }
    return storageUnavailable('Sign-up transaction failed unexpectedly.');
  }
}

async function executeSignIn(context: RequestContext, services: PluginServices): Promise<AuthResult | AuthError> {
  const email = context.body?.email;
  const password = context.body?.password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return invalidInput();
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !hasExactlyOneAt(normalizedEmail) || !isValidPassword(password)) {
    return invalidInput();
  }

  const identity = await services.storage.identities.findByNormalizedEmail(normalizedEmail);
  if (isAuthError(identity)) {
    return identity;
  }

  if (!identity) {
    return { kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' };
  }

  const verified = await services.crypto.verifySecret(password, identity.passwordHash);
  if (isAuthError(verified)) {
    return verified;
  }
  if (!verified) {
    return { kind: 'unauthenticated', code: 'INVALID_CREDENTIALS' };
  }

  const user = await services.storage.users.find(identity.userId);
  if (isAuthError(user)) {
    return user;
  }
  if (!user) {
    return storageUnavailable('Identity user could not be loaded.');
  }

  try {
    const outcome = await services.storage.beginTransaction(async (tx) => {
      const issued = await services.sessions.issueSession(user, tx, context);
      if (isAuthError(issued)) {
        throw createRollbackSignal(issued);
      }
      return {
        kind: 'success' as const,
        action: 'signInWithPassword' as const,
        subject: user,
        session: issued.session,
        transport: issued.transport
      };
    });
    return outcome;
  } catch (error) {
    if (isRollbackSignal(error)) {
      return error.outcome;
    }
    return storageUnavailable('Sign-in transaction failed unexpectedly.');
  }
}

export function createEmailPasswordPlugin(): Plugin {
  return {
    id: 'emailPassword',
    actions: () => ['signUpWithPassword', 'signInWithPassword'],
    validateConfig: (config: AuthConfig) => {
      if (!config.entrypointPaths.signUpWithPassword || !config.entrypointPaths.signInWithPassword) {
        return {
          ok: false,
          code: 'RUNTIME_MISCONFIGURED',
          message: 'Email/password entrypoint paths are required.'
        };
      }

      return { ok: true };
    },
    execute: async (action, context, services) => {
      if (action === 'signUpWithPassword') {
        return executeSignUp(context, services);
      }
      if (action === 'signInWithPassword') {
        return executeSignIn(context, services);
      }
      return invalidInput();
    }
  };
}
