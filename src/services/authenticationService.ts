import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs";
import { apiClient } from "./apiService";

// Constants
const API_BASE_URL =
  process.env.API_BASE_URL || "https://apex.void.exchange/api/v1";

// Interface for auth response
interface AuthResponse {
  success: boolean;
  data: {
    sessionRequestId: string;
    verificationCode: string;
  };
}

interface AuthStatusResponse {
  success: boolean;
  data: {
    status: string;
    accessToken?: string;
    encryptedKey?: string;
    walletId?: string;
  };
}

// New interfaces for workspace and wallet data
interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  domain: string;
}

interface Wallet {
  id: string;
  name: string;
  walletType: string;
  valueUsd: string;
  role: string;
  topAssets: {
    symbol: string;
    logoUrl: string;
  }[];
}

// Global auth state
let currentWalletId: string | null = null;
let currentAccessToken: string | null = null;
let currentWorkspaceId: string | null = null;

/**
 * Get or create RSA key pair for bot authentication
 */
function getOrCreateRSAKeyPair() {
  const dir = path.join(os.homedir(), ".crypto-wallet-bot");
  const privateKeyPath = path.join(dir, "rsa_private.pem");
  const publicKeyPath = path.join(dir, "rsa_public.pem");

  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    console.log("🔐 Generating new RSA key pair for bot authentication...");

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    fs.writeFileSync(privateKeyPath, privateKey);
    fs.writeFileSync(publicKeyPath, publicKey);
  }

  const privateKey = fs.readFileSync(privateKeyPath, "utf-8");
  const publicKey = fs.readFileSync(publicKeyPath, "utf-8");

  // Strip PEM headers and whitespace before encoding
  const publicKeyClean = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");

  const publicKeyBase64 = publicKeyClean;

  return { privateKey, publicKeyBase64 };
}

/**
 * Load the private key for decryption
 */
function loadPrivateKey(): string {
  const dir = path.join(os.homedir(), ".crypto-wallet-bot");
  const privateKeyPath = path.join(dir, "rsa_private.pem");

  if (!fs.existsSync(privateKeyPath)) {
    // If the private key doesn't exist, create it
    getOrCreateRSAKeyPair();
  }

  return fs.readFileSync(privateKeyPath, "utf-8");
}

/**
 * Generate stable device fingerprint
 */
function generateStableFingerprint() {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const platform = os.platform();
  const raw = `${hostname}-${username}-${platform}-bot`;
  // Truncate SHA-256 to 32 hex characters (128 bits)
  const fingerprint = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 32);
  return fingerprint;
}

/**
 * Decrypt the AES key with RSA private key
 */
function decryptRSAEncryptedKey(
  encryptedBase64Key: string,
  privateKeyPem: string
) {
  const buffer = Buffer.from(encryptedBase64Key, "base64");
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    buffer
  );
}

/**
 * Decrypt AES-encrypted access token
 */
