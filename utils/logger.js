const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const fileOpts = { maxsize: 5242880, maxFiles: 5 };

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ ...fileOpts, filename: path.join(logsDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ ...fileOpts, filename: path.join(logsDir, 'combined.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, stack }) =>
          stack
            ? `[${timestamp}] ${level}: ${message}\n${stack}`
            : `[${timestamp}] ${level}: ${message}`
        )
      ),
    }),
  ],
});

function describe(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

for (const level of ['error', 'warn', 'info', 'debug']) {
  const original = logger[level].bind(logger);
  logger[level] = (msg, ...rest) => {
    if (!rest.length) return original(msg);
    const head = msg instanceof Error ? (msg.stack || msg.message) : String(msg);
    return original(`${head} ${rest.map(describe).join(' ')}`);
  };
}

module.exports = logger;
