import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { generateQRCode } from "./utils/qrCode";
import {
  getWalletData,
  getPortfolioAllocation,
} from "./services/walletService";
import {
  createBalanceChart,
  createAllocationChart,
} from "./utils/chartGenerator";
import { createWithdrawal } from "./services/apiService";

// Load environment variables
dotenv.config();

// Initialize bot with token from environment variables
const bot = new TelegramBot(process.env.BOT_TOKEN || "", { polling: true });

// Store user states for multi-step processes
const userStates = new Map();

// Wallet ID (should be stored per user in a real application)
const WALLET_ID = "6889a826-ac1e-4354-a150-66d6c4cfe97c";

// Create a map to store asset data with a unique key
const assetDataMap = new Map<string, { id: string; symbol: string; balance: string }>();

// Start command handler
bot.onText(/\/start/, async (msg) => {
  const opts = {
    reply_markup: {
      keyboard: [["💼 Connect Wallet", "📊 Monitor Wallet"]],
      resize_keyboard: true,
    },
  };

  await bot.sendMessage(
    msg.chat.id,
    `👋 Welcome to Crypto Wallet Monitor Bot! ${msg.from?.first_name} 🚀`,
    opts
  );

  // Reset user state
  userStates.delete(msg.chat.id);
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
    await bot.sendMessage(
      chatId,
      "Generating QR code for wallet connection..."
    );

    // Generate QR code
    const imageBuffer = await generateQRCode("wallet-connection-data");
    await bot.sendPhoto(chatId, imageBuffer);

    // Simulate scanning process
    setTimeout(async () => {
      await bot.sendMessage(chatId, "✅ Wallet connected successfully!");

      // Show wallet actions
      await showWalletActions(chatId);
    }, 3000);
  } else if (msg.text === "📊 Monitor Wallet") {
    await showWalletData(chatId);
  } else if (msg.text === "💸 Send") {
    await startSendProcess(chatId);
  } else if (msg.text === "🔄 Swap") {
    await bot.sendMessage(chatId, "Swap feature coming soon!");
  } else if (msg.text === "🏠 Main Menu") {
    await showWalletActions(chatId);
  }
});

// Function to show main wallet actions
async function showWalletActions(chatId: number): Promise<void> {
  const opts = {
    reply_markup: {
      keyboard: [["💸 Send", "🔄 Swap"], ["📊 Monitor Wallet"]],
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
    // Get wallet data from service
    const walletData = await getWalletData(WALLET_ID);

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

      assetsMessage += `${index + 1}. ${assetEmoji} *${asset.asset.name}* (${
        asset.asset.symbol
      })\n`;
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
    const walletData = await getWalletData(WALLET_ID);

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

      return [
        {
          text: `${asset.asset.symbol} (${asset.availableBalance})`,
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

// Handle callback queries (for inline buttons)
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (!data) return;

  // Retrieve asset data from the map
  const assetData = assetDataMap.get(data);

  if (assetData) {
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
  } else if (data === "confirm_send") {
    await executeSend(chatId);
  } else if (data === "cancel_send") {
    userStates.delete(chatId);
    await bot.sendMessage(chatId, "Transaction cancelled.");
    await showWalletActions(chatId);
  }

  // Answer callback query to remove loading state
  await bot.answerCallbackQuery(callbackQuery.id);
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

  // Update state with the address
  state.recipientAddress = recipientAddress;
  userStates.set(chatId, state);

  // Show confirmation message
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

// Execute the send transaction
async function executeSend(chatId: number): Promise<void> {
  const state = userStates.get(chatId);

  if (!state) {
    await bot.sendMessage(chatId, "Something went wrong. Please try again.");
    return;
  }

  try {
    await bot.sendMessage(chatId, "Processing your transaction...");

    const response = await createWithdrawal(
      WALLET_ID,
      state.assetId,
      state.amount,
      state.recipientAddress
    );

    if (response.success) {
      const data = response.data;

      // Send a plain text message without any formatting
      const transactionMessage = 
        "✅ TRANSACTION SUBMITTED\n\n" +
        "Transaction ID: " + data.id + "\n" +
        "Status: " + data.status + "\n" +
        "Amount: " + state.amount + " " + state.symbol + "\n" +
        "To: " + state.recipientAddress + "\n\n" +
        "Your transaction is awaiting approval from other wallet signers.\n" +
        "Required approvals: " + data.withdrawalApprovals.length;

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

// Enable graceful stop
process.once("SIGINT", () => bot.stopPolling());
process.once("SIGTERM", () => bot.stopPolling());