function decryptAESCFB(base64CipherText: string, aesKeyBuffer: Buffer) {
  const cipherText = Buffer.from(base64CipherText, "base64");
  const iv = cipherText.subarray(0, 16); // First 16 bytes
  const encrypted = cipherText.subarray(16); // Rest is the encrypted payload

  const decipher = crypto.createDecipheriv("aes-128-cfb", aesKeyBuffer, iv);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Decrypt token from authentication response
 */
async function decryptTokenPayload(responseData: any) {
  const privateKeyPem = loadPrivateKey();

  // Step 1: Decrypt AES key
  const aesKey = decryptRSAEncryptedKey(
    responseData.encryptedKey,
    privateKeyPem
  );

  // Step 2: Decrypt the access token
  const token = decryptAESCFB(responseData.accessToken, aesKey);
  console.log("🔓 Access Token successfully decrypted");
  return token;
}

/**
 * Update API client authorization header with token
 */
function updateApiClientAuthHeader(token: string): void {
  if (apiClient.defaults.headers) {
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    console.log("✅ API client authorization header updated with new token");
  }
}

/**
 * Start bot authentication process
 * @returns Verification code to show to user
 */
export async function startBotAuthentication(): Promise<{
  sessionRequestId: string;
  verificationCode: string;
}> {
  const fingerprint = generateStableFingerprint();
  console.log("Device Fingerprint:", fingerprint);

  const { publicKeyBase64 } = getOrCreateRSAKeyPair();

  const payload = {
    deviceFingerprint: fingerprint,
    deviceName: os.hostname(),
    deviceUserName: os.userInfo().username,
    deviceOs: os.platform(),
    platform: "cli",
    botVersion: "1.0.0",
    durationInSeconds: 86400, // 24 hours
    publicKey: publicKeyBase64,
  };

  try {
    const response = await apiClient.post(
      "/authentication/session-requests/start",
      payload
    );
    const data = response.data as AuthResponse;

    console.log("data success", data);

    if (data.success) {
      return data.data;
    } else {
      throw new Error("Authentication start failed");
    }
  } catch (error) {
    console.error("Error starting bot authentication:", error);
    throw error;
  }
}

/**
 * Check authentication status
 * @param sessionRequestId The session request ID
 */
async function checkAuthenticationStatus(
  sessionRequestId: string
): Promise<AuthStatusResponse> {
  try {
    const response = await apiClient.get(
      `/authentication/session-requests/status/${sessionRequestId}`
    );
    return response.data as AuthStatusResponse;
  } catch (error) {
    console.error("Error checking authentication status:", error);
    throw error;
  }
}

/**
 * Poll for authentication token
 * @param sessionRequestId The session request ID
 * @param onComplete Callback for when authentication is complete
 */
export async function pollForToken(
  sessionRequestId: string,
  onComplete: (token: string) => Promise<void>
): Promise<void> {
  const pollInterval = 5000; // 5 seconds
  console.log("Polling for authentication status...");

  const poll = async () => {
    try {
      const statusData = await checkAuthenticationStatus(sessionRequestId);

      console.log("statusData", statusData);

      if (
        statusData.success &&
        statusData.data.status === "completed" &&
        statusData.data.accessToken &&
        statusData.data.encryptedKey
      ) {
        console.log("IM inside here");
        const decryptedToken = await decryptTokenPayload(statusData.data);

        // Store the authentication data
        currentAccessToken = decryptedToken;

        // Set the token in the API client auth header
        updateApiClientAuthHeader(decryptedToken);

        try {
          await onComplete(decryptedToken);
        } catch (err) {
          console.error("err", err);
        }
        // Call the completion callback

        return;
      }

      console.log("Authentication incomplete, waiting...");
      setTimeout(poll, pollInterval);
    } catch (error) {
      console.error("Error in polling:", error.toString());
      setTimeout(poll, pollInterval);
    }
  };

  // Start polling
  await poll();
}

/**
 * Get list of available workspaces
 * @returns Promise with workspace data
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  try {
    const response = await apiClient.get("/workspaces");
    if (response.data && response.data.success) {
      return response.data.data as Workspace[];
    }
    throw new Error("Failed to get workspaces");
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    throw error;
  }
}

/**
 * Set current workspace
 * @param workspaceId The workspace ID to set as current
 */
export function setCurrentWorkspace(workspaceId: string): void {
  currentWorkspaceId = workspaceId;
}

/**
 * Get current workspace ID
 */
export function getCurrentWorkspaceId(): string | null {
  return currentWorkspaceId;
}

/**
 * Get wallets for a workspace
 * @param workspaceId Workspace ID to get wallets for
 * @returns Promise with wallet data
 */
export async function getWorkspaceWallets(
  workspaceId: string
): Promise<Wallet[]> {
  try {
    const response = await apiClient.get(`/workspaces/${workspaceId}/wallets`);
    if (response.data && response.data.success) {
      return response.data.data as Wallet[];
    }
    throw new Error("Failed to get wallets");
  } catch (error) {
    console.error("Error fetching workspace wallets:", error);
    throw error;
  }
}

/**
 * Set current wallet ID
 * @param walletId The wallet ID to set as current
 */
export function setCurrentWalletId(walletId: string): void {
  currentWalletId = walletId;
}

/**
 * Get the current wallet ID
 */
export function getCurrentWalletId(): string | null {
  return currentWalletId;
}

/**
 * Get the current access token
 */
export function getCurrentAccessToken(): string | null {
  return currentAccessToken;
}

/**
 * Initialize authentication with saved credentials if available
 */
export function initializeAuthentication(): void {
  // This could be extended to load saved credentials from a secure storage
  console.log("Initializing authentication service...");

  // For now, we'll just rely on the authentication flow to set up credentials
  if (!currentWalletId || !currentAccessToken) {
    console.log(
      "No authentication credentials found. Will need to authenticate."
    );
  }
}

/**
 * Check if we're currently authenticated
 */
export function isAuthenticated(): boolean {
  return !!currentAccessToken;
}
