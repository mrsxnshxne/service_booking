import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import type {
	Booking,
	Client,
	DiscountRule,
	Prisma,
	Rate,
} from "../../generated/prisma/client";
import { prisma } from "../db";
import { nbNights } from "../domain/dates";
import { DomainError } from "../domain/errors";
import { estimateStay } from "../domain/pricing";
import { gatewayAuth } from "../middleware/gateway-auth";
import { validate } from "../middleware/validate";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

type BookingWithRelations = Prisma.BookingGetPayload<{
	include: { client: true; property: true };
}>;
type BookingWithClient = Prisma.BookingGetPayload<{
	include: { client: true };
}>;

export const bookingsRouter = Router();

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

function serializeBooking(
	booking: BookingWithClient | (Booking & { client: Client | null }),
) {
	const total = Number(booking.total_amount);
	const deposit = Number(booking.deposit_amount);
	const checkIn = booking.check_in.toISOString().slice(0, 10);
	const checkOut = booking.check_out.toISOString().slice(0, 10);
	return {
		...booking,
		check_in: checkIn,
		check_out: checkOut,
		nb_nights: nbNights(checkIn, checkOut),
		total_amount: total,
		deposit_amount: deposit,
		balance_amount: Math.round((total - deposit) * 100) / 100,
	};
}

const bookingCreateSchema = z.object({
	property_id: z.string().uuid(),
	hold_slot_id: z.string().uuid(),
	check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
	nb_guests: z.number().int().positive(),
	client: z.object({
		last_name: z.string().min(1),
		first_name: z.string().min(1),
		email: z.string().email(),
		phone: z.string().optional(),
	}),
});

const bookingUpdateSchema = z.object({
	status: z.enum(["confirmed", "cancelled"]),
});

bookingsRouter.get("/", gatewayAuth, async (req, res) => {
	const page = Number(req.query.page ?? 1);
	const per_page = Number(req.query.per_page ?? 20);

	const managerProperties = await prisma.property.findMany({
		where: { user_id: req.managerId, deleted_at: null },
		select: { id: true },
	});
	const propertyIds = managerProperties.map((p) => p.id);

	const where: Record<string, unknown> = {
		property_id: { in: propertyIds },
	};
	if (req.query.property_id) where.property_id = req.query.property_id;
	if (req.query.status) where.status = req.query.status;
	if (req.query.start_date)
		where.check_in = { gte: new Date(req.query.start_date as string) };
	if (req.query.end_date)
		where.check_out = { lte: new Date(req.query.end_date as string) };

	const [data, total] = await Promise.all([
		prisma.booking.findMany({
			where,
			include: { client: true },
			skip: (page - 1) * per_page,
			take: per_page,
			orderBy: { created_at: "desc" },
		}),
		prisma.booking.count({ where }),
	]);

	res.json({ data: data.map(serializeBooking), total, page, per_page });
});

bookingsRouter.post(
	"/public",
	validate(bookingCreateSchema),
	async (req, res) => {
		const body = req.body as z.infer<typeof bookingCreateSchema>;

		const property = await prisma.property.findUnique({
			where: { id: body.property_id },
		});
		if (!property || property.deleted_at !== null || !property.active) {
			throw new DomainError("not_found", "Property not found");
		}

		const now = new Date();
		const hold = await prisma.holdSlot.findUnique({
			where: { id: body.hold_slot_id },
		});
		if (!hold || hold.property_id !== body.property_id) {
			res.status(409).json({
				code: "hold_slot_expired",
				message: "No valid hold slot found for these dates",
			});
			return;
		}
		if (hold.expires_at <= now) {
			res
				.status(409)
				.json({ code: "hold_slot_expired", message: "Hold slot has expired" });
			return;
		}
		if (
			hold.start_date.toISOString().slice(0, 10) !== body.check_in ||
			hold.end_date.toISOString().slice(0, 10) !== body.check_out
		) {
			res.status(409).json({
				code: "hold_slot_expired",
				message: "Hold slot dates do not match booking dates",
			});
			return;
		}

		const rates = await prisma.rate.findMany({
			where: { property_id: body.property_id },
			include: { discount_rules: true },
		});
		const estimate = estimateStay(
			rates.map(toRateInput),
			body.check_in,
			body.check_out,
		);

		let client = await prisma.client.findFirst({
			where: { email: body.client.email, deleted_at: null },
		});
		if (!client) {
			client = await prisma.client.create({
				data: {
					last_name: body.client.last_name,
					first_name: body.client.first_name,
					email: body.client.email,
					phone: body.client.phone ?? null,
				},
			});
		}

		const booking = await prisma.booking.create({
			data: {
				property_id: body.property_id,
				client_id: client.id,
				hold_slot_id: body.hold_slot_id,
				check_in: new Date(body.check_in),
				check_out: new Date(body.check_out),
				nb_guests: body.nb_guests,
				total_amount: estimate.total_amount,
				deposit_amount: estimate.deposit_amount,
				status: "pending",
				source: "direct",
			},
			include: { client: true },
		});
		res.status(201).json(serializeBooking(booking));
	},
);

