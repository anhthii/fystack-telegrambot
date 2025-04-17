import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { generateQRCode } from "./utils/qrCode";
import {
  getWalletData,
  getPortfolioAllocation,
  convertToSmallestUnit,
  convertFromSmallestUnit,
} from "./services/walletService";
import {
  createBalanceChart,
  createAllocationChart,
} from "./utils/chartGenerator";
import { createWithdrawal } from "./services/apiService";
import {
  startBotAuthentication,
  pollForToken,
  getCurrentWalletId,
  isAuthenticated,
  initializeAuthentication,
  getWorkspaces,
  getWorkspaceWallets,
  setCurrentWorkspace,
  setCurrentWalletId,
  logoutAndClearState
} from "./services/authenticationService";
import { performAddressRiskCheck } from "./services/riskCheckService";
import {
  executeTokenSwap,
  getSwapQuote,
  getTokenMintAddress,
  getTokenMetadata
} from "./services/swapService";

// Load environment variables
dotenv.config();

// Initialize bot with token from environment variables
const bot = new TelegramBot(process.env.BOT_TOKEN || "", { 
  polling: true,
  onlyFirstMatch: true,
  request: {
    timeout: 30000
  }
});

// Store user states for multi-step processes
const userStates = new Map();

// Initialize authentication service
initializeAuthentication();

// Create a map to store asset data with a unique key
const assetDataMap = new Map<
  string,
  { id: string; symbol: string; balance: string }
>();

// Start command handler
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Check if user is already authenticated
  if (isAuthenticated()) {
    const opts = {
      reply_markup: {
        keyboard: [
          ["💸 Send", "🔄 Swap"],
          ["📊 Monitor Wallet", "🔀 Change Wallet", "🔒 Logout"]
        ],
        resize_keyboard: true,
      },
    };

    await bot.sendMessage(
      chatId,
      `👋 Welcome back, ${msg.from?.first_name}! Your wallet is connected. What would you like to do? 🚀`,
      opts
    );
  } else {
    const opts = {
      reply_markup: {
        keyboard: [["💼 Connect Wallet"]],
        resize_keyboard: true,
      },
    };

    await bot.sendMessage(
      chatId,
      `👋 Welcome to Crypto Wallet Bot built with MPC technology! ${msg.from?.first_name} 🚀`,
      opts
    );
  }

  // Reset user state
  userStates.delete(chatId);
});

// New authenticate command handler
bot.onText(/\/authenticate/, async (msg) => {
  const chatId = msg.chat.id;
  await startAuthenticationFlow(chatId);
});

// Reset command handler
bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Clear user state
  userStates.delete(chatId);
  
  // Clear authentication
  logoutAndClearState();
  
  await bot.sendMessage(
    chatId,
    "Bot has been reset. All your data and session information has been cleared."
  );
  
  // Show the initial welcome message
  const opts = {
    reply_markup: {
      keyboard: [["💼 Connect Wallet"]],
      resize_keyboard: true,
    },
  };

  await bot.sendMessage(
    chatId,
    `👋 Welcome to Crypto Wallet Monitor Bot! ${msg.from?.first_name} 🚀`,
    opts
  );
});

