import type { Markup } from 'telegraf';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'telegraf/types';
import { logger } from '../utils/logger.js';
import type { BotContext } from './session.js';

export type AnyKeyboard =
  | Markup.Markup<InlineKeyboardMarkup>
  | Markup.Markup<ReplyKeyboardMarkup>
  | Markup.Markup<ReplyKeyboardRemove>;

function buildExtra(keyboard?: AnyKeyboard) {
  return {
    parse_mode: 'HTML' as const,
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}),
  };
}

function isInlineKeyboard(
  keyboard: AnyKeyboard | undefined,
): keyboard is Markup.Markup<InlineKeyboardMarkup> {
  return Boolean(keyboard && 'inline_keyboard' in keyboard.reply_markup);
}

/**
 * Renders one screen of the flow. When the update came from an inline button we
 * edit the existing message so the chat does not fill up with duplicates; in
 * every other case (or when editing is impossible, e.g. the previous message was
 * a photo card) we send a new one.
 */
export async function screen(ctx: BotContext, text: string, keyboard?: AnyKeyboard): Promise<void> {
  const canEdit =
    Boolean(ctx.callbackQuery) &&
    // A reply keyboard can only arrive with a new message.
    (keyboard === undefined || isInlineKeyboard(keyboard));

  if (canEdit && ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
    const message = ctx.callbackQuery.message;
    if ('text' in message) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(isInlineKeyboard(keyboard) ? { reply_markup: keyboard.reply_markup } : {}),
        });
        return;
      } catch (error) {
        logger.debug({ err: error }, 'editMessageText failed, sending a new message');
      }
    } else {
      // A photo card cannot become a text message: strip its buttons instead.
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    }
  }

  await ctx.reply(text, buildExtra(keyboard));
}

/** Sends a fresh message even when the update came from a button. */
export async function send(ctx: BotContext, text: string, keyboard?: AnyKeyboard): Promise<void> {
  await ctx.reply(text, buildExtra(keyboard));
}

/** Answers a callback query, tolerating the "query is too old" case. */
export async function ack(ctx: BotContext, text?: string): Promise<void> {
  if (!ctx.callbackQuery) return;
  await ctx.answerCbQuery(text).catch(() => {});
}
