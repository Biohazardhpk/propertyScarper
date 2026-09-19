const slug = (location) => location.trim().toLowerCase().replace(/,?\s+/g, '+');
export function reaSearchUrl(c, location, page = 1) {
  const parts = []; if (c.propertyTypes?.length) parts.push(`property-${c.propertyTypes.map((x) => x.toLowerCase()).join('-')}`);
  const attributes = []; if (c.minBedrooms != null) attributes.push(`${c.minBedrooms}-bedrooms`); if (c.minBathrooms != null) attributes.push(`${c.minBathrooms}-bathrooms`); if (c.minCarspaces != null) attributes.push(`${c.minCarspaces}-car-space`); if (attributes.length) parts.push(`with-${attributes.join('-')}`);
  if (c.minPrice != null || c.maxPrice != null) parts.push(`between-${c.minPrice ?? 0}-${c.maxPrice ?? 'any'}`); if (c.minLandAreaM2 != null) parts.push(`size-${c.minLandAreaM2}-${c.maxLandAreaM2 ?? 'any'}`); parts.push(`in-${slug(location)}`);
  const query = new URLSearchParams(); if (c.excludeUnderContract) query.set('misc', 'ex-under-contract'); if (c.sort === 'newest' || c.transactionType === 'sold') query.set('activeSort', c.transactionType === 'sold' ? 'solddate' : 'list-date');
  return `https://www.realestate.com.au/${c.transactionType}/${parts.join('-')}/list-${Math.max(1, page)}${query.size ? `?${query}` : ''}`;
}
