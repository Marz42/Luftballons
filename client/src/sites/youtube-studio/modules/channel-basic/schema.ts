/**
 * Re-export P1 Channel Basic schema (IMPLEMENTATION §14).
 * Module-local path must not diverge from schemas/channel-basic.ts.
 */

export type {
  ChannelBasicData,
  RecentVideoSnapshot,
} from "../../../../schemas/channel-basic.js";
export { isChannelBasicData } from "../../../../schemas/channel-basic.js";
