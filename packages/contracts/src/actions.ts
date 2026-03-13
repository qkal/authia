export const supportedActions = [
  'signUpWithPassword',
  'signInWithPassword',
  'getSession',
  'refreshSession',
  'logout',
  'logoutAll'
] as const;

export type SupportedAction = (typeof supportedActions)[number];

export type SessionTransportMode = 'cookie' | 'bearer' | 'both';

export type EntrypointMethodMap = {
  signUpWithPassword: 'POST';
  signInWithPassword: 'POST';
  getSession: 'GET';
  refreshSession: 'POST';
  logout: 'POST';
  logoutAll: 'POST';
};

export type EntrypointTransportMap = {
  signUpWithPassword: 'cookie' | 'bearer';
  signInWithPassword: 'cookie' | 'bearer';
  getSession: 'cookie' | 'bearer';
  refreshSession: 'cookie' | 'bearer';
  logout: 'cookie' | 'bearer';
  logoutAll: 'cookie' | 'bearer';
};

export type EntrypointPathMap = {
  signUpWithPassword: string;
  signInWithPassword: string;
  getSession: string;
  refreshSession: string;
  logout: string;
  logoutAll: string;
};

export const defaultEntrypointMethods = {
  signUpWithPassword: 'POST',
  signInWithPassword: 'POST',
  getSession: 'GET',
  refreshSession: 'POST',
  logout: 'POST',
  logoutAll: 'POST'
} as const satisfies EntrypointMethodMap;
