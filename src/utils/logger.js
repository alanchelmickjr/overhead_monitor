/**
 * Simple logger module with colored output and timestamps
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  white: '\x1b[37m'
};

// Log levels with corresponding colors
const levels = {
  info: { color: colors.blue, label: 'INFO' },
  error: { color: colors.red, label: 'ERROR' },
  success: { color: colors.green, label: 'SUCCESS' },
  warning: { color: colors.yellow, label: 'WARN' },
  debug: { color: colors.white, label: 'DEBUG' }
};

/**
 * Format timestamp for log entries
 */
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substr(0, 19);
}

/**
 * Generic log function
 * @param {string} message - The message to log
 * @param {string} level - The log level (info, error, success, warning, debug)
 */
function log(message, level = 'info') {
  const levelConfig = levels[level] || levels.info;
  const timestamp = getTimestamp();
  const prefix = `${levelConfig.color}[${timestamp}] [${levelConfig.label}]${colors.reset}`;
  
  console.log(`${prefix} ${message}`);
}

/**
 * Log informational message
 * @param {string} message - The message to log
 */
function info(message) {
  log(message, 'info');
}

/**
 * Log error message
 * @param {string} message - The message to log
 */
function error(message) {
  log(message, 'error');
}

/**
 * Log success message
 * @param {string} message - The message to log
 */
function success(message) {
  log(message, 'success');
}

/**
 * Log warning message
 * @param {string} message - The message to log
 */
function warning(message) {
  log(message, 'warning');
}

// Export logger object
module.exports = {
  log,
  info,
  error,
  success,
  warning
};