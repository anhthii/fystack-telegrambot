import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// Ensure temp directory exists
const tempDir = path.join(__dirname, '../../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Generates a QR code image for the given data
 * @param data The data to encode in the QR code
 * @returns Path to the generated QR code image
 */
export async function generateQRCode(data: string): Promise<string> {
  const fileName = `qrcode-${uuidv4()}.png`;
  const filePath = path.join(tempDir, fileName);
  
  await QRCode.toFile(filePath, data, {
    color: {
      dark: '#0088cc', // Telegram blue color
      light: '#ffffff'
    },
    width: 300,
    margin: 1
  });
  
  return filePath;
} 