import { describe, expect, test } from "bun:test";
import { eachNight, nbNights, overlaps } from "../src/domain/dates";
import { DomainError } from "../src/domain/errors";
import {
	assertNoBaseRateOverlap,
	estimateStay,
	type RateInput,
	rateForNight,
	round2,
	selectDiscount,
} from "../src/domain/pricing";

function rate(
	partial: Partial<RateInput> & Pick<RateInput, "start_date" | "end_date">,
): RateInput {
	return {
		id: partial.id ?? crypto.randomUUID(),
		name: partial.name ?? "Base",
		base_price_per_night: partial.base_price_per_night ?? 100,
		is_high_season: partial.is_high_season ?? false,
		discount_rules: partial.discount_rules,
		start_date: partial.start_date,
		end_date: partial.end_date,
	};
}

describe("dates", () => {
	test("nbNights counts nights between check-in and check-out", () => {
		expect(nbNights("2026-07-01", "2026-07-03")).toBe(2);
		expect(nbNights("2026-07-01", "2026-07-02")).toBe(1);
	});

	test("nbNights rejects empty or inverted ranges", () => {
		expect(() => nbNights("2026-07-03", "2026-07-03")).toThrow(DomainError);
		expect(() => nbNights("2026-07-03", "2026-07-01")).toThrow(DomainError);
	});

	test("nbNights rejects malformed dates", () => {
		expect(() => nbNights("2026-02-30", "2026-03-02")).toThrow(DomainError);
		expect(() => nbNights("july 1st", "2026-07-03")).toThrow(DomainError);
	});

	test("eachNight excludes the check-out day", () => {
		expect(eachNight("2026-07-30", "2026-08-02")).toEqual([
			"2026-07-30",
			"2026-07-31",
			"2026-08-01",
		]);
	});

	test("overlaps is end-exclusive: back-to-back ranges do not overlap", () => {
		expect(
			overlaps("2026-07-01", "2026-07-05", "2026-07-05", "2026-07-10"),
		).toBe(false);
		expect(
			overlaps("2026-07-01", "2026-07-06", "2026-07-05", "2026-07-10"),
		).toBe(true);
	});
});

describe("rateForNight", () => {
	const base = rate({
		start_date: "2026-06-01",
		end_date: "2026-09-01",
		base_price_per_night: 80,
	});
	const highSeason = rate({
		start_date: "2026-07-01",
		end_date: "2026-08-01",
		base_price_per_night: 120,
		is_high_season: true,
	});

	test("returns the covering rate", () => {
		expect(rateForNight([base], "2026-06-15")?.base_price_per_night).toBe(80);
	});

	test("high-season rate wins on overlapping nights", () => {
		expect(
			rateForNight([base, highSeason], "2026-07-15")?.base_price_per_night,
		).toBe(120);
	});

	test("rate end_date is exclusive", () => {
		expect(
			rateForNight([base, highSeason], "2026-08-01")?.base_price_per_night,
		).toBe(80);
	});

	test("returns undefined when no rate covers the night", () => {
		expect(rateForNight([base], "2026-09-15")).toBeUndefined();
	});
});

describe("selectDiscount", () => {
	test("spec example: -10% for 7+ nights, -20% for 14+ nights", () => {
		const rules = [
			{ min_nights: 7, max_nights: 13, discount_percentage: 10 },
			{ min_nights: 14, max_nights: null, discount_percentage: 20 },
		];
		expect(selectDiscount(rules, 6)).toBeUndefined();
		expect(selectDiscount(rules, 7)?.discount_percentage).toBe(10);
		expect(selectDiscount(rules, 13)?.discount_percentage).toBe(10);
		expect(selectDiscount(rules, 14)?.discount_percentage).toBe(20);
		expect(selectDiscount(rules, 30)?.discount_percentage).toBe(20);
	});

	test("overlapping rules: the most favourable for the client wins", () => {
		const rules = [
			{ min_nights: 5, max_nights: null, discount_percentage: 5 },
			{ min_nights: 7, max_nights: null, discount_percentage: 15 },
		];
		expect(selectDiscount(rules, 10)?.discount_percentage).toBe(15);
	});

	test("max_nights null is open-ended", () => {
		const rules = [
			{ min_nights: 7, max_nights: null, discount_percentage: 10 },
		];
		expect(selectDiscount(rules, 365)?.discount_percentage).toBe(10);
	});
});

