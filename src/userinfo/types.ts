export interface UserInfoOptions {
  /** Subject from your verified Login/Mini App session. Reject a different user. */
  expectedSub?: string;
  signal?: AbortSignal;
}

export interface UserInfo {
  readonly sub: string;
  readonly phoneNumber?: string;
  /** Absence does not mean false or verified ownership. */
  readonly phoneNumberVerified?: boolean;
}

export interface LoginUserInfo extends UserInfo {
  readonly name?: string;
  readonly preferredUsername?: string;
  readonly picture?: string;
}

export interface MiniAppProfile {
  readonly name?: string;
  readonly username?: string;
  readonly avatarUrl?: string;
}

export interface MiniAppUserInfo extends UserInfo {
  readonly profile?: MiniAppProfile;
}
