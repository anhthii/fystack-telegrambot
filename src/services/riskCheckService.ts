import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";

/**
 * Determines the risk category based on a numeric risk score
 * @param score The numeric risk score
 * @returns Risk category as string (Low Risk, Medium Risk, or High Risk)
 */
function getRiskCategory(score: number): string {
  if (score <= 23) return "Low Risk";
  if (score <= 50) return "Medium Risk";
  return "High Risk";
}

/**
 * Performs a risk check on a cryptocurrency address and takes a screenshot of the results
 * @param address The cryptocurrency address to check
 * @returns Object containing path to the screenshot and risk assessment details
 */
export async function performAddressRiskCheck(
  address: string
): Promise<{ screenshotPath: string; riskScore: string; riskCategory: string }> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Navigate to the risk check page
    await page.goto("https://cryptoriskdashboard.netlify.app/");

    // Wait for page to load fully
    await page.waitForSelector('#address-input', { timeout: 5000 });

    // Type the address into the search field
    await page.type('#address-input', address);

    // Click the analyze button
    await page.click('#analyze-button');
    
    // First check if there's a loading indicator and wait for it to disappear
    try {
      const loadingIndicator = await page.$('#loading-indicator');
      if (loadingIndicator) {
        console.log("Loading indicator found, waiting for it to disappear...");
        await page.waitForSelector('#loading-indicator', { hidden: true, timeout: 15000 });
      }
    } catch (error) {
      console.log("No loading indicator found or error waiting for it to disappear");
    }
    
    // Wait for the risk-score element to appear
    await page.waitForSelector('#risk-score', { timeout: 10000 });
    
    // Extract the risk score value
    const riskScoreText = await page.evaluate(() => {
      const element = document.querySelector('#risk-score');
      return element ? element.textContent : 'Not available';
    });
    
    console.log(`Risk Score: ${riskScoreText}`);
    
    // Parse the risk score to determine category
    const numericScore = parseFloat(riskScoreText || '0');
    const riskCategory = getRiskCategory(numericScore);

    // Take a screenshot of the results
    const screenshotDir = path.join(__dirname, "../../temp");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(
      screenshotDir,
      `risk-check-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      screenshotPath,
      riskScore: riskScoreText || 'Not available',
      riskCategory
    };
  } catch (error) {
    console.error("Error performing risk check:", error);
    throw new Error("Failed to perform risk check on address");
  } finally {
    await browser.close();
  }
}