describe("estimateStay", () => {
	const base = rate({
		start_date: "2026-06-01",
		end_date: "2026-09-01",
		base_price_per_night: 80,
	});
	const highSeason = rate({
		start_date: "2026-07-01",
		end_date: "2026-08-01",
		base_price_per_night: 120,
		is_high_season: true,
	});

	test("simple stay on a single rate", () => {
		const estimate = estimateStay([base], "2026-06-10", "2026-06-13");
		expect(estimate.nb_nights).toBe(3);
		expect(estimate.base_amount).toBe(240);
		expect(estimate.discount_percentage).toBe(0);
		expect(estimate.total_amount).toBe(240);
	});

	test("stay spanning base and high season prices each night separately", () => {
		// 2 nights at 80 (06-29, 06-30) + 2 nights at 120 (07-01, 07-02)
		const estimate = estimateStay(
			[base, highSeason],
			"2026-06-29",
			"2026-07-03",
		);
		expect(estimate.base_amount).toBe(400);
	});

	test("discount applies based on stay length", () => {
		const withDiscount = rate({
			start_date: "2026-06-01",
			end_date: "2026-09-01",
			base_price_per_night: 100,
			discount_rules: [
				{ min_nights: 7, max_nights: null, discount_percentage: 10 },
			],
		});
		const estimate = estimateStay([withDiscount], "2026-06-01", "2026-06-08");
		expect(estimate.nb_nights).toBe(7);
		expect(estimate.base_amount).toBe(700);
		expect(estimate.discount_percentage).toBe(10);
		expect(estimate.total_amount).toBe(630);
	});

	test("deposit equals total when no split payment is configured (spec)", () => {
		const estimate = estimateStay([base], "2026-06-10", "2026-06-12");
		expect(estimate.deposit_amount).toBe(estimate.total_amount);
	});

	test("deposit percentage produces a rounded upfront amount", () => {
		const estimate = estimateStay([base], "2026-06-10", "2026-06-13", {
			depositPercentage: 30,
		});
		expect(estimate.total_amount).toBe(240);
		expect(estimate.deposit_amount).toBe(72);
	});

	test("throws no_applicable_rate when a night is uncovered", () => {
		expect(() =>
			estimateStay([highSeason], "2026-07-30", "2026-08-02"),
		).toThrow(/No rate covers the night of 2026-08-01/);
	});

	test("amounts are rounded to cents", () => {
		const odd = rate({
			start_date: "2026-06-01",
			end_date: "2026-09-01",
			base_price_per_night: 99.99,
			discount_rules: [
				{ min_nights: 1, max_nights: null, discount_percentage: 33 },
			],
		});
		const estimate = estimateStay([odd], "2026-06-10", "2026-06-13");
		expect(estimate.base_amount).toBe(299.97);
		// 299.97 * 0.67 = 200.9799 → 200.98
		expect(estimate.total_amount).toBe(200.98);
	});
});

describe("assertNoBaseRateOverlap", () => {
	const existingBase = {
		start_date: "2026-06-01",
		end_date: "2026-07-01",
		is_high_season: false,
	};

	test("rejects two overlapping non-high-season rates", () => {
		expect(() =>
			assertNoBaseRateOverlap(
				{
					start_date: "2026-06-15",
					end_date: "2026-07-15",
					is_high_season: false,
				},
				[existingBase],
			),
		).toThrow(/must not overlap/);
	});

	test("allows a high-season rate overlapping a base rate", () => {
		expect(() =>
			assertNoBaseRateOverlap(
				{
					start_date: "2026-06-15",
					end_date: "2026-07-15",
					is_high_season: true,
				},
				[existingBase],
			),
		).not.toThrow();
	});

	test("allows back-to-back base rates (end-exclusive)", () => {
		expect(() =>
			assertNoBaseRateOverlap(
				{
					start_date: "2026-07-01",
					end_date: "2026-08-01",
					is_high_season: false,
				},
				[existingBase],
			),
		).not.toThrow();
	});
});

describe("round2", () => {
	test("rounds half up at cent precision", () => {
		expect(round2(1.005)).toBe(1.01);
		expect(round2(200.9799)).toBe(200.98);
		expect(round2(0.1 + 0.2)).toBe(0.3);
	});
});
