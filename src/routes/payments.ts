import type { Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "../db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function webhookHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const sig = req.headers["stripe-signature"];
	if (!sig) {
		res.status(400).json({ message: "Missing stripe-signature header" });
		return;
	}

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			req.body as Buffer,
			sig,
			process.env.STRIPE_WEBHOOK_SECRET ?? "",
		);
	} catch {
		res.status(400).json({ message: "Webhook signature verification failed" });
		return;
	}

	if (event.type === "payment_intent.succeeded") {
		await onPaymentSucceeded(event.data.object);
	} else if (event.type === "payment_intent.payment_failed") {
		await onPaymentFailed(event.data.object);
	}

	res.json({ received: true });
}

async function onPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
	const payment = await prisma.payment.findFirst({
		where: { stripe_payment_intent_id: intent.id },
	});
	if (!payment) return;

	await prisma.payment.update({
		where: { id: payment.id },
		data: { status: "succeeded" },
	});

	if (payment.type === "deposit" || payment.type === "full") {
		await prisma.booking.update({
			where: { id: payment.booking_id },
			data: { status: "confirmed" },
		});
	}
}

async function onPaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
	const payment = await prisma.payment.findFirst({
		where: { stripe_payment_intent_id: intent.id },
	});
	if (!payment) return;

	await prisma.payment.update({
		where: { id: payment.id },
		data: { status: "failed" },
	});
}
