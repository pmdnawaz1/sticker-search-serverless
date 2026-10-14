import { fetch } from 'sdk';
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { searchCache } from '../schema.js';

const PROVIDER_URL = 'https://fstik.app/api/sticker-sets/search';
const PAGE_SIZE = 10;
const CACHE_SECONDS = 1800;
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
  const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
  return {
    name,
    title,
    url: `https://t.me/addstickers/${name}`,
    count: Number.isFinite(Number(pack?.sticker_count)) ? Number(pack.sticker_count) : (stickers.length || null),
    previewFileId: stickers[0]?.file_id ?? null,
    type: String(pack?.type ?? 'image'),
    verified: Boolean(pack?.verified),
  };
}

function rankAndDeduplicate(packs, query) {
  const normalizedQuery = query.toLocaleLowerCase();
  const unique = new Map();
  for (const raw of packs) {
    const pack = normalizePack(raw);
    if (!pack || unique.has(pack.name.toLowerCase())) continue;
    unique.set(pack.name.toLowerCase(), pack);
  }
  return [...unique.values()].sort((a, b) => {
    const aTitle = a.title.toLocaleLowerCase();
    const bTitle = b.title.toLocaleLowerCase();
    const score = (title) => title === normalizedQuery ? 0 : title.startsWith(normalizedQuery) ? 1 : title.includes(normalizedQuery) ? 2 : 3;
    return score(aTitle) - score(bTitle) || a.title.localeCompare(b.title);
  });
}

async function getCached(query) {
  const row = await db.select().from(searchCache).where(eq(searchCache.query, query.toLocaleLowerCase())).get();
  if (!row || row.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return row.results;
}

async function setCached(query, results) {
  const key = query.toLocaleLowerCase();
  await db.insert(searchCache).values({
    query: key,
    results,
    expiresAt: Math.floor(Date.now() / 1000) + CACHE_SECONDS,
  }).onConflictDoUpdate({
    target: searchCache.query,
    set: { results, expiresAt: Math.floor(Date.now() / 1000) + CACHE_SECONDS },
  }).run();
}

async function fetchProviderPage(query, skip) {
  const url = `${PROVIDER_URL}?type=search&query=${encodeURIComponent(query)}&public=true&safe=true&limit=50&skip=${skip}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Sticker directory returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.ok || !Array.isArray(payload?.result?.stickerSets)) {
    throw new Error('Sticker directory returned an unexpected response');
  }
  return {
    packs: payload.result.stickerSets,
    totalCount: Number(payload.result.totalCount) || 0,
  };
}

export async function searchPacks(query, page) {
  const cached = await getCached(query);
  let packs = cached?.packs;
  let totalCount = cached?.totalCount ?? 0;

  if (!packs) {
    const result = await fetchProviderPage(query, 0);
    packs = result.packs;
    totalCount = result.totalCount;
    packs = rankAndDeduplicate(packs, query);
    await setCached(query, { packs, totalCount });
  }

  const start = (page - 1) * PAGE_SIZE;
  let pagePacks = packs.slice(start, start + PAGE_SIZE);

  if (pagePacks.length < PAGE_SIZE && totalCount > packs.length && page <= 10) {
    try {
      const extra = await fetchProviderPage(query, packs.length);
      const merged = rankAndDeduplicate([...packs, ...extra.packs], query);
      packs = merged;
      totalCount = Math.max(totalCount, extra.totalCount);
      await setCached(query, { packs, totalCount });
      pagePacks = packs.slice(start, start + PAGE_SIZE);
    } catch (error) {
      console.warn('Could not extend sticker search results', String(error));
    }
  }

  return { packs: pagePacks, totalCount, page, pageSize: PAGE_SIZE };
}

export function formatResults(query, result) {
  const lines = [`Sticker packs for: ${query}`, `Page ${result.page} · ${result.packs.length} result(s)`, ''];
  result.packs.forEach((pack, index) => {
    const number = (result.page - 1) * result.pageSize + index + 1;
    const count = pack.count ? ` · ${pack.count} stickers` : '';
    const verified = pack.verified ? ' · verified directory listing' : '';
    lines.push(`${number}. ${pack.title}${count}${verified}`);
    lines.push(pack.url);
    lines.push('');
  });
  if (!result.packs.length) lines.push('No packs found on this page. Try a broader keyword.');
  lines.push('Results depend on the directory index; this is not a complete Telegram-wide search.');
  return lines.join('\n').slice(0, 3900);
}

export function pageKeyboard(query, page, result, hasNext) {
  const rows = [];
  for (const pack of result.packs) {
    const buttons = [];
    if (pack.name.length <= 56) buttons.push({ text: `Preview · ${pack.title}`.slice(0, 60), callback_data: `preview:${pack.name}` });
    buttons.push({ text: 'Add pack', url: pack.url });
    rows.push(buttons);
  }
  const navigation = [];
  if (page > 1) navigation.push({ text: '‹ Previous', callback_data: `packs:${page - 1}` });
  navigation.push({ text: `Page ${page}`, callback_data: 'packs:noop' });
  if (hasNext) navigation.push({ text: 'Next ›', callback_data: `packs:${page + 1}` });
  rows.push(navigation);
  return { inline_keyboard: rows };
}
