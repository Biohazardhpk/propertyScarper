/** @typedef {'buy'|'rent'|'sold'} TransactionType */
/** @typedef {{locations:string[], transactionType:TransactionType, minPrice?:number, maxPrice?:number, propertyTypes?:string[], minBedrooms?:number, minBathrooms?:number, minCarspaces?:number, minLandAreaM2?:number, maxLandAreaM2?:number, establishedOnly?:boolean, preferredMinLandAreaM2?:number, includeSurroundingSuburbs?:boolean, excludeUnderContract?:boolean, keywords?:string[], excludeKeywords?:string[], strictKeywordMatch?:boolean, sort?:string}} PropertySearchCriteria */
/** Providers return this portable listing shape; their untouched payload belongs in raw. */
export const providerNames = ['rea', 'domain'];
