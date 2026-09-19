import { rankingWeights as w } from '../config/ranking.js';
export function rank(properties, c) {
  return properties.map((p) => {
    const l = p.listings[0]; let score = 0; const reasons = [];
    const landPreference = c.preferredMinLandAreaM2 ?? c.minLandAreaM2;
    if (landPreference && (p.landAreaM2 ?? 0) >= landPreference) { score += w.landMinimum; reasons.push(`${p.landAreaM2}m² ${c.preferredMinLandAreaM2 != null ? 'preferred land' : 'land'}`); if (p.landAreaM2 >= landPreference * 1.2) score += w.landSignificantlyExceeds; }
    if (c.minBedrooms && (p.bedrooms ?? 0) > c.minBedrooms) { score += w.bedroomsExceed; reasons.push(`${p.bedrooms} bedrooms`); }
    if (c.minCarspaces && (p.carspaces ?? 0) > c.minCarspaces) { score += w.carspacesExceed; reasons.push(`${p.carspaces} car spaces`); }
    const keywords = [...new Set(p.listings.flatMap((x) => x.matchedKeywords ?? []))]; if (keywords.length) { score += w.firstKeyword + (keywords.length - 1) * w.additionalKeyword; reasons.push(...keywords.map((x) => `matched keyword: ${x}`)); }
    if (new Set(p.listings.map((x) => x.source)).size > 1) { score += w.multipleSources; reasons.push('listed on REA and Domain'); }
    return { ...p, score, scoreReasons: reasons, matchedKeywords: keywords, price: l.price };
  }).sort((a, b) => b.score - a.score);
}
