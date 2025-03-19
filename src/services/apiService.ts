import axios from "axios";
import camelcaseKeys from "camelcase-keys";
import snakecaseKeys from "snakecase-keys";
import dotenv from "dotenv";

dotenv.config();

// Base URL configuration from environment
const API_BASE_URL =
  process.env.API_BASE_URL || "https://apex.void.exchange/api/v1";

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.API_KEY}`,
  },
});

// Interceptor to convert request data to snake_case
apiClient.interceptors.request.use((config) => {
  if (config.data) {
    config.data = snakecaseKeys(config.data, { deep: true });
  }
  return config;
});

// Interceptor to convert response data to camelCase
apiClient.interceptors.response.use((response) => {
  if (response.data) {
    response.data = camelcaseKeys(response.data, { deep: true });
  }
  return response;
});

/**
 * Create a withdrawal transaction
 * @param walletId Wallet ID to withdraw from
 * @param assetId Asset ID to withdraw
 * @param amount Amount to withdraw
 * @param recipientAddress Address to send to
 * @returns Promise with withdrawal transaction data
 */
export async function createWithdrawal(
  walletId: string,
  assetId: string,
  amount: string,
  recipientAddress: string
): Promise<any> {
  try {
    console.log("Creating withdrawal...",  {
        assetId,
        amount,
        recipientAddress,
      });
    const response = await apiClient.post(`/wallets/${walletId}/withdrawal`, {
      assetId,
      amount,
      recipientAddress,
    });

    console.log("Withdrawal created successfully:", response);

    return response.data;
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    throw error;
  }
}

/**
 * Get wallet details
 * @param walletId Wallet ID to get details for
 * @returns Promise with wallet details
 */
export async function getWalletDetails(walletId: string): Promise<any> {
  try {
    const response = await apiClient.get(`/wallets/${walletId}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching wallet details:", error);
    throw error;
  }
}

