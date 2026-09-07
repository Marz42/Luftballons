/**
 * Channel Basic dataset (IMPLEMENTATION §14).
 * Optional fields omit/undefined when unknown — never invent values (§15).
 */

export interface RecentVideoSnapshot {
  videoId?: string;
  title: string;
  publishedAt?: string;
  views: number;
  /** ISO-8601 timestamp string. */
  capturedAt: string;
}

export interface ChannelBasicData {
  channel: {
    channelId?: string;
    channelName: string;
  };
  period: {
    start?: string;
    end?: string;
    label?: string;
  };
  summary: {
    views?: number;
    subscriberDelta?: number;
  };
  recentVideos: RecentVideoSnapshot[];
}

export function isChannelBasicData(value: unknown): value is ChannelBasicData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data = value as ChannelBasicData;
  return (
    typeof data.channel === "object" &&
    data.channel !== null &&
    typeof data.channel.channelName === "string" &&
    typeof data.period === "object" &&
    data.period !== null &&
    typeof data.summary === "object" &&
    data.summary !== null &&
    Array.isArray(data.recentVideos)
  );
}
