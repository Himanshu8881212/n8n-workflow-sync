import winston from 'winston';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Ensure logs directory exists
const logsDir = join(process.cwd(), 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  ),
  transports: [
    // Console transport with colors
    new winston.transports.Console({
      format: combine(
        colorize(),
        consoleFormat,
      ),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: join(logsDir, 'combined.log'),
      format: json(),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File transport for errors only
    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      format: json(),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add debug mode support
if (process.env.DEBUG === 'true' || process.argv.includes('--debug') || process.argv.includes('--verbose')) {
  logger.level = 'debug';
}

/**
 * Enhanced logger with structured logging
 */
export class Logger {
  constructor(context = 'App') {
    this.context = context;
  }

  debug(message, meta = {}) {
    logger.debug(message, { context: this.context, ...meta });
  }

  info(message, meta = {}) {
    logger.info(message, { context: this.context, ...meta });
  }

  warn(message, meta = {}) {
    logger.warn(message, { context: this.context, ...meta });
  }

  error(message, error = null, meta = {}) {
    const errorMeta = error ? {
      error: {
        message: error.message,
        stack: error.stack,
        ...error,
      },
    } : {};

    logger.error(message, { context: this.context, ...errorMeta, ...meta });
  }

  /**
   * Log sync operation
   */
  logSync(operation, details = {}) {
    this.info(`Sync: ${operation}`, { operation: 'sync', ...details });
  }

  /**
   * Log API call
   */
  logApiCall(method, endpoint, details = {}) {
    this.debug(`API: ${method} ${endpoint}`, { operation: 'api', method, endpoint, ...details });
  }

  /**
   * Log file operation
   */
  logFileOp(operation, filePath, details = {}) {
    this.debug(`File: ${operation} ${filePath}`, { operation: 'file', filePath, ...details });
  }
}

// Export default logger instance
export const defaultLogger = new Logger('n8n-sync');

// Export winston logger for advanced use cases
export { logger as winstonLogger };

