import type { AuthConfig, AuthError, AuthResult, Plugin, PluginServices, RequestContext } from '@authia/contracts';
import { createRollbackSignal } from '../../kernel/rollback-signal.js';
import { createEmailDeliveryClient } from './delivery-client.js';

const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

function runtimeMisconfigured(message: string): AuthError {
  return {
    category: 'infrastructure',
    code: 'RUNTIME_MISCONFIGURED',
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

async function executeRequestPasswordReset(
  context: RequestContext,
  services: PluginServices
): Promise<AuthResult | AuthError> {
  const email = context.body?.email;
  if (typeof email !== 'string') {
    return invalidInput();
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !hasExactlyOneAt(normalizedEmail)) {
    return invalidInput();
  }

  if (!services.storage.passwordResetTokens) {
    return runtimeMisconfigured('Password reset token storage is not configured.');
  }

  const identity = await services.storage.identities.findByNormalizedEmail(normalizedEmail);
  if (isAuthError(identity)) {
    return identity;
  }

  if (identity) {
    const token = await services.crypto.generateOpaqueToken();
    if (isAuthError(token)) {
      return token;
    }

    const tokenHash = await services.crypto.deriveTokenId(token);
    if (isAuthError(tokenHash)) {
      return tokenHash;
    }

    const created = await services.storage.passwordResetTokens.create({
      tokenHash,
      normalizedEmail,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString()
    });
    if (isAuthError(created)) {
      return storageUnavailable(created.message);
    }

    if (services.emailDelivery) {
      const emailDelivery = createEmailDeliveryClient({ emailDelivery: services.emailDelivery });
      const delivered = await emailDelivery.sendPasswordReset({
        email: normalizedEmail,
        resetToken: token
      });
      if (isAuthError(delivered)) {
        return storageUnavailable(delivered.message);
      }
    }
  }

  return {
    kind: 'success',
    action: 'requestPasswordReset'
  };
}

async function executeResetPassword(context: RequestContext, services: PluginServices): Promise<AuthResult | AuthError> {
  const resetToken = context.body?.resetToken;
  const password = context.body?.password;
  if (typeof resetToken !== 'string' || typeof password !== 'string') {
    return invalidInput();
  }
  if (!resetToken.trim() || !isValidPassword(password)) {
    return invalidInput();
  }

  const tokenHash = await services.crypto.deriveTokenId(resetToken);
  if (isAuthError(tokenHash)) {
    return tokenHash;
  }

  try {
    const outcome = await services.storage.beginTransaction(async (tx) => {
      if (!tx.passwordResetTokens) {
        throw createRollbackSignal(runtimeMisconfigured('Password reset token storage is not configured.'));
      }

      const consumed = await tx.passwordResetTokens.consume({
        tokenHash,
        nowIso: new Date().toISOString()
      });
      if (isAuthError(consumed)) {
        throw createRollbackSignal(consumed);
      }
      if (!consumed) {
        throw createRollbackSignal(invalidInput());
      }

      const passwordHash = await services.crypto.hashSecret(password);
      if (isAuthError(passwordHash)) {
        throw createRollbackSignal(passwordHash);
      }

      const updatedIdentity = await tx.identities.updatePasswordHashByNormalizedEmail(
        consumed.normalizedEmail,
        passwordHash
      );
      if (isAuthError(updatedIdentity)) {
        throw createRollbackSignal(updatedIdentity);
      }
      if (!updatedIdentity) {
        throw createRollbackSignal(invalidInput());
      }

      const revokedCount = await services.sessions.revokeAllSessions(updatedIdentity.userId, tx);
      if (isAuthError(revokedCount)) {
        throw createRollbackSignal(revokedCount);
      }

      return {
        kind: 'success' as const,
        action: 'resetPassword' as const
      };
    });

    return outcome;
  } catch (error) {
    if (isRollbackSignal(error)) {
      return error.outcome;
    }
    return storageUnavailable('Password reset transaction failed unexpectedly.');
  }
}

async function executeRequestEmailVerification(
  context: RequestContext,
  services: PluginServices
): Promise<AuthResult | AuthError> {
  const email = context.body?.email;
  if (typeof email !== 'string') {
    return invalidInput();
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !hasExactlyOneAt(normalizedEmail)) {
    return invalidInput();
  }

  if (!services.storage.emailVerificationTokens || !services.storage.verifiedEmails) {
    return runtimeMisconfigured('Email verification storage is not configured.');
  }

  const identity = await services.storage.identities.findByNormalizedEmail(normalizedEmail);
  if (isAuthError(identity)) {
    return identity;
  }

  if (identity) {
    const existingVerification = await services.storage.verifiedEmails.find(normalizedEmail);
    if (isAuthError(existingVerification)) {
      return existingVerification;
    }

    if (!existingVerification) {
      const token = await services.crypto.generateOpaqueToken();
      if (isAuthError(token)) {
        return token;
      }

      const tokenHash = await services.crypto.deriveTokenId(token);
      if (isAuthError(tokenHash)) {
        return tokenHash;
      }

      const created = await services.storage.emailVerificationTokens.create({
        tokenHash,
        normalizedEmail,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS).toISOString()
      });
      if (isAuthError(created)) {
        return storageUnavailable(created.message);
      }

      if (services.emailDelivery) {
        const emailDelivery = createEmailDeliveryClient({ emailDelivery: services.emailDelivery });
        const delivered = await emailDelivery.sendEmailVerification({
          email: normalizedEmail,
          verificationToken: token
        });
        if (isAuthError(delivered)) {
          return storageUnavailable(delivered.message);
        }
      }
    }
  }

  return {
    kind: 'success',
    action: 'requestEmailVerification'
  };
}

async function executeVerifyEmail(context: RequestContext, services: PluginServices): Promise<AuthResult | AuthError> {
  const verificationToken = context.body?.verificationToken;
  if (typeof verificationToken !== 'string' || !verificationToken.trim()) {
    return invalidInput();
  }

  const tokenHash = await services.crypto.deriveTokenId(verificationToken);
  if (isAuthError(tokenHash)) {
    return tokenHash;
  }

  try {
    const outcome = await services.storage.beginTransaction(async (tx) => {
      if (!tx.emailVerificationTokens || !tx.verifiedEmails) {
        throw createRollbackSignal(runtimeMisconfigured('Email verification storage is not configured.'));
      }

      const consumed = await tx.emailVerificationTokens.consume({
        tokenHash,
        nowIso: new Date().toISOString()
      });
      if (isAuthError(consumed)) {
        throw createRollbackSignal(consumed);
      }
      if (!consumed) {
        throw createRollbackSignal(invalidInput());
      }

      const marked = await tx.verifiedEmails.markVerified(consumed.normalizedEmail, new Date().toISOString());
      if (isAuthError(marked)) {
        throw createRollbackSignal(marked);
      }

      return {
        kind: 'success' as const,
        action: 'verifyEmail' as const
      };
    });

    return outcome;
  } catch (error) {
    if (isRollbackSignal(error)) {
      return error.outcome;
    }
    return storageUnavailable('Email verification transaction failed unexpectedly.');
  }
}

export function createEmailPasswordPlugin(): Plugin {
  return {
    id: 'emailPassword',
    actions: () => [
      'signUpWithPassword',
      'signInWithPassword',
      'requestPasswordReset',
      'resetPassword',
      'requestEmailVerification',
      'verifyEmail'
    ],
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
      if (action === 'requestPasswordReset') {
        return executeRequestPasswordReset(context, services);
      }
      if (action === 'resetPassword') {
        return executeResetPassword(context, services);
      }
      if (action === 'requestEmailVerification') {
        return executeRequestEmailVerification(context, services);
      }
      if (action === 'verifyEmail') {
        return executeVerifyEmail(context, services);
      }
      return invalidInput();
    }
  };
}
