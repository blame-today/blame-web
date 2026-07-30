// The relay set and the tag every blame.today event carries. Split into its own leaf module (no
// relative imports) so scripts/daily-blame.mjs can import it directly under node's TS type
// stripping and speak to the SAME relays under the SAME tag as the app. The machine cron this
// replaced kept its own copy of both, which is exactly the drift worth designing out. (#28)
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
];

export const TAG = 'pureblameapp';
