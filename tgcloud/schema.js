import { table, integer, text, json } from 'sdk/db';

export const searchCache = table('search_cache', {
  query:    text('query').primaryKey(),
  results:  json('results').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
