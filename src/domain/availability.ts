/**
 * Availability — computed view, never stored (spec).
 * A day is blocked when covered by a BlockedPeriod or a non-expired HoldSlot.
 * All ranges are end-exclusive: [start_date, end_date).
 */
import { eachNight, overlaps } from "./dates";

export type BlockSource =
	| "manual"
	| "ical_airbnb"
	| "ical_booking"
	| "booking_confirmed";

export interface BlockedPeriodInput {
	start_date: string;
	end_date: string;
	source: BlockSource;
}

export interface HoldSlotInput {
	start_date: string;
	end_date: string;
	expires_at: string | Date;
}

export interface DayAvailability {
	date: string;
	blocked: boolean;
	/** Origin of the block; null when free or when blocked by a hold slot (holds have no BlockSource). */
	source: BlockSource | null;
}

export function isHoldActive(hold: HoldSlotInput, now: Date): boolean {
	return new Date(hold.expires_at).getTime() > now.getTime();
}

/**
 * Daily availability over [startDate, endDate).
 * BlockedPeriods take precedence over holds for the reported `source`.
 */
export function computeAvailability(
	startDate: string,
	endDate: string,
	blocks: BlockedPeriodInput[],
	holds: HoldSlotInput[],
	now: Date = new Date(),
): DayAvailability[] {
	const activeHolds = holds.filter((h) => isHoldActive(h, now));
	return eachNight(startDate, endDate).map((date) => {
		const block = blocks.find(
			(b) => b.start_date <= date && date < b.end_date,
		);
		if (block) return { date, blocked: true, source: block.source };
		const held = activeHolds.some(
			(h) => h.start_date <= date && date < h.end_date,
		);
		return { date, blocked: held, source: null };
	});
}

/**
 * Hold-slot creation rule (POST /hold-slots): the dates must be free of any
 * BlockedPeriod and any active HoldSlot. Violation → HTTP 409.
 */
export function canCreateHold(
	startDate: string,
	endDate: string,
	blocks: BlockedPeriodInput[],
	holds: HoldSlotInput[],
	now: Date = new Date(),
): boolean {
	const blockConflict = blocks.some((b) =>
		overlaps(startDate, endDate, b.start_date, b.end_date),
	);
	if (blockConflict) return false;
	return !holds.some(
		(h) =>
			isHoldActive(h, now) &&
			overlaps(startDate, endDate, h.start_date, h.end_date),
	);
}

/**
 * PATCH /availability with blocked:false only removes manual blocks (spec:
 * blocks from bookings or iCal feeds cannot be removed via this route).
 * Returns the blocks that should be deleted.
 */
export function removableManualBlocks<T extends BlockedPeriodInput>(
	startDate: string,
	endDate: string,
	blocks: T[],
): T[] {
	return blocks.filter(
		(b) =>
			b.source === "manual" &&
			overlaps(startDate, endDate, b.start_date, b.end_date),
	);
}
