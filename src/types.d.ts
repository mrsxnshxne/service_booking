declare global {
	namespace Express {
		interface Request {
			/** Manager id forwarded by the gateway (X-Manager-Id), set by gatewayAuth. */
			managerId: string;
		}
	}
}

export type {};
