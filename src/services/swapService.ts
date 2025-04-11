import { Transaction, PublicKey, Connection } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import axios from "axios";
import {
  API_URLS,
  ApiSwapV1Out,
  PoolKeys,
  getATAAddress,
  swapBaseInAutoAccount,
  ALL_PROGRAM_ID,
  addComputeBudget,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { SolanaSigner, Environment } from "@fystack/wallet-sdk";
import dotenv from "dotenv";
    // Get Helius API key from environment variables
const heliusApiKey = process.env.HELIUS_API_KEY;

// Load environment variables
dotenv.config();

// Token mint addresses dictionary
const TOKEN_MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL: NATIVE_MINT.toBase58(),
  BTC: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  // Add more token mint addresses as needed
};

// Connection instance
const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
);

// API credentials
const apiCredentials = {
  apiKey: "9ddf7783-7b57-4a78-a49b-9366cfed6287",
  apiSecret: "f23a2231b1a394c2168e7459a3c56574",
};

/**
 * Get the mint address for a token symbol
 */
export function getTokenMintAddress(symbol: string): string {
  const upperSymbol = symbol.toUpperCase();
  if (upperSymbol === "SOL") {
    return NATIVE_MINT.toBase58();
  }

  if (!TOKEN_MINTS[upperSymbol]) {
    throw new Error(`Unknown token symbol: ${symbol}`);
  }

  return TOKEN_MINTS[upperSymbol];
}

/**
 * Execute a token swap on Raydium
 */
