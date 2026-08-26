/** Logger mínimo com prefixo e timestamp; trocar por pino quando precisar de mais. */
type Level = 'info' | 'warn' | 'error' | 'debug';

function line(level: Level, scope: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`${ts} [${level}] [${scope}] ${msg}`, extra === undefined ? '' : extra);
}

export function createLogger(scope: string) {
  return {
    info: (msg: string, extra?: unknown) => line('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => line('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => line('error', scope, msg, extra),
    debug: (msg: string, extra?: unknown) => {
      if (process.env.NODE_ENV !== 'production') line('debug', scope, msg, extra);
    },
  };
}
