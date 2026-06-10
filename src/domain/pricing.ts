/**
 * Tarification — pure pricing logic behind GET /properties/{id}/availability/estimate.
 *
 * Spec rules (docs/openapi.yaml):
 * - The price of each night comes from the rate covering that night;
 *   a high-season rate takes priority over a base rate on overlapping nights.
 * - Two non-high-season rates must never overlap (validated at rate creation,
 *   `assertNoBaseRateOverlap`).
 * - Discount: the rule whose [min_nights, max_nights] range covers the stay
 *   length applies; max_nights null = open-ended; if several rules cover,
 *   the most favourable for the client wins.
 * - deposit_amount equals total_amount when no split payment is configured.
 *
 * Amounts are plain numbers rounded to cents here; the persistence layer
 * stores Prisma Decimals.
 */
import { eachNight, nbNights, overlaps } from "./dates";
import { DomainError } from "./errors";

export interface RateInput {
	id: string;
	name: string;
	base_price_per_night: number;
	/** inclusive first night */
	start_date: string;
	/** exclusive end: first night NOT covered */
	end_date: string;
	is_high_season: boolean;
	discount_rules?: DiscountRuleInput[];
}

export interface DiscountRuleInput {
	min_nights: number;
	max_nights: number | null;
	discount_percentage: number;
}

export interface PriceEstimate {
	check_in: string;
	check_out: string;
	nb_nights: number;
	base_amount: number;
	discount_percentage: number;
	total_amount: number;
	deposit_amount: number;
}

export function round2(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rate applicable to one night: high season wins over base rates. */
export function rateForNight(rates: RateInput[], night: string): RateInput | undefined {
	const covering = rates.filter(
		(r) => r.start_date <= night && night < r.end_date,
	);
	return covering.find((r) => r.is_high_season) ?? covering[0];
}

/**
 * Discount rule covering `nights`, most favourable first.
 * Returns undefined when no rule applies.
 */
export function selectDiscount(
	rules: DiscountRuleInput[],
	nights: number,
): DiscountRuleInput | undefined {
	return rules
		.filter(
			(r) =>
				nights >= r.min_nights &&
				(r.max_nights === null || nights <= r.max_nights),
		)
		.sort((a, b) => b.discount_percentage - a.discount_percentage)[0];
}

export interface EstimateOptions {
	/** Manager split-payment config: percentage of total due upfront (e.g. 30). Null/undefined = no split. */
	depositPercentage?: number | null;
}

export function estimateStay(
	rates: RateInput[],
	checkIn: string,
	checkOut: string,
	options: EstimateOptions = {},
): PriceEstimate {
	const nights = nbNights(checkIn, checkOut);

	let baseAmount = 0;
	const ratesUsed = new Map<string, RateInput>();
	for (const night of eachNight(checkIn, checkOut)) {
		const rate = rateForNight(rates, night);
		if (!rate) {
			throw new DomainError(
				"no_applicable_rate",
				`No rate covers the night of ${night}`,
			);
		}
		baseAmount += rate.base_price_per_night;
		ratesUsed.set(rate.id, rate);
	}
	baseAmount = round2(baseAmount);

	// Discount rules of every rate used during the stay are candidates;
	// the most favourable covering rule wins.
	const candidateRules = [...ratesUsed.values()].flatMap(
		(r) => r.discount_rules ?? [],
	);
	const discount = selectDiscount(candidateRules, nights);
	const discountPercentage = discount?.discount_percentage ?? 0;

	const totalAmount = round2(baseAmount * (1 - discountPercentage / 100));
	const depositAmount =
		options.depositPercentage != null
			? round2(totalAmount * (options.depositPercentage / 100))
			: totalAmount;

	return {
		check_in: checkIn,
		check_out: checkOut,
		nb_nights: nights,
		base_amount: baseAmount,
		discount_percentage: discountPercentage,
		total_amount: totalAmount,
		deposit_amount: depositAmount,
	};
}

/**
 * Rate-creation/update invariant: two non-high-season rates must not overlap.
 * `candidate` is the rate being created or updated; `existing` are the
 * property's other rates (exclude the candidate itself on update).
 */
export function assertNoBaseRateOverlap(
	candidate: Pick<RateInput, "start_date" | "end_date" | "is_high_season">,
	existing: Pick<RateInput, "start_date" | "end_date" | "is_high_season">[],
): void {
	if (candidate.is_high_season) return;
	const conflict = existing.find(
		(r) =>
			!r.is_high_season &&
			overlaps(candidate.start_date, candidate.end_date, r.start_date, r.end_date),
	);
	if (conflict) {
		throw new DomainError(
			"rate_overlap",
			"Two non-high-season rates must not overlap",
		);
	}
}
