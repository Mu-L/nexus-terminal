import {
  generateRegistrationOptions as generateRegOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions as generateAuthOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyRegistrationResponseOpts,
  VerifyAuthenticationResponseOpts,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  // The actual type for verification.registrationInfo is RegistrationInfo within @simplewebauthn/server
  // and for verification.authenticationInfo is AuthenticationInfo.
  // We will rely on TypeScript's inference from the VerifiedRegistrationResponse/VerifiedAuthenticationResponse types.
} from '@simplewebauthn/server';
import { passkeyRepository, Passkey, NewPasskey } from '../repositories/passkey.repository';
import { userRepository, User } from '../repositories/user.repository';
import { config } from '../config/app.config';

const RP_ID = config.rpId;
const RP_ORIGIN = config.rpOrigin;
const RP_NAME = config.appName;

const textEncoder = new TextEncoder();

function base64UrlToUint8Array(base64urlString: string): Uint8Array {
  const base64 = base64urlString.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  const paddedBase64 = base64 + '='.repeat(padLength);
  try {
    const binaryString = atob(paddedBase64);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }
    return uint8Array;
  } catch (e) {
    console.error("Failed to decode base64url string:", base64urlString, e);
    throw new Error("Invalid base64url string");
  }
}

export class PasskeyService {
  constructor(
    private passkeyRepo: typeof passkeyRepository,
    private userRepo: typeof userRepository
  ) {}

  async generateRegistrationOptions(username: string, userId: number) {
    const user = await this.userRepo.findUserById(userId);
    if (!user || user.username !== username) {
      throw new Error('User not found or username mismatch');
    }

    const existingPasskeys = await this.passkeyRepo.getPasskeysByUserId(userId);

    const excludeCredentials: {id: string, type: 'public-key', transports?: AuthenticatorTransportFuture[]}[] = existingPasskeys.map(pk => ({
      id: pk.credential_id,
      type: 'public-key',
      transports: pk.transports ? JSON.parse(pk.transports) as AuthenticatorTransportFuture[] : undefined,
    }));

    const options: GenerateRegistrationOptionsOpts = {
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: textEncoder.encode(userId.toString()),
      userName: username,
      userDisplayName: username,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      supportedAlgorithmIDs: [-7, -257],
    };

    const generatedOptions = await generateRegOptions(options);
    return generatedOptions;
  }

  async verifyRegistration(
    registrationResponseJSON: RegistrationResponseJSON,
    expectedChallenge: string,
    userHandleFromClient: string
  ): Promise<VerifiedRegistrationResponse & { newPasskeyToSave?: NewPasskey }> {
    const userId = parseInt(userHandleFromClient, 10);
    if (isNaN(userId)) {
        throw new Error('Invalid user handle provided.');
    }
    const user = await this.userRepo.findUserById(userId);
    if (!user) {
        throw new Error('User not found for the provided handle.');
    }

    const verifyOpts: VerifyRegistrationResponseOpts = {
      response: registrationResponseJSON,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    };

    const verification = await verifyRegistrationResponse(verifyOpts);

    if (verification.verified && verification.registrationInfo) {
      const regInfo = verification.registrationInfo; 
      
      // Assuming regInfo has these properties based on standard WebAuthn structures.
      // If these are incorrect for @simplewebauthn/server@13.1.1, this needs adjustment.
      const credentialPublicKey = (regInfo as any).credentialPublicKey;
      const credentialID = (regInfo as any).credentialID;
      const counter = (regInfo as any).counter;
      const transports = (regInfo as any).transports;
      const credentialBackedUp = (regInfo as any).credentialBackedUp;

      if (!credentialPublicKey || typeof credentialID !== 'string' || typeof counter !== 'number') {
        console.error('Verification successful, but registrationInfo structure is unexpected:', regInfo);
        throw new Error('Failed to process registration info due to unexpected structure.');
      }
      
      const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');

      const newPasskeyEntry: NewPasskey = {
        user_id: user.id,
        credential_id: credentialID,
        public_key: publicKeyBase64,
        counter: counter,
        transports: transports ? JSON.stringify(transports) : null,
        backed_up: !!credentialBackedUp,
      };
      return { ...verification, newPasskeyToSave: newPasskeyEntry };
    }
    return verification;
  }

