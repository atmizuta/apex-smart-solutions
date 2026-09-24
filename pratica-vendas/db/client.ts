import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada — veja .env.example.');
}

export const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
