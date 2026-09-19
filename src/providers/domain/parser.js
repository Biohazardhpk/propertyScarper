import { landM2, parseNumber, parsePrice, walk } from '../shared.js';
import { ProviderParsingError } from '../../core/errors.js';

const unescapeHtml = (value) => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const stripHtml = (value) => typeof value === 'string' ? value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : value;

const propertyTypeMap = new Map([
  ['house', 'house'],
  ['apartmentunitflat', 'apartment'],
  ['newapartments', 'apartment'],
  ['townhouse', 'townhouse'],
  ['villa', 'villa'],
  ['vacantland', 'land'],
  ['acreagesemirural', 'acreage'],
  ['rural', 'acreage'],
  ['retirement', 'retirement'],
  ['blockofunits', 'block of units'],
  ['semidetached', 'semi detached'],
  ['studio', 'studio'],
  ['duplex', 'duplex'],
  ['terrace', 'terrace'],
]);

const normalizePropertyType = (value) => {
  const compact = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return propertyTypeMap.get(compact) ?? (String(value ?? '').toLowerCase() || undefined);
};

export function extractDomainState(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new ProviderParsingError('Domain page contained no __NEXT_DATA__ hydration state');
  try { return JSON.parse(unescapeHtml(match[1])); }
  catch (error) { throw new ProviderParsingError(`Domain hydration JSON was invalid: ${error.message}`); }
}

const addressText = (value) => first(value.address, value.displayAddress, value.address?.displayAddress, value.address?.streetAddress, value.propertyDetails?.displayableAddress);

const idFromUrl = (value) => String(value ?? '').match(/-(\d+)\/?(?:\?.*)?$/)?.[1];
const identifier = (value) => first(value?.value, value?.['@value'], value);

function looksLikeListing(value) {
  const id = first(value.listingId, value.id, identifier(value.identifier), value.listing?.id, idFromUrl(value.url));
  const address = addressText(value) ?? value.listing?.address;
  const feature = first(value.bedrooms, value.beds, value.numberOfBedrooms, value.features?.beds, value.propertyFeatures?.bedrooms, value.listing?.features?.beds);
  return Boolean(id && address && (feature != null || value.price || value.offers || value.priceDetails || value.listing));
}

