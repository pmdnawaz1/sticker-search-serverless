import { fetch } from 'sdk';
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { searchCache } from '../schema.js';

const CATALOG_URL = 'https://raw.githubusercontent.com/pmdnawaz1/sticker-search-serverless/main/catalog/packs.json';
const CATALOG_CACHE_KEY = '__catalog_v1__';
const PAGE_SIZE = 10;
const CACHE_SECONDS = 1800;
const CATALOG_CACHE_SECONDS = 21600;
const MAX_QUERY_LENGTH = 80;

export function normalizeQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

export function parsePacksCommand(text) {
  const match = String(text ?? '').trim().match(/^(?:\.packs|\/packs)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  let query = normalizeQuery(match[1] ?? '');
  let page = 1;
  const pageMatch = query.match(/\s+page\s+(\d+)\s*$/i);
  if (pageMatch) {
    page = Math.max(1, Math.min(100, Number(pageMatch[1]) || 1));
    query = normalizeQuery(query.slice(0, pageMatch.index));
  }

  return { query, page };
}

function normalizePack(pack) {
  const name = String(pack?.name ?? '').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) return null;
  const title = String(pack?.title ?? name).replace(/[<>]/g, '').slice(0, 180);
  return {
    name,
    title,
    url: 'https://t.me/addstickers/' + name,
    count: Number.isFinite(Number(pack?.sticker_count)) ? Number(pack.sticker_count) : null,
    type: pack?.animated ? 'animated' : 'image',
    verified: false,
  };
}

function rankAndFilter(packs, query) {
  const normalizedQuery = query.toLocaleLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const unique = new Map();

  for (const raw of packs) {
    const pack = normalizePack(raw);
    if (!pack || unique.has(pack.name.toLowerCase())) continue;

    const title = pack.title.toLocaleLowerCase();
    const name = pack.name.toLocaleLowerCase();
    const searchable = title + ' ' + name;
    const matchedTokens = tokens.filter((token) => searchable.includes(token)).length;
    const phraseMatch = title.includes(normalizedQuery) || name.includes(normalizedQuery);
    if (!phraseMatch && matchedTokens === 0) continue;

    let score = 10 - matchedTokens;
    if (title === normalizedQuery) score = 0;
    else if (name === normalizedQuery) score = 1;
    else if (title.startsWith(normalizedQuery)) score = 2;
    else if (name.startsWith(normalizedQuery)) score = 3;
    else if (title.includes(normalizedQuery)) score = 4;
    else if (name.includes(normalizedQuery)) score = 5;

    unique.set(pack.name.toLowerCase(), { ...pack, score, matchedTokens });
  }

  return [...unique.values()]
    .sort((a, b) => a.score - b.score || b.matchedTokens - a.matchedTokens || a.title.localeCompare(b.title))
    .map(({ score, matchedTokens, ...pack }) => pack);
}

async function getCached(query) {
  const row = await db.select().from(searchCache).where(eq(searchCache.query, query.toLocaleLowerCase())).get();
  if (!row || row.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return row.results;
}

async function setCached(query, results, ttl = CACHE_SECONDS) {
  const key = query.toLocaleLowerCase();
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  await db.insert(searchCache).values({
    query: key,
    results,
    expiresAt,
  }).onConflictDoUpdate({
    target: searchCache.query,
    set: { results, expiresAt },
  }).run();
}

async function loadCatalog() {
  const row = await db.select().from(searchCache).where(eq(searchCache.query, CATALOG_CACHE_KEY)).get();
  const now = Math.floor(Date.now() / 1000);

  if (row && row.expiresAt > now && Array.isArray(row.results)) return row.results;

  try {
    const response = await fetch(CATALOG_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Sticker catalog returned HTTP ' + response.status);

    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.length === 0) {
      throw new Error('Sticker catalog is empty or malformed');
    }

    await setCached(CATALOG_CACHE_KEY, catalog, CATALOG_CACHE_SECONDS);
    return catalog;
  } catch (error) {
    if (row && Array.isArray(row.results) && row.results.length > 0) {
      console.warn('Using stale sticker catalog after refresh failed', String(error));
      return row.results;
    }
    throw new Error('Sticker catalog is not available yet. Check the build-catalog GitHub Action.');
  }
}

export async function searchPacks(query, page) {
  const normalized = normalizeQuery(query);
  const cacheKey = 'search:' + normalized.toLocaleLowerCase();
  const cached = await getCached(cacheKey);
  let packs = cached?.packs;
  let totalCount = cached?.totalCount ?? 0;

  if (!packs) {
    const catalog = await loadCatalog();
    packs = rankAndFilter(catalog, normalized);
    totalCount = packs.length;
    await setCached(cacheKey, { packs, totalCount });
  }

  const start = (page - 1) * PAGE_SIZE;
  return {
    packs: packs.slice(start, start + PAGE_SIZE),
    totalCount,
    page,
    pageSize: PAGE_SIZE,
  };
}

export function formatResults(query, result) {
  const lines = ['Sticker packs for: ' + query, 'Page ' + result.page + ' · ' + result.packs.length + ' result(s) of ' + result.totalCount, ''];
  result.packs.forEach((pack, index) => {
    const number = (result.page - 1) * result.pageSize + index + 1;
    lines.push(number + '. ' + pack.title + (pack.type === 'animated' ? ' · animated' : ''));
    lines.push(pack.url);
    lines.push('');
  });
  if (!result.packs.length) lines.push('No packs found. Try a broader keyword.');
  lines.push('Search uses a community catalog snapshot; it is not a live, complete Telegram-wide index.');
  return lines.join('\n').slice(0, 3900);
}

export function pageKeyboard(query, page, result, hasNext) {
  const rows = [];
  for (const pack of result.packs) {
    const buttons = [];
    if (pack.name.length <= 56) buttons.push({ text: ('Preview · ' + pack.title).slice(0, 60), callback_data: 'preview:' + pack.name });
    buttons.push({ text: 'Add pack', url: pack.url });
    rows.push(buttons);
  }

  const navigation = [];
  if (page > 1) navigation.push({ text: '‹ Previous', callback_data: 'packs:' + (page - 1) });
  navigation.push({ text: 'Page ' + page, callback_data: 'packs:noop' });
  if (hasNext) navigation.push({ text: 'Next ›', callback_data: 'packs:' + (page + 1) });
  rows.push(navigation);
  return { inline_keyboard: rows };
}
