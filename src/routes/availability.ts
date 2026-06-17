import { Router } from "express";
import { z } from "zod";
import type {
	BlockedPeriod,
	DiscountRule,
	HoldSlot,
	Rate,
} from "../../generated/prisma/client";
import { prisma } from "../db";
import {
	canCreateHold,
	computeAvailability,
	removableManualBlocks,
} from "../domain/availability";
import { DomainError } from "../domain/errors";
import { estimateStay } from "../domain/pricing";
import { gatewayAuth } from "../middleware/gateway-auth";
import { validate } from "../middleware/validate";

export const availabilityRouter = Router({ mergeParams: true });
export const holdSlotsRouter = Router({ mergeParams: true });

function toPeriodInput(b: BlockedPeriod) {
	return {
		start_date: b.start_date.toISOString().slice(0, 10),
		end_date: b.end_date.toISOString().slice(0, 10),
		source: b.source as
			| "manual"
			| "ical_airbnb"
			| "ical_booking"
			| "booking_confirmed",
	};
}

function toHoldInput(h: HoldSlot) {
	return {
		start_date: h.start_date.toISOString().slice(0, 10),
		end_date: h.end_date.toISOString().slice(0, 10),
		expires_at: h.expires_at,
	};
}

function toRateInput(r: Rate & { discount_rules: DiscountRule[] }) {
	return {
		id: r.id,
		name: r.name,
		base_price_per_night: Number(r.base_price_per_night),
		start_date: r.start_date.toISOString().slice(0, 10),
		end_date: r.end_date.toISOString().slice(0, 10),
		is_high_season: r.is_high_season,
		discount_rules: r.discount_rules.map((d) => ({
			min_nights: d.min_nights,
			max_nights: d.max_nights,
			discount_percentage: Number(d.discount_percentage),
		})),
	};
}