// Handle messages
bot.on("message", async (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;

  // Check if user is in a multi-step process
  const userState = userStates.get(chatId);

  if (userState) {
    // Handle state-specific logic
    await handleStateMessage(chatId, msg.text, userState);
    return;
  }

  if (msg.text === "💼 Connect Wallet") {
    if (isAuthenticated()) {
      await bot.sendMessage(
        chatId,
        "You already have a connected wallet. Do you want to connect a different one?",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Yes, connect new wallet",
                  callback_data: "new_wallet",
                },
                {
                  text: "No, use current wallet",
                  callback_data: "use_current",
                },
              ],
            ],
          },
        }
      );
    } else {
      await startAuthenticationFlow(chatId);
    }
  } else if (msg.text === "📊 Monitor Wallet") {
    if (!isAuthenticated()) {
      await bot.sendMessage(
        chatId,
        "You need to connect a wallet first. Use the 'Connect Wallet' option to get started."
      );
    } else {
      await showWalletData(chatId);
    }
  } else if (msg.text === "💸 Send") {
    await startSendProcess(chatId);
  } else if (msg.text === "🔄 Swap") {
    if (!isAuthenticated()) {
      await bot.sendMessage(
        chatId,
        "You need to connect a wallet first. Use the 'Connect Wallet' option to get started."
      );
    } else {
      await startSwapProcess(chatId);
    }
  } else if (msg.text === "🏠 Main Menu") {
    await showWalletActions(chatId);
  } else if (msg.text === "🔀 Change Wallet") {
    if (!isAuthenticated()) {
      await bot.sendMessage(
        chatId,
        "You need to connect a wallet first. Use the 'Connect Wallet' option to get started."
      );
    } else {
      await showWorkspaceSelection(chatId);
    }
  } else if (msg.text === "👥 Choose Workspace") {
    if (!isAuthenticated()) {
      await bot.sendMessage(
        chatId,
        "You need to connect a wallet first. Use the 'Connect Wallet' option to get started."
      );
    } else {
      await showWorkspaceSelection(chatId);
    }
  } else if (msg.text === "🔒 Logout") {
    // Handle logout
    logoutAndClearState();
    
    await bot.sendMessage(
      chatId,
      "You have been successfully logged out. Your authentication credentials have been cleared."
    );
    
    // Show only Connect Wallet option after logout
    const opts = {
      reply_markup: {
        keyboard: [["💼 Connect Wallet"]],
        resize_keyboard: true,
      },
    };
    
    await bot.sendMessage(
      chatId,
      "You'll need to connect a wallet to continue using the full features of the bot.",
      opts
    );
  }
});

// Function to show main wallet actions
async function showWalletActions(chatId: number): Promise<void> {
  const opts = {
    reply_markup: {
      keyboard: [
        ["💸 Send", "🔄 Swap"], 
        ["📊 Monitor Wallet", "🔀 Change Wallet", "🔒 Logout"]
      ],
      resize_keyboard: true,
    },
  };

  await bot.sendMessage(
    chatId,
    "What would you like to do with your wallet?",
    opts
  );
}

// Function to display wallet data
async function showWalletData(chatId: number): Promise<void> {
  try {
    // Get wallet data from service using the current wallet ID
    const walletData = await getWalletData();

    // Mock wallet details data
    const walletDetails = {
      id: "7d8438ac-3289-4f99-b07b-54c9e2098839",
      name: "Standard 1",
      value_usd: "12.85078129849594576704791384309",
      disabled: false,
      threshold: 1,
    };

    // Display wallet details
    await bot.sendMessage(
      chatId,
      `🏦 *WALLET DETAILS*\n\n` +
        `*Name:* ${walletDetails.name}\n` +
        `*Value:* $${parseFloat(walletDetails.value_usd).toFixed(2)} USD`,
      { parse_mode: "Markdown" }
    );

    // Calculate total USD value
    const totalUsdValue = walletData.reduce(
      (sum, asset) => sum + parseFloat(asset.valueUsd),
      0
    );

    // Generate balance chart
    const balanceChartBuffer = await createBalanceChart(totalUsdValue);
    await bot.sendPhoto(chatId, balanceChartBuffer, {
      caption: `💰 Current Wallet Balance: $${totalUsdValue.toFixed(2)} USD`,
    });

    // Get portfolio allocation
    const allocation = await getPortfolioAllocation();

    // Transform the allocation data to match the expected format
    const allocationArray = Object.values(allocation).map((data) => ({
      name: data.name,
      symbol: data.name,
      percentage: data.percentage,
      value: (data.percentage * totalUsdValue) / 100,
    }));

    // Generate allocation chart
    const allocationChartBuffer = await createAllocationChart(allocationArray);
    await bot.sendPhoto(chatId, allocationChartBuffer, {
      caption: "📊 Portfolio Allocation",
    });

    // Show detailed assets with enhanced formatting
    let assetsMessage = "💎 *YOUR CRYPTO ASSETS* 💎\n\n";

    // Sort assets by value (highest first)
    const sortedAssets = [...walletData].sort(
      (a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd)
    );

    sortedAssets.forEach((asset, index) => {
      const usdValue = parseFloat(asset.valueUsd);
      const percentage = (usdValue / totalUsdValue) * 100;
      const assetEmoji = getAssetEmoji(asset.asset.symbol);
      const networkName = asset.network ? ` (${asset.network.name})` : '';

      assetsMessage += `${index + 1}. ${assetEmoji} *${asset.asset.name}* (${
        asset.asset.symbol
      })${networkName}\n`;
      assetsMessage += `   • Amount: \`${asset.balance}\` ${asset.asset.symbol}\n`;
      assetsMessage += `   • Value: \`$${usdValue.toFixed(2)}\` USD\n`;
      assetsMessage += `   • Portfolio: \`${percentage.toFixed(2)}%\`\n\n`;
    });

    assetsMessage += "💡 _Tap on_ 🏠 _Main Menu to return_";

    const opts = {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [["🏠 Main Menu"]],
        resize_keyboard: true,
      },
    };

    await bot.sendMessage(chatId, assetsMessage, opts);
  } catch (error: unknown) {
    console.error("Error showing wallet data:", error);
    await bot.sendMessage(
      chatId,
      "Sorry, there was an error fetching your wallet data."
    );
  }
}

