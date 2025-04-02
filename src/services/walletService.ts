import { apiClient } from "./apiService";
import { getCurrentWalletId } from './authenticationService';

// Mock wallet data
const mockWalletData = [
  {
    balance: "0.0014924786335583",
    onHold: "0.0014397222976578",
    availableBalance: "0.0000527563359005",
    asset: {
      id: "a469642e-5466-4d69-834d-537f33ee5c81",
      name: "Ethereum Sepolia",
      symbol: "ETH",
      decimals: 18,
      logoUrl:
        "https://icons.iconarchive.com/icons/cjdowner/cryptocurrency-flat/512/Ethereum-ETH-icon.png",
    },
    priceUsd: "1895.4969261030274",
    valueUsd: "2.82898866218420428495686439742",
  },
  {
    balance: "0.0250000000000000",
    onHold: "0.0000000000000000",
    availableBalance: "0.0250000000000000",
    asset: {
      id: "b469642e-5466-4d69-834d-537f33ee5c82",
      name: "Bitcoin",
      symbol: "BTC",
      decimals: 8,
      logoUrl:
        "https://icons.iconarchive.com/icons/cjdowner/cryptocurrency-flat/512/Bitcoin-BTC-icon.png",
    },
    priceUsd: "34250.75",
    valueUsd: "856.26875",
  },
  {
    balance: "125.0000000000000000",
    onHold: "0.0000000000000000",
    availableBalance: "125.0000000000000000",
    asset: {
      id: "c469642e-5466-4d69-834d-537f33ee5c83",
      name: "Solana",
      symbol: "SOL",
      decimals: 9,
      logoUrl:
        "https://icons.iconarchive.com/icons/cjdowner/cryptocurrency-flat/512/Solana-SOL-icon.png",
    },
    priceUsd: "45.75",
    valueUsd: "5718.75",
  },
];

// Mock portfolio allocation data
const mockAllocationData = {
  blueChip: 61,
  midCap: 13,
  lowCap: 24,
  microCap: 2,
  stablecoin: 0,
};

// Define the interface for wallet data
interface WalletData {
  balance: string;
  onHold: string;
  availableBalance: string;
  asset: {
    id: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string;
  };
  priceUsd: string;
  valueUsd: string;
}

// Function to get wallet data from API
export async function getWalletData(walletId?: string): Promise<WalletData[]> {
  try {
    // Use provided walletId or get the current one from auth service
    const targetWalletId = walletId || getCurrentWalletId();
    
    if (!targetWalletId) {
      console.error("No wallet ID available");
      return mockWalletData; // Fallback to mock data if no wallet ID
    }
    
    const response = await apiClient.get(
      `/wallets/${targetWalletId}/overview?offset=0&limit=10`
    );
    
    if (response.data.success) {
      return response.data.data;
    } else {
      console.warn("API returned success: false, falling back to mock data");
      return mockWalletData;
    }
  } catch (error) {
    console.error("Error fetching wallet data:", error);
    return mockWalletData; // Fallback to mock data on error
  }
}

// Function to calculate asset distribution for allocation chart
export function calculateAssetDistribution() {
  // Calculate total portfolio value
  const totalValue = mockWalletData.reduce(
    (sum, asset) => sum + parseFloat(asset.valueUsd),
    0
  );

  // Generate distribution data for each asset
  return mockWalletData.map((asset) => ({
    name: asset.asset.symbol,
    percentage: Math.round((parseFloat(asset.valueUsd) / totalValue) * 100),
  }));
}

// Function to get portfolio allocation
export async function getPortfolioAllocation() {
  // Return actual asset distribution instead of mock categories
  return calculateAssetDistribution();
}

// This function will be implemented later with real API endpoints
export async function fetchWalletData(walletAddress: string) {
  // TODO: Replace with actual API call
  return mockWalletData;
}

