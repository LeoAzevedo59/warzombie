/** Leitura centralizada das variáveis de ambiente (falha cedo se faltar algo essencial). */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required('DATABASE_URL'),
  /** Hz do broadcast de estado dos jogadores */
  WS_TICK_RATE: Number(process.env.WS_TICK_RATE ?? 20),
  /** seed do mundo compartilhado — igual em todos os clients */
  WORLD_SEED: Number(process.env.WORLD_SEED ?? 1337),
  get isProd() {
    return this.NODE_ENV === 'production';
  },
  /** painel ⚙ de cheats: ligado fora de produção ou com DEV_CHEATS=1 (ex.: no compose para testar fases) */
  get devCheats() {
    const v = process.env.DEV_CHEATS;
    return v !== undefined ? v === '1' || v === 'true' : this.NODE_ENV !== 'production';
  },
} as const;
