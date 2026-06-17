/**
 * Date helpers. All dates are ISO `YYYY-MM-DD` strings, compared lexically.
 * All ranges in the domain are end-exclusive: [start_date, end_date).
 * A stay of check_in 2026-07-01 / check_out 2026-07-03 occupies the nights
 * of 07-01 and 07-02; 07-03 is free for the next arrival.
 */
import { DomainError } from "./errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

export function assertIsoDate(value: string): void {
	if (!isIsoDate(value)) {
		throw new DomainError("invalid_date", `Invalid ISO date: ${value}`);
	}
}

export function addDays(date: string, days: number): string {
	assertIsoDate(date);
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const next = new Date(Date.UTC(y, m - 1, d + days));
	return next.toISOString().slice(0, 10);
}

/** Number of nights between check-in and check-out. Throws if the range is empty or inverted. */
export function nbNights(checkIn: string, checkOut: string): number {
	assertIsoDate(checkIn);
	assertIsoDate(checkOut);
	if (checkOut <= checkIn) {
		throw new DomainError(
			"invalid_date_range",
			`check_out (${checkOut}) must be after check_in (${checkIn})`,
		);
	}
	const ms =
		Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
	return Math.round(ms / 86_400_000);
}

/** Every night of a stay: [checkIn, checkOut) as individual dates. */
export function eachNight(checkIn: string, checkOut: string): string[] {
	const count = nbNights(checkIn, checkOut);
	const nights: string[] = [];
	let current = checkIn;
	for (let i = 0; i < count; i++) {
		nights.push(current);
		current = addDays(current, 1);
	}
	return nights;
}

/** End-exclusive range overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. */
export function overlaps(
	aStart: string,
	aEnd: string,
	bStart: string,
	bEnd: string,
): boolean {
	return aStart < bEnd && bStart < aEnd;
}