export function mapDomainListing(input) {
  const x = input.listing ?? input;
  const details = x.propertyDetails ?? {};
  const address = x.addressParts ?? (typeof x.address === 'object' ? x.address : {});
  const features = x.features ?? x.propertyFeatures ?? x.listingSummary ?? {};
  const id = first(x.listingId, x.id, identifier(x.identifier), idFromUrl(x.url), idFromUrl(x.seoUrl));
  const slug = x.listingSlug ? `https://www.domain.com.au/${String(x.listingSlug).replace(/^\//, '')}` : undefined;
  const path = first(x.seoUrl, x.url, x.canonicalUrl, x.listingUrl, x._links?.canonical?.href, slug);
  const displayAddress = typeof x.address === 'string' ? x.address : first(x.displayAddress, address.displayAddress, address.fullAddress, details.displayableAddress, x.name);
  const suburb = first(x.suburb, address.suburb, address.addressLocality, details.suburb);
  const state = first(x.state, x.stateAbbreviation, address.state, address.stateAbbreviation, address.addressRegion, details.state);
  const postcode = first(x.postcode, address.postcode, address.postalCode, details.postcode);
  const street = first(x.streetAddress, address.streetAddress, [details.unitNumber && `${details.unitNumber}/`, details.streetNumber, details.street].filter(Boolean).join(' '), displayAddress?.split(',')[0]);
  const coordinates = first(x.geoLocation, x.geo, x.coordinates, x.map, details, x.latitude != null ? { latitude: x.latitude, longitude: x.longitude } : undefined);
  const priceText = first(x.price, x.priceText, x.offers?.price, x.priceDetails?.displayPrice, x.priceDetails?.price, x.listingSummary?.title);
  const parsedPrice = parsePrice(typeof priceText === 'string' ? priceText : priceText?.display);
  const price = x.priceValue != null && Number.isFinite(Number(x.priceValue)) ? { ...(parsedPrice ?? {}), display: parsedPrice?.display ?? String(x.priceValue), numeric: Number(x.priceValue) } : parsedPrice;
  const propertyFeatures = first(x.structuredFeatures, details.features, Array.isArray(x.propertyFeatures) ? x.propertyFeatures : undefined, features.features, []);
  const media = first(x.media, x.images, x.imageUrl, x.image, x.media?.images, []);
  const contacts = x.advertiser?.contacts ?? x.agents ?? [];
  const labels = Array.isArray(x.labels) ? x.labels.join(' ') : x.labels;

  return {
    source: 'domain',
    sourceListingId: String(id ?? ''),
    sourceUrl: path ? new URL(path, 'https://www.domain.com.au').href : (id ? `https://www.domain.com.au/${id}` : undefined),
    address: {
      fullAddress: displayAddress ?? [street, suburb, state, postcode].filter(Boolean).join(', '),
      street,
      suburb,
      state,
      postcode: postcode != null ? String(postcode) : undefined,
    },
    coordinates: coordinates && Number.isFinite(Number(coordinates.latitude)) ? { latitude: Number(coordinates.latitude), longitude: Number(coordinates.longitude) } : undefined,
    price,
    propertyType: normalizePropertyType(first(details.propertyType, x.propertyType, x.primaryPropertyType, x.propertyTypes?.[0], x['@type'])),
    bedrooms: parseNumber(first(details.bedrooms, x.bedrooms, x.beds, x.numberOfBedrooms, features.bedrooms, features.beds)),
    bathrooms: parseNumber(first(details.bathrooms, x.bathrooms, x.baths, x.numberOfBathroomsTotal, features.bathrooms, features.baths)),
    carspaces: parseNumber(first(details.carspaces, x.parkingSpaces, x.parking, x.carspaces, x.numberOfParkingSpaces, features.parking, features.carspaces)),
    landAreaM2: landM2(first(details.landArea, x.landAreaSqm, x.landArea, x.landSize, x.floorSize?.value, features.landArea, features.landSize)),
    buildingAreaM2: landM2(first(details.buildingArea, x.buildingAreaSqm, x.buildingArea, x.floorSize?.value, features.buildingArea)),
    headline: first(x.headline, x.headlineText, x.title, x.name),
    description: stripHtml(first(x.description, x.summaryDescription)),
    features: Array.isArray(propertyFeatures) ? propertyFeatures.map((feature) => feature?.name ?? feature).filter(Boolean) : String(propertyFeatures ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    imageUrls: (Array.isArray(media) ? media : [media]).filter((item) => !item?.category || /image/i.test(item.category)).map((item) => item?.url ?? item?.imageUrl ?? item).filter(Boolean),
    agent: { name: first(x.agent?.name, contacts[0]?.name, contacts[0]?.fullName), agency: first(x.advertiser?.name, x.agency?.name, x.agencyName) },
    listingStatus: first(x.status, x.listingStatus, x.label, labels, x.availability),
    isNewBuild: Boolean(x.isNewDevelopment || x.isNewBuild || /new development|off the plan/i.test(`${x.projectType ?? ''} ${details.propertyType ?? x.propertyType ?? ''}`)),
  };
}

function jsonLdDocuments(html) {
  const documents = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { documents.push(JSON.parse(unescapeHtml(match[1]))); } catch {}
  }
  return documents;
}

function listingCandidates(values) {
  const candidates = [];
  for (const value of values) for (const node of walk(value)) {
    if (looksLikeListing(node)) candidates.push(node);
    for (const key of ['listings', 'results', 'searchResults']) if (Array.isArray(node[key])) for (const item of node[key]) if (looksLikeListing(item)) candidates.push(item);
  }
  return candidates;
}

export function parseDomainHtml(html) {
  let state;
  try { state = extractDomainState(html); } catch (error) { if (!jsonLdDocuments(html).length) throw error; }
  const documents = [...(state ? [state] : []), ...jsonLdDocuments(html)];
  const candidates = listingCandidates(documents);
  const listings = [...new Map(candidates.map(mapDomainListing).filter((listing) => listing.sourceListingId).map((listing) => [listing.sourceListingId, listing])).values()];
  const nodes = documents.flatMap((document) => [...walk(document)]);
  const pagination = nodes.find((value) => (value?.pageSize || value?.pageInfo) && (value?.totalResults || value?.totalCount || value?.totalPages || value?.pageInfo?.totalPages)) ?? {};
  const total = pagination.totalResults ?? pagination.totalCount;
  const totalPages = pagination.totalPages ?? pagination.pageInfo?.totalPages ?? (total && pagination.pageSize ? Math.ceil(total / pagination.pageSize) : undefined);
  if (!listings.length && !/no properties|0 properties|no results/i.test(html)) throw new ProviderParsingError('Domain hydration contained no recognizable search listings');
  return { listings, totalPages, totalResults: total };
}

export function parseDomainListingHtml(html, url) {
  let state;
  try { state = extractDomainState(html); } catch {}
  const candidates = listingCandidates([...(state ? [state] : []), ...jsonLdDocuments(html)]).map(mapDomainListing).filter((listing) => listing.sourceListingId);
  const expectedId = idFromUrl(url);
  const listing = candidates.find((candidate) => candidate.sourceListingId === expectedId) ?? candidates.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  if (!listing) throw new ProviderParsingError('Domain listing page contained no recognizable structured listing data');
  return listing.sourceUrl ? listing : { ...listing, sourceUrl: url };
}