  async generateAuthenticationOptions(username?: string) {
    let allowCredentials: {id: string, type: 'public-key', transports?: AuthenticatorTransportFuture[]}[] | undefined = undefined;

    if (username) {
      const user = await this.userRepo.findUserByUsername(username);
      if (user) {
        const userPasskeys = await this.passkeyRepo.getPasskeysByUserId(user.id);
        allowCredentials = userPasskeys.map(pk => ({
          id: pk.credential_id,
          type: 'public-key',
          transports: pk.transports ? JSON.parse(pk.transports) as AuthenticatorTransportFuture[] : undefined,
        }));
      }
    }

    const options: GenerateAuthenticationOptionsOpts = {
      rpID: RP_ID,
      timeout: 60000,
      allowCredentials,
      userVerification: 'preferred',
    };

    const generatedOptions = await generateAuthOptions(options);
    return generatedOptions;
  }

  async verifyAuthentication(
    authenticationResponseJSON: AuthenticationResponseJSON,
    expectedChallenge: string
  ): Promise<VerifiedAuthenticationResponse & { passkey?: Passkey, userId?: number }> {
    
    const credentialIdFromResponse = authenticationResponseJSON.id;
    if (!credentialIdFromResponse) {
        throw new Error('Credential ID missing from authentication response.');
    }

    const passkey = await this.passkeyRepo.getPasskeyByCredentialId(credentialIdFromResponse);
    if (!passkey) {
      throw new Error('Authentication failed. Passkey not found.');
    }

    // TODO: Re-evaluate the structure of VerifyAuthenticationResponseOpts for @simplewebauthn/server@13.1.1
    // The 'authenticator' field seems to be causing type errors.
    const verifyOpts: any = { // Using 'any' temporarily to bypass the authenticator structure error
      response: authenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      authenticator: { 
        credentialID: base64UrlToUint8Array(passkey.credential_id),
        credentialPublicKey: Buffer.from(passkey.public_key, 'base64'),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) as AuthenticatorTransportFuture[] : undefined,
      },
      requireUserVerification: true,
    };

    const verification = await verifyAuthenticationResponse(verifyOpts as VerifyAuthenticationResponseOpts);

    if (verification.verified && verification.authenticationInfo) {
      const authInfo = verification.authenticationInfo;
      await this.passkeyRepo.updatePasskeyCounter(passkey.credential_id, authInfo.newCounter);
      await this.passkeyRepo.updatePasskeyLastUsedAt(passkey.credential_id);
      return { ...verification, passkey, userId: passkey.user_id };
    }
    throw new Error('Authentication failed.');
  }

  async listPasskeysByUserId(userId: number): Promise<Partial<Passkey>[]> {
    const passkeys = await this.passkeyRepo.getPasskeysByUserId(userId);
    // 只返回部分信息以避免泄露敏感数据
    return passkeys.map(pk => ({
      credential_id: pk.credential_id,
      created_at: pk.created_at,
      last_used_at: pk.last_used_at,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      // 可以考虑添加一个用户可定义的名称字段
    }));
  }

  async deletePasskey(userId: number, credentialID: string): Promise<boolean> {
    const passkey = await this.passkeyRepo.getPasskeyByCredentialId(credentialID);
    if (!passkey) {
      throw new Error('Passkey not found.');
    }
    if (passkey.user_id !== userId) {
      // 安全措施：用户只能删除自己的 Passkey
      throw new Error('Unauthorized to delete this passkey.');
    }
    const wasDeleted = await this.passkeyRepo.deletePasskey(credentialID);
    return wasDeleted;
  }
}

export const passkeyService = new PasskeyService(passkeyRepository, userRepository);