// Start the send process
async function startSendProcess(chatId: number): Promise<void> {
  try {
    // Use the getWalletData function which returns mockWalletData
    const walletData = await getWalletData();

    console.log("Fetched wallet data:", walletData); // Debugging log

    if (!walletData || walletData.length === 0) {
      throw new Error("No assets available");
    }

    // Create an inline keyboard with available assets
    const assetKeyboard = walletData.map((asset, index) => {
      const key = `asset_${index}`;
      assetDataMap.set(key, {
        id: asset.asset.id,
        symbol: asset.asset.symbol,
        balance: asset.availableBalance,
      });

      // Add network information if available
      const networkInfo = asset.network ? ` (${asset.asset.network.name})` : '';

      return [
        {
          text: `${asset.asset.symbol}${networkInfo} (${asset.availableBalance})`,
          callback_data: key,
        },
      ];
    });

    userStates.set(chatId, {
      step: "select_asset",
      assets: walletData,
    });

    await bot.sendMessage(chatId, "Please select the asset you want to send:", {
      reply_markup: {
        inline_keyboard: assetKeyboard,
      },
    });
  } catch (error) {
    console.error("Error starting send process:", error);
    await bot.sendMessage(
      chatId,
      "Sorry, there was an error fetching your assets. Please try again later."
    );
    // Return to main menu after error
    await showWalletActions(chatId);
  }
}

// Start the swap process
async function startSwapProcess(chatId: number): Promise<void> {
  try {
    // Use the getWalletData function which returns mockWalletData
    const walletData = await getWalletData();

    console.log("Fetched wallet data for swap:", walletData); // Debugging log

    if (!walletData || walletData.length === 0) {
      throw new Error("No assets available");
    }

    // Create an inline keyboard with available assets
    const assetKeyboard = walletData.map((asset, index) => {
      const key = `swap_from_${index}`;
      assetDataMap.set(key, {
        id: asset.asset.id,
        symbol: asset.asset.symbol,
        balance: asset.availableBalance,
      });

      // Add network information if available
      const networkInfo = asset.network ? ` (${asset.asset.network.name})` : '';

      return [
        {
          text: `${asset.asset.symbol}${networkInfo} (${asset.availableBalance})`,
          callback_data: key,
        },
      ];
    });

    userStates.set(chatId, {
      step: "select_swap_from",
      assets: walletData,
    });

    await bot.sendMessage(
      chatId,
      "Please select the asset you want to swap from:",
      {
        reply_markup: {
          inline_keyboard: assetKeyboard,
        },
      }
    );
  } catch (error) {
    console.error("Error starting swap process:", error);
    await bot.sendMessage(
      chatId,
      "Sorry, there was an error fetching your assets. Please try again later."
    );
    // Return to main menu after error
    await showWalletActions(chatId);
  }
}

// Utility function to safely perform Telegram API actions
async function safeApiCall(apiCall: Promise<any>, errorMessage: string = "Operation failed"): Promise<any> {
  try {
    return await apiCall;
  } catch (error) {
    console.error(`Telegram API error: ${errorMessage}`, error);
    // Don't throw the error, just return null to prevent app crashes
    return null;
  }
}