bookingsRouter.get("/:id", gatewayAuth, async (req, res) => {
	const booking = (await prisma.booking.findUnique({
		where: { id: req.params.id as string },
		include: { client: true, property: true },
	})) as BookingWithRelations | null;
	if (!booking) throw new DomainError("not_found", "Booking not found");
	if (!booking.property || booking.property.user_id !== req.managerId) {
		throw new DomainError(
			"forbidden",
			"You do not have access to this booking",
		);
	}

	const { property: _p, ...rest } = booking;
	res.json(serializeBooking(rest));
});

bookingsRouter.patch(
	"/:id",
	gatewayAuth,
	validate(bookingUpdateSchema),
	async (req, res) => {
		const id = req.params.id as string;
		const booking = (await prisma.booking.findUnique({
			where: { id },
			include: { property: true },
		})) as
			| (BookingWithRelations & { property: { user_id: string } | null })
			| null;
		if (!booking) throw new DomainError("not_found", "Booking not found");
		if (!booking.property || booking.property.user_id !== req.managerId) {
			throw new DomainError(
				"forbidden",
				"You do not have access to this booking",
			);
		}

		const { status } = req.body as z.infer<typeof bookingUpdateSchema>;
		const updated = (await prisma.booking.update({
			where: { id },
			data: { status },
			include: { client: true },
		})) as BookingWithClient;
		res.json(serializeBooking(updated));
	},
);

const paymentCreateSchema = z.object({
	type: z.enum(["deposit", "balance", "full"]),
});

bookingsRouter.post(
	"/:id/payments",
	validate(paymentCreateSchema),
	async (req, res) => {
		const booking = await prisma.booking.findUnique({
			where: { id: req.params.id as string },
		});
		if (!booking) throw new DomainError("not_found", "Booking not found");
		if (booking.status === "cancelled" || booking.status === "refunded") {
			throw new DomainError(
				"invalid_payment_transition",
				"Cannot create a payment for a cancelled or refunded booking",
			);
		}

		const { type } = req.body as z.infer<typeof paymentCreateSchema>;

		const existing = await prisma.payment.findFirst({
			where: {
				booking_id: booking.id,
				type,
				status: { in: ["pending", "succeeded"] },
			},
		});
		if (existing)
			throw new DomainError(
				"payment_already_completed",
				"A payment of this type is already pending or succeeded",
			);

		const total = Number(booking.total_amount);
		const deposit = Number(booking.deposit_amount);
		const amount =
			type === "deposit"
				? deposit
				: type === "balance"
					? Math.round((total - deposit) * 100) / 100
					: total;

		const intent = await stripe.paymentIntents.create({
			amount: Math.round(amount * 100),
			currency: "eur",
			metadata: { booking_id: booking.id, payment_type: type },
		});

		const payment = await prisma.payment.create({
			data: {
				booking_id: booking.id,
				stripe_payment_intent_id: intent.id,
				amount,
				type,
				status: "pending",
			},
		});

		res.status(201).json({
			id: payment.id,
			client_secret: intent.client_secret,
			amount: Number(payment.amount),
			type: payment.type,
			status: payment.status,
		});
	},
);
