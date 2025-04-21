import {
  Transaction,
  PublicKey,
  Connection,
  SystemProgram,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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
import {
  SolanaSigner,
  Environment,
  StatusPollerOptions,
} from "@fystack/wallet-sdk";
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
  apiKey: "26fe8140-73dc-4372-80bb-d2304fa6f3ad",
  apiSecret: "197c9da5a41f77aaf475aa1835c5ee84",
  // apiKey: "9ddf7783-7b57-4a78-a49b-9366cfed6287",
  // apiSecret: "f23a2231b1a394c2168e7459a3c56574",
  // apiKey: "55baa7d1-9ab1-4acb-bd69-d0aeea5eb08a",
  // apiSecret: "1acf8f3176b3af6b1d9f9a71136cf718",
};

const pollerOptions: StatusPollerOptions = {
  maxAttempts: 30,
  interval: 1000, // Start with 1 second
  backoffFactor: 1.1, // Increase interval by 50% each time
  maxInterval: 10000, // Max 10 seconds between attempts
  timeoutMs: 10 * 60 * 1000, // 10 minutes totla
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
    const signer = new SolanaSigner(
      apiCredentials,
      Environment.Sandbox,
      pollerOptions
    );

    // Get user address

    // Prepare swap parameters
    const slippage = 1; // 1% slippage
    const txVersion = "LEGACY";

    // 1) Start both async ops without awaiting yet:
    const addressPromise = signer.getAddress();
    const swapResponsePromise = axios.get<ApiSwapV1Out>(
      `${API_URLS.SWAP_HOST}/compute/swap-base-in`,
      {
        params: {
          inputMint: inputTokenMint,
          outputMint: outputTokenMint,
          amount,
          slippageBps: slippage * 100,
          txVersion,
        },
      }
    );

    // 2) Await them together:
    const [address, { data: swapResponse }] = await Promise.all([
      addressPromise,
      swapResponsePromise,
    ]);

    // 3) Now you have both:
    const owner = new PublicKey(address);

    if (!swapResponse.success) {
      throw new Error(swapResponse.msg);
    }

    // // Get pool keys for the swap route
    // const { data: poolKeysResponse } = await axios.get(
    //   API_URLS.BASE_HOST +
    //     API_URLS.POOL_KEY_BY_ID +
    //     `?ids=${swapResponse.data.routePlan.map((r) => r.poolId).join(",")}`
    // );

    // Use the tokenProgramId from RAYDIUM SDK constants
    const tokenProgramId = new PublicKey(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );

    // Determine if we're dealing with SOL and need to wrap/unwrap
    const isInputSol = inputTokenMint === NATIVE_MINT.toBase58();
    const isOutputSol = outputTokenMint === NATIVE_MINT.toBase58();

    // Kick off both calls (or a resolved `undefined` if SOL)
    const inputAccountPromise = !isInputSol
      ? getAssociatedTokenAddress(
          new PublicKey(inputTokenMint),
          owner,
          false,
          tokenProgramId
        ).then((ata) => ata.toString())
      : Promise.resolve<string | undefined>(undefined);

    const outputAccountPromise = !isOutputSol
      ? getAssociatedTokenAddress(
          new PublicKey(outputTokenMint),
          owner,
          false,
          tokenProgramId
        ).then((ata) => ata.toString())
      : Promise.resolve<string | undefined>(undefined);

    // Await both in parallel
    const [inputAccount, outputAccount] = await Promise.all([
      inputAccountPromise,
      outputAccountPromise,
    ]);

    // Instead of building the transaction manually, use Raydium's transaction API
    const { data: swapTransactions } = await axios.post(
      `${API_URLS.SWAP_HOST}/transaction/swap-base-in`,
      {
        // computeUnitPriceMicroLamports: String(6000000),
        computeUnitPriceMicroLamports: String(100_000),
        swapResponse,
        txVersion,
        wallet: owner.toBase58(),
        wrapSol: isInputSol,
        unwrapSol: isOutputSol,
        inputAccount,
        outputAccount,
      }
    );

    if (!swapTransactions.success) {
      throw new Error(
        `Failed to get swap transaction: ${
          swapTransactions.msg || "Unknown error"
        }`
      );
    }

    console.log("Swap transaction created successfully");

    // Sign and send transaction
    const allTxBuf = swapTransactions.data.map((tx) =>
      Buffer.from(tx.transaction, "base64")
    );

    const txString = allTxBuf[0].toString("base64");
    console.log("Transaction base64 string ready for signing");

    // Sign and send transaction
    const result = await signer.signTransaction(txString);
    console.log("Transaction signed with result:", result);

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
    console.log(`Fetching metadata for token mint: ${mintAddress}`);

    // Make a request to Jupiter token API
    const response = await axios.get(
      `https://lite-api.jup.ag/tokens/v1/token/${mintAddress}`
    );

    // Check if we have a valid response
    if (!response.data) {
      throw new Error("Invalid response from Jupiter API");
    }

    const tokenData = response.data;
    console.log("Jupiter API response:", JSON.stringify(tokenData, null, 2));

    // Jupiter API returns the token data in a more direct format
    const result = {
      name: tokenData.name || "Unknown Token",
      symbol: tokenData.symbol || "UNKNOWN",
      decimals: tokenData.decimals || 9,
    };

    console.log(`Final token metadata: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error("Error fetching token metadata:", error);

    // Return default values if fetch fails
    return {
      name: "Unknown Token",
      symbol: "UNKNOWN",
      decimals: 9, // Default for Solana tokens
    };
  }
}