// Handle callback queries (for inline buttons)
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (!data) return;

  try {
    // Handle workspace selection
    if (data.startsWith("ws_")) {
      const workspaceId = data.substring(3); // Remove 'ws_' prefix

      // Set the current workspace
      setCurrentWorkspace(workspaceId);

      try {
        // Fetch wallets for the selected workspace
        const wallets = await getWorkspaceWallets(workspaceId);

        if (wallets.length === 0) {
          await bot.sendMessage(
            chatId,
            "No wallets found in this workspace. Please create a wallet first."
          );
          return;
        }

        // Create wallet selection keyboard
        const walletKeyboard = wallets.map((wallet) => [
          {
            text: `${wallet.name} (${wallet.walletType})`,
            callback_data: `wallet_${wallet.id}`,
          },
        ]);

        await bot.sendMessage(chatId, "Please select a wallet:", {
          reply_markup: {
            inline_keyboard: walletKeyboard,
          },
        });
      } catch (error) {
        console.error("Error fetching wallets:", error);
        await bot.sendMessage(
          chatId,
          "❌ Error fetching wallets. Please try again later."
        );
      }
    }
    // Handle wallet selection
    else if (data.startsWith("wallet_")) {
      const walletId = data.substring(7); // Remove 'wallet_' prefix

      // Set the current wallet ID
      setCurrentWalletId(walletId);

      await bot.sendMessage(chatId, "✅ Wallet connected successfully!");

      // Show wallet actions after successful wallet selection
      await showWalletActions(chatId);
    }
    // Handle swap from token selection
    else if (data.startsWith("swap_from_")) {
      const assetData = assetDataMap.get(data);
      if (!assetData) {
        await bot.sendMessage(
          chatId,
          "Selected asset not found. Please try again."
        );
        return;
      }

      userStates.set(chatId, {
        step: "select_swap_to",
        fromAssetId: assetData.id,
        fromSymbol: assetData.symbol,
        fromBalance: assetData.balance,
      });

      // Define common tokens for easier selection
      const commonTokens = [
        { symbol: "SOL", name: "Solana" },
        { symbol: "USDC", name: "USD Coin" },
        { symbol: "BTC", name: "Bitcoin (Wrapped)" },
      ];

      // Create buttons for common tokens
      const tokenKeyboard = commonTokens
        .filter((token) => token.symbol !== assetData.symbol) // Don't show the token they're swapping from
        .map((token) => [
          {
            text: `${token.symbol} (${token.name})`,
            callback_data: `swap_to_${token.symbol}`,
          },
        ]);

      // Add a custom token option
      tokenKeyboard.push([
        {
          text: "Enter custom token address",
          callback_data: "swap_to_custom",
        },
      ]);

      await bot.sendMessage(
        chatId,
        `You selected ${assetData.symbol} to swap from. Please select the token you want to swap to:`,
        {
          reply_markup: {
            inline_keyboard: tokenKeyboard,
          },
        }
      );
    }
    // Handle swap to token selection (predefined tokens)
    else if (data.startsWith("swap_to_")) {
      const tokenSymbol = data.substring(8); // Remove 'swap_to_' prefix
      const state = userStates.get(chatId);

      if (tokenSymbol === "custom") {
        // User wants to enter a custom token address
        state.step = "enter_swap_to_address";
        userStates.set(chatId, state);

        await bot.sendMessage(
          chatId,
          "Please enter the token mint address you want to swap to:"
        );
      } else {
        // User selected a predefined token
        try {
          const tokenMint = getTokenMintAddress(tokenSymbol);
          
          // Get token metadata for the selected token
          const tokenMetadata = await getTokenMetadata(tokenMint);

          console.log("tokenMetadata", tokenMetadata);

          state.toSymbol = tokenSymbol;
          state.toMint = tokenMint;
          state.toTokenDecimals = tokenMetadata.decimals;
          state.step = "enter_swap_amount";
          userStates.set(chatId, state);

          await bot.sendMessage(
            chatId,
            `You selected to swap from ${state.fromSymbol} to ${tokenSymbol}.\n\nPlease enter the amount of ${state.fromSymbol} you want to swap:`
          );
        } catch (error) {
          console.error("Error with token selection:", error);
          await bot.sendMessage(
            chatId,
            "There was an error with your token selection. Please try again."
          );
        }
      }
    }
    // Handle swap confirmation
    else if (data === "confirm_swap") {
      await executeSwap(chatId);
    } else if (data === "cancel_swap") {
      userStates.delete(chatId);
      await bot.sendMessage(chatId, "Swap cancelled.");
      await showWalletActions(chatId);
    }
    // Handle existing asset data case
    else if (assetDataMap.get(data)) {
      // Existing code for handling asset selection
      const assetData = assetDataMap.get(data);

      userStates.set(chatId, {
        step: "enter_amount",
        assetId: assetData.id,
        symbol: assetData.symbol,
        balance: assetData.balance,
      });

      await bot.sendMessage(
        chatId,
        `You selected ${assetData.symbol}. Your available balance is ${assetData.balance} ${assetData.symbol}.\n\nPlease enter the amount you want to send:`
      );
    }
    // Handle other existing cases
    else if (data === "confirm_send") {
      await executeSend(chatId);
    } else if (data === "cancel_send") {
      userStates.delete(chatId);
      await bot.sendMessage(chatId, "Transaction cancelled.");
      await showWalletActions(chatId);
    } else if (data === "new_wallet") {
      await startAuthenticationFlow(chatId);
    } else if (data === "use_current") {
      await showWalletActions(chatId);
    }

    // Answer callback query to remove loading state - with error handling
    await safeApiCall(
      bot.answerCallbackQuery(callbackQuery.id),
      "Failed to answer callback query"
    );
  } catch (error) {
    console.error("Error in callback query handler:", error);
    
    // Try to notify the user if possible
    try {
      await bot.sendMessage(
        chatId, 
        "Sorry, something went wrong. Please try the operation again."
      );
    } catch (innerError) {
      console.error("Failed to send error message:", innerError);
    }
    
    // Answer callback query regardless of other errors to prevent timeouts
    try {
      await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    } catch (callbackError) {
      console.error("Failed to answer callback query:", callbackError);
    }
  }
});

