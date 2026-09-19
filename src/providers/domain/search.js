const slug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const propertyTypes = new Map([
  ['house', 'house'],
  ['apartment', 'apartment-unit-flat'],
  ['unit', 'apartment-unit-flat'],
  ['flat', 'apartment-unit-flat'],
  ['townhouse', 'town-house'],
  ['villa', 'villa'],
  ['land', 'vacant-land'],
  ['acreage', 'acreage-semi-rural'],
  ['rural', 'acreage-semi-rural'],
  ['retirement', 'retirement'],
  ['retire', 'retirement'],
  ['block of units', 'block-of-units'],
  ['unitblock', 'block-of-units'],
  ['semi detached', 'semi-detached'],
  ['semidetached', 'semi-detached'],
  ['new apartments', 'new-apartments'],
  ['studio', 'studio'],
  ['duplex', 'duplex'],
  ['terrace', 'terrace'],
]);

export function domainSearchUrl(criteria, location, page = 1) {
  const channel = criteria.transactionType === 'buy' ? 'sale' : criteria.transactionType === 'sold' ? 'sold-listings' : 'rent';
  const query = new URLSearchParams();
  if (page > 1) query.set('page', String(page));
  if (criteria.minPrice != null || criteria.maxPrice != null) query.set('price', `${criteria.minPrice ?? 0}-${criteria.maxPrice ?? 'any'}`);
  if (criteria.minBedrooms != null) query.set('bedrooms', `${criteria.minBedrooms}-any`);
  if (criteria.minBathrooms != null) query.set('bathrooms', `${criteria.minBathrooms}-any`);
  if (criteria.minCarspaces != null) query.set('carspaces', `${criteria.minCarspaces}-any`);
  if (criteria.minLandAreaM2 != null || criteria.maxLandAreaM2 != null) query.set('landsize', `${criteria.minLandAreaM2 ?? 0}-${criteria.maxLandAreaM2 ?? 'any'}`);
  if (criteria.propertyTypes?.length) query.set('ptype', [...new Set(criteria.propertyTypes.map((type) => propertyTypes.get(String(type).toLowerCase()) ?? slug(String(type))))].join(','));
  if (criteria.includeSurroundingSuburbs) query.set('ssubs', '1');
  if (criteria.excludeUnderContract) query.set('excludeunderoffer', '1');
  if (criteria.sort === 'newest') query.set('sort', 'dateupdated-desc');
  return `https://www.domain.com.au/${channel}/${slug(location)}/?${query}`;
}
