import type { NextFunction, Request, Response } from "express";

/**
 * The gateway authenticates the manager (better-auth) and forwards their id
 * via X-Manager-Id. This service must only be reachable from the gateway
 * (localhost / internal docker network) — it trusts this header.
 */
export function gatewayAuth(req: Request, res: Response, next: NextFunction) {
	const managerId = req.header("x-manager-id");
	if (!managerId) {
		res
			.status(401)
			.json({ code: "unauthorized", message: "Authentication required" });
		return;
	}
	req.managerId = managerId;
	next();
}
