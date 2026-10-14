import { api } from 'sdk';
import { searchPacks, formatResults, pageKeyboard } from '../lib/packs.js';

export default async function (query) {
  const callbackId = query?.id;
  const data = String(query?.data ?? '');
  if (!callbackId) return;

  if (data === 'packs:noop') {
    await api.answerCallbackQuery({ callback_query_id: callbackId });
    return;
  }

  const previewMatch = data.match(/^preview:([A-Za-z0-9_]{1,64})$/);
  if (previewMatch) {
    try {
      const set = await api.getStickerSet({ name: previewMatch[1] });
      const sticker = set?.stickers?.[0];
      const chatId = query.message?.chat?.id;
      if (!sticker || !chatId) {
        await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'No preview is available for this pack.' });
        return;
      }
      await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'Sending preview…' });
      await api.sendSticker({
        chat_id: chatId,
        sticker: sticker.file_id,
        reply_markup: { inline_keyboard: [[{ text: 'Add sticker pack', url: `https://t.me/addstickers/${previewMatch[1]}` }]] },
      });
    } catch (error) {
      console.warn('Sticker preview unavailable', String(error));
      await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'Preview unavailable for this pack.' });
    }
    return;
  }

  const match = data.match(/^packs:(\d+)$/);
  if (!match) {
    await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'This page button is invalid.' });
    return;
  }

  const page = Number(match[1]);
  const firstLine = String(query.message?.text ?? '').split('\n')[0];
  const keyword = firstLine.startsWith('Sticker packs for: ') ? firstLine.slice('Sticker packs for: '.length).trim() : '';

  if (!Number.isInteger(page) || page < 1 || page > 100 || !keyword || keyword.length > 80) {
    await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'This page button is invalid.' });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: callbackId, text: 'Loading…' });
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId) return;

  try {
    const result = await searchPacks(keyword, page);
    const hasNext = result.packs.length === result.pageSize && (page * result.pageSize < result.totalCount || result.totalCount === 0);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatResults(keyword, result),
      reply_markup: pageKeyboard(keyword, page, result, hasNext),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('Sticker pagination failed', String(error));
    await api.sendMessage({ chat_id: chatId, text: 'Could not load that page. Please run the search again.' });
  }
}
