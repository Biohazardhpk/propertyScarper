const scalar = (value) => {
  const s = value.trim();
  if (!s) return undefined;
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s.replace(/^['"]|['"]$/g, '');
};
/** Small, dependency-free YAML subset for criteria files: mappings, indented lists, and inline lists. */
export function parseCriteriaYaml(source) {
  const root = {}; let section = null; let nested = null;
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length; const line = raw.trim();
    if (line.startsWith('- ')) {
      if (!section) throw new Error('YAML list without a key');
      const target = nested ? root[section][nested] : root[section];
      if (!Array.isArray(target)) { if (nested) root[section][nested] = []; else root[section] = []; }
      (nested ? root[section][nested] : root[section]).push(scalar(line.slice(2))); continue;
    }
    const match = line.match(/^([\w-]+):(?:\s*(.*))?$/); if (!match) throw new Error(`Unsupported YAML: ${line}`);
    const [, key, value] = match;
    if (indent === 0) { section = key; nested = null; root[key] = value ? scalar(value) : {}; }
    else { if (!section || typeof root[section] !== 'object' || Array.isArray(root[section])) throw new Error(`Invalid nested key: ${key}`); nested = key; root[section][key] = value ? scalar(value) : []; }
  }
  const c = { locations: root.locations, transactionType: root.transaction_type, minPrice: root.price?.min, maxPrice: root.price?.max, propertyTypes: root.property?.types, minBedrooms: root.property?.bedrooms_min, minBathrooms: root.property?.bathrooms_min, minCarspaces: root.property?.carspaces_min, minLandAreaM2: root.property?.land_min_m2, maxLandAreaM2: root.property?.land_max_m2, establishedOnly: root.property?.established_only, preferredMinLandAreaM2: root.preferences?.land_min_m2, includeSurroundingSuburbs: root.include_surrounding_suburbs, excludeUnderContract: root.exclude_under_contract, keywords: root.keywords?.any, excludeKeywords: root.exclude_keywords, strictKeywordMatch: root.strict_keyword_match, sort: root.sort?.by };
  if (!Array.isArray(c.locations) || !c.locations.length) throw new Error('locations must be a non-empty list');
  if (!['buy', 'rent', 'auction', 'sold'].includes(c.transactionType)) throw new Error('transaction_type must be buy, rent, auction, or sold');
  return c;
}
