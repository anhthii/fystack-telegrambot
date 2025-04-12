import { Transaction, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
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
  // apiKey: "9ddf7783-7b57-4a78-a49b-9366cfed6287",
  // apiSecret: "f23a2231b1a394c2168e7459a3c56574",
  apiKey: "55baa7d1-9ab1-4acb-bd69-d0aeea5eb08a",
  apiSecret: "1acf8f3176b3af6b1d9f9a71136cf718",
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
    const signer = new SolanaSigner(apiCredentials, Environment.Local);

    // Get user address
    const address = await signer.getAddress();
    const owner = new PublicKey(address);

    // Prepare swap parameters
    const slippage = 1; // 0.5% slippage
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

    console.log("Mintaprogram", mintAProgram);
    console.log("MintBProgrqam", mintBProgram);

    // Get token accounts
    const inputAccount = getATAAddress(
      owner,
      new PublicKey(inputTokenMint),
      new PublicKey(mintAProgram)
    ).publicKey;

    console.log("inputAccount", inputAccount.toBase58());
    const outputAccount = getATAAddress(
      owner,
      new PublicKey(outputTokenMint),
      new PublicKey(mintBProgram)
    ).publicKey;

    console.log("outputAccount", outputAccount.toBase58());
    console.log("SWAP AMOUNT", amount);

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

    // Check if accounts exist and create them if they don't
    const inputAccountInfo = await connection.getAccountInfo(inputAccount);
    const outputAccountInfo = await connection.getAccountInfo(outputAccount);

    // Create input token account if it doesn't exist
    if (!inputAccountInfo && inputTokenMint !== NATIVE_MINT.toBase58()) {
      const createInputAta = createAssociatedTokenAccountInstruction(
        owner, // payer
        inputAccount, // ata
        owner, // owner
        new PublicKey(inputTokenMint), // mint
        new PublicKey(mintAProgram) // program id
      );
      tx.add(createInputAta);
    }

    // Create output token account if it doesn't exist
    if (!outputAccountInfo && outputTokenMint !== NATIVE_MINT.toBase58()) {
      const createOutputAta = createAssociatedTokenAccountInstruction(
        owner, // payer
        outputAccount, // ata
        owner, // owner
        new PublicKey(outputTokenMint), // mint
        new PublicKey(mintBProgram) // program id
      );
      tx.add(createOutputAta);
    }

    // Add the swap instruction
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