// Handle state-specific messages
async function handleStateMessage(
  chatId: number,
  text: string,
  state: any
): Promise<void> {
  switch (state.step) {
    case "enter_amount":
      await handleAmountInput(chatId, text, state);
      break;
    case "enter_address":
      await handleAddressInput(chatId, text, state);
      break;
    case "enter_swap_to_address":
      await handleSwapToAddressInput(chatId, text, state);
      break;
    case "enter_swap_amount":
      await handleSwapAmountInput(chatId, text, state);
      break;
    default:
      await bot.sendMessage(
        chatId,
        "I'm not sure what to do with that. Let's go back to the main menu."
      );
      userStates.delete(chatId);
      await showWalletActions(chatId);
  }
}

// Handle amount input
async function handleAmountInput(
  chatId: number,
  amountText: string,
  state: any
): Promise<void> {
  const amount = amountText.trim();
  const numAmount = parseFloat(amount);
  const maxBalance = parseFloat(state.balance);

  if (isNaN(numAmount) || numAmount <= 0) {
    await bot.sendMessage(
      chatId,
      "Please enter a valid amount greater than 0."
    );
    return;
  }

  if (numAmount > maxBalance) {
    await bot.sendMessage(
      chatId,
      `Insufficient balance. You only have ${state.balance} ${state.symbol} available.`
    );
    return;
  }

  // Update state with the amount
  state.amount = amount;
  state.step = "enter_address";
  userStates.set(chatId, state);

  await bot.sendMessage(
    chatId,
    `Amount: ${amount} ${state.symbol}\n\nPlease enter the recipient's address:`
  );
}

// Handle address input
async function handleAddressInput(
  chatId: number,
  address: string,
  state: any
): Promise<void> {
  const recipientAddress = address.trim();

  // Basic validation - in a real app, you might want more sophisticated validation
  if (recipientAddress.length < 10) {
    await bot.sendMessage(chatId, "Please enter a valid address.");
    return;
  }

  // Send loading message
  const loadingMessage = await bot.sendMessage(
    chatId,
    "🔍 Performing risk check on address...\nThis may take a moment."
  );

  try {
    // Perform risk check and get results
    const riskCheckResults = await performAddressRiskCheck(recipientAddress);

    // Send the risk check results screenshot with risk score information
    await bot.sendPhoto(chatId, riskCheckResults.screenshotPath, {
      caption:
        `📊 Risk Analysis Results:\n\n` +
        `Risk Score: ${riskCheckResults.riskScore}\n` +
        `Assessment: ${riskCheckResults.riskCategory}`,
    });

    // Delete loading message with safe API call
    await safeApiCall(
      bot.deleteMessage(chatId, loadingMessage.message_id),
      "Failed to delete loading message"
    );

    // Update state with the address
    state.recipientAddress = recipientAddress;
    userStates.set(chatId, state);

    // Show confirmation message
    const confirmationMessage =
      `📤 *TRANSACTION DETAILS*\n\n` +
      `*Asset:* ${state.symbol}\n` +
      `*Amount:* ${state.amount} ${state.symbol}\n` +
      `*To:* \`${recipientAddress}\`\n` +
      `*Risk Assessment:* ${riskCheckResults.riskCategory}\n\n` +
      `Please confirm this transaction.`;

    await bot.sendMessage(chatId, confirmationMessage, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_send" },
            { text: "❌ Cancel", callback_data: "cancel_send" },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error performing risk check:", error);

    // Delete loading message with safe API call
    await safeApiCall(
      bot.deleteMessage(chatId, loadingMessage.message_id),
      "Failed to delete loading message"
    );

    // Notify the user about the error but allow them to proceed
    await bot.sendMessage(
      chatId,
      "⚠️ Could not perform risk check on this address. Proceed with caution."
    );

    // Continue with the transaction flow
    state.recipientAddress = recipientAddress;
    userStates.set(chatId, state);

    const confirmationMessage =
      `📤 *TRANSACTION DETAILS*\n\n` +
      `*Asset:* ${state.symbol}\n` +
      `*Amount:* ${state.amount} ${state.symbol}\n` +
      `*To:* \`${recipientAddress}\`\n\n` +
      `Please confirm this transaction.`;

    await bot.sendMessage(chatId, confirmationMessage, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_send" },
            { text: "❌ Cancel", callback_data: "cancel_send" },
          ],
        ],
      },
    });
  }
}

