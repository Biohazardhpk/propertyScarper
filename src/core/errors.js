export class ProviderError extends Error { constructor(message, code = 'UNAVAILABLE') { super(message); this.name = 'ProviderError'; this.code = code; } }
export class ProviderUnavailableError extends ProviderError { constructor(message) { super(message, 'UNAVAILABLE'); } }
export class ProviderBlockedError extends ProviderError { constructor(message) { super(message, 'BLOCKED'); } }
export class ProviderTimeoutError extends ProviderError { constructor(message) { super(message, 'TIMEOUT'); } }
export class ProviderParsingError extends ProviderError { constructor(message) { super(message, 'PARSING'); } }
export class AuthenticationRequiredError extends ProviderError { constructor(message) { super(message, 'AUTHENTICATION_REQUIRED'); } }
