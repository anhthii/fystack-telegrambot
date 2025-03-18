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

// Load environment variables
dotenv.config();

// Initialize bot with token from environment variables
const bot = new TelegramBot(process.env.BOT_TOKEN || "", { polling: true });

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
});

// Handle messages
bot.on("message", async (msg) => {
  if (!msg.text) return;

  if (msg.text === "💼 Connect Wallet") {
    await bot.sendMessage(
      msg.chat.id,
      "Generating QR code for wallet connection..."
    );

    // Generate QR code
    const imageBuffer = await generateQRCode("wallet-connection-data");
    await bot.sendPhoto(msg.chat.id, imageBuffer);

    // Simulate scanning process
    setTimeout(async () => {
      await bot.sendMessage(msg.chat.id, "✅ Wallet connected successfully!");

      // Show wallet data after connection
      await showWalletData(msg.chat.id);
    }, 3000);
  } else if (msg.text === "📊 Monitor Wallet") {
    await showWalletData(msg.chat.id);
  }
});

// Function to display wallet data
async function showWalletData(chatId: number): Promise<void> {
  try {
    // Get wallet data from service
    const walletData = await getWalletData();

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

    // Transform the object into an array for the chart
    const allocationArray = Object.entries(allocation).map(([name, percentage]) => ({
      name,
      percentage
    }));

    // Generate allocation chart
    const allocationChartBuffer = await createAllocationChart(allocationArray);
    await bot.sendPhoto(chatId, allocationChartBuffer, {
      caption: "📊 Portfolio Allocation",
    });

    // Show detailed assets
    let assetsMessage = "🔎 *Detailed Assets*:\n\n";
    walletData.forEach((asset) => {
      assetsMessage += `*${asset.asset.name}* (${asset.asset.symbol})\n`;
      assetsMessage += `Balance: ${asset.balance} ${asset.asset.symbol}\n`;
      assetsMessage += `Value: $${parseFloat(asset.valueUsd).toFixed(
        2
      )} USD\n\n`;
    });

    await bot.sendMessage(chatId, assetsMessage, { parse_mode: "Markdown" });
  } catch (error: unknown) {
    console.error('Error showing wallet data:', error);
    await bot.sendMessage(chatId, 'Sorry, there was an error fetching your wallet data.');
  }
}

// Enable graceful stop
process.once("SIGINT", () => bot.stopPolling());
process.once("SIGTERM", () => bot.stopPolling());

