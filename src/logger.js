import chalk from 'chalk';
import { config } from './config.js';

/**
 * Logger utility with different log levels
 */
export class Logger {
  constructor(context = '') {
    this.context = context;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };
    this.currentLevel = this.levels[config.logging.level] || this.levels.info;
  }

  /**
   * Format log message with timestamp and context
   */
  _format(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const contextStr = this.context ? `[${this.context}]` : '';
    return `${chalk.gray(timestamp)} ${level} ${contextStr} ${message}`;
  }

  /**
   * Log error message
   */
  error(message, error = null) {
    if (this.currentLevel >= this.levels.error) {
      console.error(this._format(chalk.red('ERROR'), message));
      if (error) {
        if (error.stack) {
          console.error(chalk.gray(error.stack));
        } else {
          console.error(chalk.gray(error.toString()));
        }
      }
    }
  }

  /**
   * Log warning message
   */
  warn(message) {
    if (this.currentLevel >= this.levels.warn) {
      console.warn(this._format(chalk.yellow('WARN'), message));
    }
  }

  /**
   * Log info message
   */
  info(message) {
    if (this.currentLevel >= this.levels.info) {
      console.log(this._format(chalk.blue('INFO'), message));
    }
  }

  /**
   * Log debug message
   */
  debug(message) {
    if (this.currentLevel >= this.levels.debug) {
      console.log(this._format(chalk.gray('DEBUG'), message));
    }
  }

  /**
   * Log success message
   */
  success(message) {
    if (this.currentLevel >= this.levels.info) {
      console.log(this._format(chalk.green('✓'), message));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context) {
    const childContext = this.context ? `${this.context}:${context}` : context;
    return new Logger(childContext);
  }
}

// Export default logger instance
export const logger = new Logger();

