import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { ChartConfiguration, ChartTypeRegistry, Chart } from 'chart.js';

// Ensure temp directory exists
const tempDir = path.join(__dirname, '../../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure chart canvas
const width = 600;
const height = 400;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#1e1e1e' });

// Add near the top of the file
type ChartConfigurationWithoutTypeConstraint = Omit<ChartConfiguration<keyof ChartTypeRegistry, number[], unknown>, 'type'> & {
  type: string;
};

/**
 * Creates a balance chart image
 * @param balance Current balance in USD
 * @returns Path to the generated chart image
 */
export async function createBalanceChart(balance: number): Promise<string> {
  // Mock data for balance history (in a real app, this would come from an API)
  const mockBalanceHistory = [
    { time: '10', value: 8000 },
    { time: '11', value: 7500 },
    { time: '12', value: 6300 },
    { time: '13', value: 6250 },
    { time: '14', value: 6300 },
    { time: '15', value: 6400 },
    { time: '16', value: balance },
  ];
  
  const configuration = {
    type: 'line',
    data: {
      labels: mockBalanceHistory.map(point => point.time),
      datasets: [{
        label: 'Balance (USD)',
        data: mockBalanceHistory.map(point => point.value),
        borderColor: '#0088cc',
        backgroundColor: 'rgba(0, 136, 204, 0.2)',
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context: any) {
              return `$${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
            callback: function(value: any) {
              return `${value.toFixed(2)}`;
            }
          }
        },
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)'
          }
        }
      }
    }
  } as any;
  
  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  const fileName = `balance-chart-${uuidv4()}.png`;
  const filePath = path.join(tempDir, fileName);
  
  fs.writeFileSync(filePath, image);
  return filePath;
}

/**
 * Creates a portfolio allocation chart image
 * @param allocation Portfolio allocation data
 * @returns Path to the generated chart image
 */
export async function createAllocationChart(allocation: any[]): Promise<string> {
  const configuration = {
    type: 'doughnut',
    data: {
      labels: allocation.map(item => item.name),
      datasets: [{
        data: allocation.map(item => item.percentage),
        backgroundColor: [
          '#0088cc', // Blue
          '#00cc88', // Green
          '#cc0088', // Pink
          '#cc8800', // Orange
          '#88cc00'  // Light green
        ],
        borderWidth: 0
      }]
    },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(255, 255, 255, 0.7)',
            padding: 20,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context: any) {
              const label = context.label || '';
              const value = context.parsed || 0;
              return `${label}: ${value}%`;
            }
          }
        }
      },
      cutout: '60%'
    }
  } as any;
  
  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  const fileName = `allocation-chart-${uuidv4()}.png`;
  const filePath = path.join(tempDir, fileName);
  
  fs.writeFileSync(filePath, image);
  return filePath;
} 