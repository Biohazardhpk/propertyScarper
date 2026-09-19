const text = (l) => [l.headline, l.description, ...(l.features ?? [])].filter(Boolean).join(' ').toLowerCase();
const underContract = (l) => /under contract|under offer|sold subject/i.test(l.listingStatus ?? '');
const propertyTypeAliases = new Map([
  ['house', 'house'],
  ['apartment', 'apartment'],
  ['apartmentunitflat', 'apartment'],
  ['newapartments', 'apartment'],
  ['unit', 'apartment'],
  ['flat', 'apartment'],
  ['townhouse', 'townhouse'],
  ['villa', 'villa'],
  ['land', 'land'],
  ['vacantland', 'land'],
  ['acreage', 'acreage'],
  ['acreagesemirural', 'acreage'],
  ['rural', 'acreage'],
  ['retirement', 'retirement'],
  ['retire', 'retirement'],
  ['blockofunits', 'block of units'],
  ['unitblock', 'block of units'],
  ['semidetached', 'semi detached'],
  ['studio', 'studio'],
  ['duplex', 'duplex'],
  ['terrace', 'terrace'],
]);
const canonicalPropertyType = (value) => {
  const textValue = String(value ?? '').toLowerCase();
  return propertyTypeAliases.get(textValue.replace(/[^a-z]/g, '')) ?? textValue;
};
export function enrichAndFilter(listings, c) {
  return listings.map((listing) => ({ ...listing, matchedKeywords: (c.keywords ?? []).filter((word) => text(listing).includes(word.toLowerCase())) })).filter((l) => {
    const haystack = text(l);
    if ((c.excludeKeywords ?? []).some((word) => haystack.includes(word.toLowerCase()))) return false;
    if (c.strictKeywordMatch && (c.keywords?.length ?? 0) && !l.matchedKeywords.length) return false;
    if (c.excludeUnderContract && underContract(l)) return false;
    if (c.establishedOnly && l.isNewBuild === true) return false;
    const low = l.price?.min ?? l.price?.numeric; const high = l.price?.max ?? l.price?.numeric;
    if (c.minPrice != null && (high == null || high < c.minPrice)) return false;
    if (c.maxPrice != null && (low == null || low > c.maxPrice)) return false;
    if (c.propertyTypes?.length && (!l.propertyType || !c.propertyTypes.map(canonicalPropertyType).includes(canonicalPropertyType(l.propertyType)))) return false;
    for (const [criterion, field] of [[c.minBedrooms, 'bedrooms'], [c.minBathrooms, 'bathrooms'], [c.minCarspaces, 'carspaces'], [c.minLandAreaM2, 'landAreaM2']]) if (criterion && (l[field] ?? 0) < criterion) return false;
    if (c.maxLandAreaM2 && l.landAreaM2 && l.landAreaM2 > c.maxLandAreaM2) return false;
    return true;
  });
}
