import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ZodError } from "zod";

export function validate(schema: ZodSchema) {
	return (req: Request, res: Response, next: NextFunction) => {
		const result = schema.safeParse(req.body);
		if (!result.success) {
			const fields = result.error.issues.map((issue) => ({
				field: issue.path.join("."),
				message: issue.message,
			}));
			res.status(422).json({
				code: "validation_error",
				message: "Validation failed",
				fields,
			});
			return;
		}
		req.body = result.data;
		next();
	};
}

export function zodErrorToResponse(err: ZodError) {
	return {
		code: "validation_error",
		message: "Validation failed",
		fields: err.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		})),
	};
}