export async function executeTokenSwap(
  inputTokenMint: string,
  outputTokenMint: string,
  amount: number // Amount in the smallest units (lamports/etc)
): Promise<{ success: boolean; txId?: string; error?: string }> {
  try {
    // Initialize signer
    const signer = new SolanaSigner(apiCredentials, Environment.Sandbox);

    // Get user address
    const address = await signer.getAddress();
    const owner = new PublicKey(address);

    // Prepare swap parameters
    const slippage = 0.5; // 0.5% slippage
    const txVersion = "LEGACY";

    // Get swap route from Raydium API
    const { data: swapResponse } = await axios.get<ApiSwapV1Out>(
      `${
        API_URLS.SWAP_HOST
      }/compute/swap-base-in?inputMint=${inputTokenMint}&outputMint=${outputTokenMint}&amount=${amount}&slippageBps=${
        slippage * 100
      }&txVersion=${txVersion}`
    );

    if (!swapResponse.success) {
      throw new Error(swapResponse.msg);
    }

    // Get pool keys for the swap route
    const res = await axios.get(
      API_URLS.BASE_HOST +
        API_URLS.POOL_KEY_BY_ID +
        `?ids=${swapResponse.data.routePlan.map((r) => r.poolId).join(",")}`
    );

    const allMints = res.data.data.map((r) => [r.mintA, r.mintB]).flat();
    const [mintAProgram, mintBProgram] = [
      allMints.find((m) => m.address === inputTokenMint)!.programId,
      allMints.find((m) => m.address === outputTokenMint)!.programId,
    ];

    // Get token accounts
    const inputAccount = getATAAddress(
      owner,
      new PublicKey(inputTokenMint),
      new PublicKey(mintAProgram)
    ).publicKey;
    const outputAccount = getATAAddress(
      owner,
      new PublicKey(outputTokenMint),
      new PublicKey(mintBProgram)
    ).publicKey;

    // Create swap instruction
    const ins = swapBaseInAutoAccount({
      programId: ALL_PROGRAM_ID.Router,
      wallet: owner,
      amount: new BN(amount),
      inputAccount,
      outputAccount,
      routeInfo: swapResponse,
      poolKeys: res.data.data,
    });

    // Create and sign transaction
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const tx = new Transaction();

    // Add compute budget instructions
    const { instructions } = addComputeBudget({
      units: 600000,
      microLamports: 6000000,
    });
    instructions.forEach((ins) => tx.add(ins));

    tx.add(ins);
    tx.recentBlockhash = recentBlockhash;
    tx.feePayer = owner;

    // Serialize transaction
    const serializedTx = tx.serialize({ requireAllSignatures: false });
    const txString = serializedTx.toString("base64");

    // Sign and send transaction
    const result = await signer.signTransaction(txString);

    // Return success with transaction ID
    return {
      success: true,
      txId: result || "Transaction ID not available",
    };
  } catch (error) {
    console.error("Error executing swap:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Get the expected output amount for a swap (price quote)
 * This can be implemented to show the user how much they'll receive
 */
export async function getSwapQuote(
  inputTokenMint: string,
  outputTokenMint: string,
  amount: number
): Promise<{ success: boolean; expectedOutput?: string; error?: string }> {
  try {
    // Similar to executeTokenSwap but only fetches the quote without executing
    const slippage = 0.5;
    const txVersion = "LEGACY";

    const { data: swapResponse } = await axios.get<ApiSwapV1Out>(
      `${
        API_URLS.SWAP_HOST
      }/compute/swap-base-in?inputMint=${inputTokenMint}&outputMint=${outputTokenMint}&amount=${amount}&slippageBps=${
        slippage * 100
      }&txVersion=${txVersion}`
    );

    if (!swapResponse.success) {
      throw new Error(swapResponse.msg);
    }

    // Return the expected output amount
    return {
      success: true,
      expectedOutput: swapResponse.data.outputAmount.toString(),
    };
  } catch (error) {
    console.error("Error getting swap quote:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function getTokenMetadata(mintAddress: string): Promise<{ 
  symbol: string;
  name: string;
  decimals: number;
}> {
  try {

    if (!heliusApiKey) {
      throw new Error("Helius API key not found in environment variables");
    }
    
    console.log(`Fetching metadata for token mint: ${mintAddress}`);
    
    // Make a request to Helius token-metadata API
    const response = await axios.post(
      `https://api.helius.xyz/v0/token-metadata?api-key=${heliusApiKey}`,
      {
        mintAccounts: [mintAddress],
        includeOffChain: true
      }
    );
    
    // For debugging, log the raw response
    console.log("Helius API response:", JSON.stringify(response.data, null, 2));
    
    // Check if we have a valid response
    if (!response.data || !response.data[0]) {
      throw new Error("Invalid response from Helius API");
    }
    
    const tokenData = response.data[0];
    
    // First try to get decimals from on-chain account info
    let decimals = 9; // Default fallback
    let name = "Unknown Token";
    let symbol = "UNKNOWN";
    
    // Extract decimals from onChainAccountInfo
    if (tokenData.onChainAccountInfo && 
        tokenData.onChainAccountInfo.accountInfo && 
        tokenData.onChainAccountInfo.accountInfo.data &&
        tokenData.onChainAccountInfo.accountInfo.data.parsed &&
        tokenData.onChainAccountInfo.accountInfo.data.parsed.info) {
      decimals = tokenData.onChainAccountInfo.accountInfo.data.parsed.info.decimals || decimals;
      console.log(`Found decimals from onChainAccountInfo: ${decimals}`);
    }
    
    // Try to get name and symbol from metadata
    if (tokenData.onChainMetadata && tokenData.onChainMetadata.metadata && tokenData.onChainMetadata.metadata.data) {
      name = tokenData.onChainMetadata.metadata.data.name || name;
      symbol = tokenData.onChainMetadata.metadata.data.symbol || symbol;
      console.log(`Found name/symbol from onChainMetadata: ${name}/${symbol}`);
    }
    
    // As fallback, check legacy metadata
    if (tokenData.legacyMetadata) {
      name = tokenData.legacyMetadata.name || name;
      symbol = tokenData.legacyMetadata.symbol || symbol;
      decimals = tokenData.legacyMetadata.decimals || decimals;
      console.log(`Found data from legacyMetadata: ${name}/${symbol}/${decimals}`);
    }
    
    // Return the token information
    const result = {
      name: name.trim(),
      symbol: symbol.trim(),
      decimals: Number(decimals)
    };
    
    console.log(`Final token metadata: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    
    // Return default values if fetch fails
    return {
      name: "Unknown Token",
      symbol: "UNKNOWN",
      decimals: 9 // Default for Solana tokens
    };
  }
}
