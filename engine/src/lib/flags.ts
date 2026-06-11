const REGIONAL_BASE = 0x1f1e6;

/** ISO 3166-1 alpha-2 → regional indicator flag emoji */
export function countryCodeToEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '';
  return String.fromCodePoint(
    REGIONAL_BASE + upper.charCodeAt(0) - 65,
    REGIONAL_BASE + upper.charCodeAt(1) - 65,
  );
}

/** Unicode tag-sequence subdivision flags */
export const TAG_FLAGS = {
  ENGLAND: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  SCOTLAND: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
} as const;

/** Team name → ISO country code (or null for tag-sequence flags) */
export const TEAM_COUNTRY_CODES: Record<string, string | null> = {
  Spain: 'ES',
  Argentina: 'AR',
  France: 'FR',
  England: null,
  Brazil: 'BR',
  Portugal: 'PT',
  Colombia: 'CO',
  Netherlands: 'NL',
  Ecuador: 'EC',
  Croatia: 'HR',
  Germany: 'DE',
  Norway: 'NO',
  Japan: 'JP',
  Turkey: 'TR',
  Switzerland: 'CH',
  Uruguay: 'UY',
  Senegal: 'SN',
  Mexico: 'MX',
  Belgium: 'BE',
  Paraguay: 'PY',
  Austria: 'AT',
  Morocco: 'MA',
  Canada: 'CA',
  Australia: 'AU',
  Scotland: null,
  Iran: 'IR',
  'South Korea': 'KR',
  Algeria: 'DZ',
  Panama: 'PA',
  Czechia: 'CZ',
  Uzbekistan: 'UZ',
  'United States': 'US',
  Sweden: 'SE',
  Egypt: 'EG',
  Jordan: 'JO',
  'Ivory Coast': 'CI',
  'DR Congo': 'CD',
  Tunisia: 'TN',
  Iraq: 'IQ',
  'Bosnia and Herzegovina': 'BA',
  'New Zealand': 'NZ',
  'Saudi Arabia': 'SA',
  'Cape Verde': 'CV',
  Haiti: 'HT',
  'South Africa': 'ZA',
  Ghana: 'GH',
  Curaçao: 'CW',
  Qatar: 'QA',
};

export function flagForTeamName(name: string): string {
  if (name === 'England') return TAG_FLAGS.ENGLAND;
  if (name === 'Scotland') return TAG_FLAGS.SCOTLAND;
  const code = TEAM_COUNTRY_CODES[name];
  return code ? countryCodeToEmoji(code) : '';
}

/** CSV fixture names → teams.csv names */
export const TEAM_ALIASES: Record<string, string> = {
  'Czech Republic': 'Czechia',
  USA: 'United States',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  Turkey: 'Turkey',
  Türkiye: 'Turkey',
};

export function normalizeTeamName(name: string): string {
  return TEAM_ALIASES[name] ?? name;
}