const availabilityQuerySchema = z.object({
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

const availabilityPatchSchema = z.object({
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	blocked: z.boolean(),
	notes: z.string().optional(),
});

const estimateQuerySchema = z.object({
	check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

const holdSlotCreateSchema = z.object({
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

// ── GET /properties/:property_id/availability ──────────────────────────────
availabilityRouter.get("/", gatewayAuth, async (req, res) => {
	const { property_id } = req.params as { property_id: string };
	const query = availabilityQuerySchema.safeParse(req.query);
	if (!query.success) {
		const fields = query.error.issues.map((i) => ({
			field: i.path.join("."),
			message: i.message,
		}));
		res
			.status(422)
			.json({ code: "validation_error", message: "Validation failed", fields });
		return;
	}

	const property = await prisma.property.findUnique({
		where: { id: property_id },
	});
	if (!property || property.deleted_at !== null)
		throw new DomainError("not_found", "Property not found");
	if (property.user_id !== req.managerId)
		throw new DomainError(
			"forbidden",
			"You do not have access to this property",
		);

	const { start_date, end_date } = query.data;
	const [blocks, holds] = await Promise.all([
		prisma.blockedPeriod.findMany({ where: { property_id } }),
		prisma.holdSlot.findMany({ where: { property_id } }),
	]);

	res.json(
		computeAvailability(
			start_date,
			end_date,
			blocks.map(toPeriodInput),
			holds.map(toHoldInput),
		),
	);
});

// ── PATCH /properties/:property_id/availability ────────────────────────────
availabilityRouter.patch(
	"/",
	gatewayAuth,
	validate(availabilityPatchSchema),
	async (req, res) => {
		const { property_id } = req.params as { property_id: string };
		const property = await prisma.property.findUnique({
			where: { id: property_id },
		});
		if (!property || property.deleted_at !== null)
			throw new DomainError("not_found", "Property not found");
		if (property.user_id !== req.managerId)
			throw new DomainError(
				"forbidden",
				"You do not have access to this property",
			);

		const { start_date, end_date, blocked, notes } = req.body as z.infer<
			typeof availabilityPatchSchema
		>;

		if (blocked) {
			await prisma.blockedPeriod.create({
				data: {
					property_id,
					start_date: new Date(start_date),
					end_date: new Date(end_date),
					source: "manual",
					notes: notes ?? null,
				},
			});
		} else {
			const existing = await prisma.blockedPeriod.findMany({
				where: { property_id },
			});
			const toRemove = removableManualBlocks(
				start_date,
				end_date,
				existing.map(toPeriodInput),
			);
			const idsToRemove = existing
				.filter((b) =>
					toRemove.some(
						(r) =>
							r.start_date === b.start_date.toISOString().slice(0, 10) &&
							r.end_date === b.end_date.toISOString().slice(0, 10),
					),
				)
				.map((b) => b.id);

			if (idsToRemove.length > 0) {
				await prisma.blockedPeriod.deleteMany({
					where: { id: { in: idsToRemove } },
				});
			}
		}

		const [blocks, holds] = await Promise.all([
			prisma.blockedPeriod.findMany({ where: { property_id } }),
			prisma.holdSlot.findMany({ where: { property_id } }),
		]);
		res.json(
			computeAvailability(
				start_date,
				end_date,
				blocks.map(toPeriodInput),
				holds.map(toHoldInput),
			),
		);
	},
);

// ── GET /properties/:property_id/availability/estimate (public) ────────────
availabilityRouter.get("/estimate", async (req, res) => {
	const { property_id } = req.params as { property_id: string };
	const query = estimateQuerySchema.safeParse(req.query);
	if (!query.success) {
		const fields = query.error.issues.map((i) => ({
			field: i.path.join("."),
			message: i.message,
		}));
		res
			.status(422)
			.json({ code: "validation_error", message: "Validation failed", fields });
		return;
	}

	const property = await prisma.property.findUnique({
		where: { id: property_id },
	});
	if (!property || property.deleted_at !== null || !property.active) {
		throw new DomainError("not_found", "Property not found");
	}

	const rates = await prisma.rate.findMany({
		where: { property_id },
		include: { discount_rules: true },
	});

	const { check_in, check_out } = query.data;
	res.json(estimateStay(rates.map(toRateInput), check_in, check_out));
});

// ── POST /properties/:property_id/hold-slots (public) ─────────────────────
holdSlotsRouter.post("/", validate(holdSlotCreateSchema), async (req, res) => {
	const { property_id } = req.params as { property_id: string };
	const property = await prisma.property.findUnique({
		where: { id: property_id },
	});
	if (!property || property.deleted_at !== null || !property.active) {
		throw new DomainError("not_found", "Property not found");
	}

	const { start_date, end_date } = req.body as z.infer<
		typeof holdSlotCreateSchema
	>;
	const [blocks, holds] = await Promise.all([
		prisma.blockedPeriod.findMany({ where: { property_id } }),
		prisma.holdSlot.findMany({ where: { property_id } }),
	]);

	if (
		!canCreateHold(
			start_date,
			end_date,
			blocks.map(toPeriodInput),
			holds.map(toHoldInput),
		)
	) {
		res.status(409).json({
			code: "dates_not_available",
			message: "The requested dates are not available",
		});
		return;
	}

	const hold = await prisma.holdSlot.create({
		data: {
			property_id,
			start_date: new Date(start_date),
			end_date: new Date(end_date),
			expires_at: new Date(Date.now() + 15 * 60 * 1000),
		},
	});
	res.status(201).json(hold);
});

// ── DELETE /properties/:property_id/hold-slots/:hold_slot_id (public) ──────
holdSlotsRouter.delete("/:hold_slot_id", async (req, res) => {
	const { property_id, hold_slot_id } = req.params as {
		property_id: string;
		hold_slot_id: string;
	};
	const hold = await prisma.holdSlot.findUnique({
		where: { id: hold_slot_id },
	});
	if (!hold || hold.property_id !== property_id) {
		throw new DomainError("not_found", "Hold slot not found");
	}
	await prisma.holdSlot.delete({ where: { id: hold_slot_id } });
	res.status(204).send();
});