// Handle swap to address input (for custom tokens)
async function handleSwapToAddressInput(
  chatId: number,
  address: string,
  state: any
): Promise<void> {
  const toMint = address.trim();

  // Basic validation for Solana addresses - they should be 44 characters
  if (toMint.length !== 44) {
    await bot.sendMessage(
      chatId,
      "Please enter a valid Solana token mint address (should be 44 characters)."
    );
    return;
  }

  // Fetch token metadata for custom token
  const loadingMsg = await bot.sendMessage(chatId, "Fetching token information...");
  
  try {
    const tokenMetadata = await getTokenMetadata(toMint);
    
    // Update state with the token mint address and metadata
    state.toMint = toMint;
    state.toSymbol = tokenMetadata.symbol;
    state.toTokenName = tokenMetadata.name;
    state.toTokenDecimals = tokenMetadata.decimals;
    state.step = "enter_swap_amount";
    userStates.set(chatId, state);

    await safeApiCall(
      bot.deleteMessage(chatId, loadingMsg.message_id),
      "Failed to delete loading message"
    );

    await bot.sendMessage(
      chatId,
      `You selected to swap from ${state.fromSymbol} to ${tokenMetadata.name} (${tokenMetadata.symbol}).\n\nPlease enter the amount of ${state.fromSymbol} you want to swap:`
    );
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    
    await safeApiCall(
      bot.deleteMessage(chatId, loadingMsg.message_id),
      "Failed to delete loading message"
    );
    
    // Continue with limited information
    state.toMint = toMint;
    state.toSymbol = "Custom Token";
    state.toTokenDecimals = 9; // Default for Solana tokens
    state.step = "enter_swap_amount";
    userStates.set(chatId, state);

    await bot.sendMessage(
      chatId,
      `You selected to swap from ${state.fromSymbol} to a custom token.\n\nPlease enter the amount of ${state.fromSymbol} you want to swap:`
    );
  }
}

