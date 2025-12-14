export { default as authRoutes } from './auth.routes';
export { default as oauthRoutes } from './oauth.routes';
export * from './auth.service';
export * from './auth.schema';
export * from './oauth.schema';
// Re-export oauth.service functions explicitly to avoid name conflicts
export {
  startGoogleOAuth,
  completeGoogleOAuth,
  linkGoogleIdentity,
  refreshAccessToken as refreshAccessTokenWithSession,
  logout,
  sendPhoneOtp,
  verifyPhoneOtp,
  linkPhone,
  createCaseAccessToken,
  verifyCaseAccessToken,
} from './oauth.service';
