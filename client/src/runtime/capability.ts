export type Capability =
  | "READ"
  | "NAVIGATE"
  | "WRITE_REVERSIBLE"
  | "WRITE_COMMIT"
  | "NETWORK_SEND"
  | "LOCAL_EXPORT";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "READ",
  "NAVIGATE",
  "WRITE_REVERSIBLE",
  "WRITE_COMMIT",
  "NETWORK_SEND",
  "LOCAL_EXPORT",
] as const;

export function isCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}
