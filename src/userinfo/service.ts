import { InvalidResponseError } from "../errors";
import { object, optionalString, type UserInfoTransport } from "../internal/userinfo";
import type { LoginUserInfo, MiniAppUserInfo, UserInfo, UserInfoOptions } from "./types";

function common(data: Record<string, unknown>): UserInfo {
  const phoneNumber = optionalString(data, "phone_number");
  const verified = data.phone_number_verified;
  if ((phoneNumber !== undefined && !/^\+[0-9]{7,15}$/.test(phoneNumber)) ||
      (verified != null && typeof verified !== "boolean")) throw new InvalidResponseError("invalid UserInfo response");
  return {
    sub: data.sub as string,
    phoneNumber,
    phoneNumberVerified: phoneNumber !== undefined && typeof verified === "boolean" ? verified : undefined,
  };
}

export class LoginService {
  constructor(private readonly transport: UserInfoTransport) {}

  /** Current data authorized by a Login user access token. Scopes are chosen at sign-in. */
  async getUserInfo(accessToken: string, options: UserInfoOptions = {}): Promise<LoginUserInfo> {
    const data = await this.transport.get("login", accessToken, options);
    return Object.freeze({ ...common(data), name: optionalString(data, "name"),
      preferredUsername: optionalString(data, "preferred_username"), picture: optionalString(data, "picture") });
  }
}

export class MiniAppsService {
  constructor(private readonly transport: UserInfoTransport) {}

  /** Current data authorized by the short-lived ma_ token from LinkMiniApp.init(). */
  async getUserInfo(accessToken: string, options: UserInfoOptions = {}): Promise<MiniAppUserInfo> {
    const data = await this.transport.get("miniapps", accessToken, options);
    const profile = data.profile == null ? undefined : object(data.profile);
    return Object.freeze({ ...common(data), profile: profile === undefined ? undefined : Object.freeze({
      name: optionalString(profile, "name"), username: optionalString(profile, "username"),
      avatarUrl: optionalString(profile, "avatar_url"),
    }) });
  }
}
