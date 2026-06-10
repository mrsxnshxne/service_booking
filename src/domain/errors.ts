/**
 * Domain error with a machine-readable `code`, mapped by the HTTP layer to
 * the API `Error` shape `{ code, message }` (see docs/openapi.yaml).
 */
export class DomainError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "DomainError";
	}
}
