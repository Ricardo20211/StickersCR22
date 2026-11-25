const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '..', 'logs');
const pluginErrorsDir = path.join(logsDir, 'plugin-errors');
const grupoLogsDir = path.join(logsDir, 'grupo');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(pluginErrorsDir)) fs.mkdirSync(pluginErrorsDir, { recursive: true });
if (!fs.existsSync(grupoLogsDir)) fs.mkdirSync(grupoLogsDir, { recursive: true });

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



const errorHooks = [];
let inErrorHook = false;
logger.addErrorHook = (fn) => { errorHooks.push(fn); };

function runErrorHooks(args) {
  if (inErrorHook || !errorHooks.length) return;
  inErrorHook = true;
  try {
    for (const fn of errorHooks) {
      try { fn(args); } catch {}
    }
  } finally {
    inErrorHook = false;
  }
}

for (const level of ['error', 'warn', 'info', 'debug']) {
  const original = logger[level].bind(logger);
  logger[level] = (msg, ...rest) => {
    if (level === 'error') runErrorHooks([msg, ...rest]);
    if (!rest.length) return original(msg);
    const head = msg instanceof Error ? (msg.stack || msg.message) : String(msg);
    return original(`${head} ${rest.map(describe).join(' ')}`);
  };
}

function logPluginError(pluginName, err) {
  try {
    const name = pluginName ?? 'unknown';
    if (!fs.existsSync(pluginErrorsDir)) fs.mkdirSync(pluginErrorsDir, { recursive: true });
    const ts = new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
    const file = path.join(pluginErrorsDir, `${name}_${ts}.txt`);
    const content = [
      `Plugin: ${name}`,
      `Fecha: ${new Date().toISOString()}`,
      `Error: ${err?.message ?? String(err)}`,
      '',
      err?.stack ?? '(sin stack)',
    ].join('\n');
    fs.writeFileSync(file, content, 'utf8');
    logger.error(`[PLUGIN ERROR] ${name}: ${err?.message ?? err}`);
  } catch (e) {
    console.error('[logPluginError] No se pudo escribir el archivo de error:', e.message);
  }
}

function logGroupAdminChange({ chatId, actor, target, action }) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); 
    const ts = now.toISOString().replace('T', ' ').slice(0, 19);
    const file = path.join(grupoLogsDir, `${dateStr}.log`);
    const actorTag = actor ? `@${actor.split('@')[0]}` : '(desconocido)';
    const targetTag = `@${target.split('@')[0]}`;
    const line = `[${ts}] ${action.toUpperCase()} | Grupo: ${chatId} | Actor: ${actorTag} | Target: ${targetTag}\n`;
    fs.appendFileSync(file, line, 'utf8');
  } catch (e) {
    console.error('[logGroupAdminChange] No se pudo escribir el log de grupo:', e.message);
  }
}

module.exports = logger;
module.exports.logPluginError = logPluginError;
module.exports.logGroupAdminChange = logGroupAdminChange;