// Handle swap amount input
async function handleSwapAmountInput(
  chatId: number,
  amountText: string,
  state: any
): Promise<void> {
  const amount = amountText.trim();
  const numAmount = parseFloat(amount);
  const maxBalance = parseFloat(state.fromBalance);

  if (isNaN(numAmount) || numAmount <= 0) {
    await bot.sendMessage(
      chatId,
      "Please enter a valid amount greater than 0."
    );
    return;
  }

  if (numAmount > maxBalance) {
    await bot.sendMessage(
      chatId,
      `Insufficient balance. You only have ${state.fromBalance} ${state.fromSymbol} available.`
    );
    return;
  }

  // Send loading message
  const loadingMessage = await bot.sendMessage(
    chatId,
    "🔄 Getting swap quote...\nThis may take a moment."
  );

  try {
    // Determine the input token mint address
    const fromMint = getTokenMintAddress(state.fromSymbol);
    
    // Get wallet data to find the decimals for this asset
    const walletData = await getWalletData();
    const assetInfo = walletData.find(asset => asset.asset.symbol === state.fromSymbol);
    
    if (!assetInfo) {
      throw new Error(`Could not find decimal information for ${state.fromSymbol}`);
    }
    
    // Get the decimals for this asset
    const decimals = assetInfo.asset.decimals;
    
    // Convert to smallest units based on asset's decimal places
    const amountInSmallestUnits = Number(convertToSmallestUnit(numAmount, decimals));
    
    // Store decimals for later use
    state.fromTokenDecimals = decimals;

    // Get the swap quote
    const quoteResult = await getSwapQuote(
      fromMint,
      state.toMint,
      amountInSmallestUnits
    );
    
    // Delete loading message with safe API call
    await safeApiCall(
      bot.deleteMessage(chatId, loadingMessage.message_id),
      "Failed to delete loading message"
    );

    if (!quoteResult.success) {
      throw new Error(quoteResult.error || "Failed to get swap quote");
    }

    // Use the destination token decimals from state if available (set during token selection)
    const toTokenDecimals = state.toTokenDecimals || 9;

    // Parse the expected output amount using proper decimal conversion
    const expectedOutputRaw = parseFloat(quoteResult.expectedOutput || "0");
    const expectedOutput = convertFromSmallestUnit(
      expectedOutputRaw.toString(), 
      toTokenDecimals
    );

    console.log("expectedOutput", expectedOutput);
    console.log("quoteResult", quoteResult);

    // Update state with swap details
    state.amount = amount;
    state.amountInSmallestUnits = amountInSmallestUnits;
    state.expectedOutput = expectedOutput;
    state.fromMint = fromMint;
    userStates.set(chatId, state);

    // Show confirmation message
    const confirmationMessage =
      `🔄 *SWAP DETAILS*\n\n` +
      `*From:* ${amount} ${state.fromSymbol}\n` +
      `*To:* ~${expectedOutput} ${state.toSymbol}\n` +
      `*Rate:* 1 ${state.fromSymbol} ≈ ${(
        parseFloat(expectedOutput) / numAmount
      ).toFixed(6)} ${state.toSymbol}\n\n` +
      `Please confirm this swap.`;

    await bot.sendMessage(chatId, confirmationMessage, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_swap" },
            { text: "❌ Cancel", callback_data: "cancel_swap" },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error getting swap quote:", error);

    // Delete loading message with safe API call
    await safeApiCall(
      bot.deleteMessage(chatId, loadingMessage.message_id),
      "Failed to delete loading message"
    );

    await bot.sendMessage(
      chatId,
      "Error getting swap quote. This may be due to insufficient liquidity or an unsupported token pair. Please try again with different parameters."
    );

    // Reset to select token step
    state.step = "select_swap_from";
    userStates.set(chatId, state);
    await startSwapProcess(chatId);
  }
}

// Execute the send transaction
async function executeSend(chatId: number): Promise<void> {
  const state = userStates.get(chatId);

  if (!state) {
    await bot.sendMessage(chatId, "Something went wrong. Please try again.");
    return;
  }

  try {
    await bot.sendMessage(chatId, "Processing your transaction...");

    // Get the current wallet ID
    const walletId = getCurrentWalletId();

    if (!walletId) {
      throw new Error("No authenticated wallet available");
    }

    const response = await createWithdrawal(
      walletId,
      state.assetId,
      state.amount,
      state.recipientAddress
    );

    if (response.success) {
      const data = response.data;

      // Send a plain text message without any formatting
      const transactionMessage =
        "✅ TRANSACTION SUBMITTED\n\n" +
        "Transaction ID: " +
        data.id +
        "\n" +
        "Status: " +
        data.status +
        "\n" +
        "Amount: " +
        state.amount +
        " " +
        state.symbol +
        "\n" +
        "To: " +
        state.recipientAddress +
        "\n\n" +
        "Your transaction is awaiting approval from other wallet signers.\n";

      // No parse_mode means plain text
      await bot.sendMessage(chatId, transactionMessage);

      // Clear user state
      userStates.delete(chatId);

      // Return to main menu
      await showWalletActions(chatId);
    } else {
      throw new Error(response.message || "Unknown error");
    }
  } catch (error) {
    console.error("Error executing send:", error);
    await bot.sendMessage(
      chatId,
      "There was an error processing your transaction. Please try again later."
    );

    // Return to main menu
    await showWalletActions(chatId);
  }
}

// Execute the swap transaction
async function executeSwap(chatId: number): Promise<void> {
  const state = userStates.get(chatId);

  if (!state) {
    await bot.sendMessage(chatId, "Something went wrong. Please try again.");
    return;
  }

  try {
    await bot.sendMessage(chatId, "Processing your swap...");

    // Execute the swap using the properly converted amount
    const swapResult = await executeTokenSwap(
      state.fromMint,
      state.toMint,
      state.amountInSmallestUnits
    );

    if (swapResult.success) {
      // Create Solscan link for transaction
      const solscanLink = `https://solscan.io/tx/${swapResult.txId}`;
      
      // Send success message with Solscan link
      const swapMessage =
        "✅ SWAP TRANSACTION SUBMITTED\n\n" +
        "Transaction ID: " +
        swapResult.txId +
        "\n" +
        `Swapped ${state.amount} ${state.fromSymbol} to approximately ${state.expectedOutput} ${state.toSymbol}\n\n` +
        `View on Solscan: ${solscanLink}\n\n` +
        "Your transaction is being processed on the blockchain.\n";

      await bot.sendMessage(chatId, swapMessage, { disable_web_page_preview: true });

      // Clear user state
      userStates.delete(chatId);

      // Return to main menu
      await showWalletActions(chatId);
    } else {
      throw new Error(swapResult.error || "Unknown error");
    }
  } catch (error) {
    console.error("Error executing swap:", error);
    await bot.sendMessage(
      chatId,
      "There was an error processing your swap. Please try again later."
    );

    // Return to main menu
    await showWalletActions(chatId);
  }
}

// Helper function to get appropriate emoji for crypto assets
function getAssetEmoji(symbol: string): string {
  const emojiMap: Record<string, string> = {
    BTC: "₿",
    ETH: "⟠",
    USDT: "💵",
    BNB: "🔶",
    XRP: "💧",
    ADA: "🔷",
    SOL: "☀️",
    DOGE: "🐶",
    DOT: "⚫",
    AVAX: "❄️",
    // Add more mappings as needed
  };

  return emojiMap[symbol] || "🪙";
}

// Reusable function for starting the authentication flow
async function startAuthenticationFlow(
  chatId: number,
  onAuthSuccess?: (token: string) => Promise<void>
): Promise<void> {
  try {
    // Start authentication process
    await bot.sendMessage(chatId, "Starting wallet authentication process...");
    const { verificationCode, sessionRequestId } =
      await startBotAuthentication();

    // Generate QR code containing auth data
    const qrData = `sessionRequestId=${sessionRequestId}&verificationCode=${verificationCode}`;
    const qrCodePath = await generateQRCode(qrData);

    // Send QR code image to user
    await bot.sendPhoto(chatId, qrCodePath, {
      caption: "Scan this QR code to authenticate your wallet",
    });

    // Also send verification code as text for manual entry
    await bot.sendMessage(
      chatId,
      `Or enter this verification code on the wallet dashboard:\n\n` +
        `*${verificationCode}*\n\n` +
        `Visit https://wallet.example.com/authenticate to complete the process.`,
      { parse_mode: "Markdown" }
    );

    // Start polling for token
    pollForToken(sessionRequestId, async (token) => {
      await bot.sendMessage(chatId, `✅ Wallet authenticated successfully!`);

      // Execute custom callback if provided, otherwise show workspace selection
      if (onAuthSuccess) {
        await onAuthSuccess(token);
      } else {
        await showWorkspaceSelection(chatId);
      }
    });
  } catch (error) {
    console.error("Authentication error:", error);
    await bot.sendMessage(
      chatId,
      "❌ Sorry, there was an error starting the authentication process. Please try again later."
    );
  }
}

// Function to show workspace selection
async function showWorkspaceSelection(chatId: number): Promise<void> {
  try {
    const workspaces = await getWorkspaces();

    if (workspaces.length === 0) {
      await bot.sendMessage(
        chatId,
        "No workspaces found for your account. Please create a workspace first."
      );
      return;
    }

    // Create workspace selection keyboard
    const workspaceKeyboard = workspaces.map((workspace) => [
      {
        text: workspace.name,
        callback_data: `ws_${workspace.id}`,
      },
    ]);

    await bot.sendMessage(chatId, "Please select a workspace:", {
      reply_markup: {
        inline_keyboard: workspaceKeyboard,
      },
    });
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    await bot.sendMessage(
      chatId,
      "❌ Error fetching workspaces. Please try again later."
    );
  }
}

// Add error handler for polling errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
  // The bot will automatically try to reconnect
});

// Enable graceful stop
process.once("SIGINT", () => bot.stopPolling());
process.once("SIGTERM", () => bot.stopPolling());
