import { api } from 'sdk';
import { parsePacksCommand, searchPacks, formatResults, pageKeyboard } from '../lib/packs.js';

export default async function (message) {
  const text = message?.text ?? '';
  const chatId = message?.chat?.id;
  if (!chatId) return;

  if (/^\/(start|help)(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Sticker Pack Search\n\nUse .packs penguin or /packs penguin.\nUse /packs cute cat page 2 for another page.\nThe search uses an external sticker directory, so it cannot guarantee every Telegram pack.',
    });
    return;
  }

  const command = parsePacksCommand(text);
  if (!command) return;
  if (!command.query) {
    await api.sendMessage({ chat_id: chatId, text: 'Give me a keyword. Example: .packs penguin' });
    return;
  }

  try {
    const result = await searchPacks(command.query, command.page);
    const hasNext = result.packs.length === result.pageSize && (result.page * result.pageSize < result.totalCount || result.totalCount === 0);
    await api.sendMessage({
      chat_id: chatId,
      text: formatResults(command.query, result),
      reply_markup: pageKeyboard(command.query, command.page, result, hasNext),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('Sticker search failed', String(error));
    await api.sendMessage({
      chat_id: chatId,
      text: 'Sticker search is temporarily unavailable. Please try again shortly.',
    });
  }
}
