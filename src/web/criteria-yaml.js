const quote = (value) => {
  const text = String(value ?? '').trim();
  return /[:#\[\]{},]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
};

const list = (values, indent = '') => (values ?? []).filter(Boolean).map((value) => `${indent}- ${quote(value)}`).join('\n');
const number = (value) => value === '' || value == null ? undefined : Number(value);
const words = (value) => Array.isArray(value) ? value : String(value ?? '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);

export function formToCriteria(form) {
  return {
    locations: words(form.locations),
    transactionType: form.transactionType,
    includeSurroundingSuburbs: Boolean(form.includeSurroundingSuburbs),
    minPrice: number(form.minPrice), maxPrice: number(form.maxPrice),
    propertyTypes: words(form.propertyTypes), minBedrooms: number(form.minBedrooms), minBathrooms: number(form.minBathrooms),
    minCarspaces: number(form.minCarspaces), minLandAreaM2: number(form.minLandAreaM2), maxLandAreaM2: number(form.maxLandAreaM2), preferredMinLandAreaM2: number(form.preferredMinLandAreaM2),
    establishedOnly: Boolean(form.establishedOnly), keywords: words(form.keywords), excludeKeywords: words(form.excludeKeywords),
    strictKeywordMatch: Boolean(form.strictKeywordMatch), excludeUnderContract: Boolean(form.excludeUnderContract), sort: form.sort || undefined,
  };
}

export function criteriaToForm(criteria) {
  return {
    locations: (criteria.locations ?? []).join('\n'), transactionType: criteria.transactionType ?? 'buy', includeSurroundingSuburbs: Boolean(criteria.includeSurroundingSuburbs),
    minPrice: criteria.minPrice ?? '', maxPrice: criteria.maxPrice ?? '', propertyTypes: (criteria.propertyTypes ?? []).join('\n'),
    minBedrooms: criteria.minBedrooms ?? '', minBathrooms: criteria.minBathrooms ?? '', minCarspaces: criteria.minCarspaces ?? '', minLandAreaM2: criteria.minLandAreaM2 ?? '', maxLandAreaM2: criteria.maxLandAreaM2 ?? '', preferredMinLandAreaM2: criteria.preferredMinLandAreaM2 ?? '', establishedOnly: Boolean(criteria.establishedOnly),
    keywords: (criteria.keywords ?? []).join('\n'), excludeKeywords: (criteria.excludeKeywords ?? []).join('\n'), strictKeywordMatch: Boolean(criteria.strictKeywordMatch),
    excludeUnderContract: Boolean(criteria.excludeUnderContract), sort: criteria.sort ?? 'newest',
  };
}

export function criteriaToYaml(criteria) {
  const lines = [`locations:`, list(criteria.locations).replace(/^/gm, '  '), '', `transaction_type: ${criteria.transactionType}`];
  if (criteria.includeSurroundingSuburbs) lines.push('', 'include_surrounding_suburbs: true');
  const price = [['min', criteria.minPrice], ['max', criteria.maxPrice]].filter(([, value]) => value != null);
  if (price.length) lines.push('', 'price:', ...price.map(([key, value]) => `  ${key}: ${value}`));
  const property = [['types', criteria.propertyTypes?.length ? criteria.propertyTypes : undefined], ['bedrooms_min', criteria.minBedrooms], ['bathrooms_min', criteria.minBathrooms], ['carspaces_min', criteria.minCarspaces], ['land_min_m2', criteria.minLandAreaM2], ['land_max_m2', criteria.maxLandAreaM2], ['established_only', criteria.establishedOnly ? true : undefined]].filter(([, value]) => value != null);
  if (property.length) lines.push('', 'property:', ...property.flatMap(([key, value]) => Array.isArray(value) ? [`  ${key}:`, list(value, '    ')] : `  ${key}: ${value}`));
  if (criteria.preferredMinLandAreaM2 != null) lines.push('', 'preferences:', `  land_min_m2: ${criteria.preferredMinLandAreaM2}`);
  if (criteria.keywords?.length) lines.push('', 'keywords:', '  any:', list(criteria.keywords, '    '));
  if (criteria.excludeKeywords?.length) lines.push('', 'exclude_keywords:', list(criteria.excludeKeywords, '  '));
  if (criteria.strictKeywordMatch) lines.push('', 'strict_keyword_match: true');
  if (criteria.excludeUnderContract) lines.push('', 'exclude_under_contract: true');
  if (criteria.sort) lines.push('', 'sort:', `  by: ${criteria.sort}`);
  return `${lines.filter((line, index) => line !== undefined && !(line === '' && lines[index - 1] === '')).join('\n').replace(/\n+$/, '')}\n`;
}
