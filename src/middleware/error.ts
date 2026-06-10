import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"
import { DomainError } from "../domain/errors"

const DOMAIN_STATUS: Record<string, number> = {
	not_found: 404,
	forbidden: 403,
	dates_not_available: 409,
	booking_conflict: 409,
	hold_slot_expired: 409,
	invalid_payment_transition: 409,
	no_applicable_rate: 422,
	rate_overlap: 422,
	invalid_date: 422,
	invalid_date_range: 422,
	validation_error: 422,
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
	if (err instanceof DomainError) {
		const status = DOMAIN_STATUS[err.code] ?? 500
		res.status(status).json({ code: err.code, message: err.message })
		return
	}

	if (err instanceof ZodError) {
		res.status(422).json({
			code: "validation_error",
			message: "Validation failed",
			fields: err.issues.map((issue) => ({
				field: issue.path.join("."),
				message: issue.message,
			})),
		})
		return
	}

	console.error(err)
	res.status(500).json({ code: "internal_error", message: "An unexpected error occurred" })
}
