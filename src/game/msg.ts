import type { MsgKey } from '../i18n/en';

/**
 * A translatable message: dictionary key plus params. The simulation stores
 * these instead of text, so the log and failure reasons render in whatever
 * language the player picks later. Plain JSON, safe to keep in saves.
 */
export interface Msg {
  key: MsgKey;
  params?: MsgParams;
}

/** A list of messages renders comma-separated. */
export type MsgParam = string | number | Msg | Msg[];
export type MsgParams = Record<string, MsgParam>;

export function msg(key: MsgKey, params?: MsgParams): Msg {
  return params ? { key, params } : { key };
}
