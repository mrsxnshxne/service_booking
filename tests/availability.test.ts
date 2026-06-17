import { describe, expect, test } from "bun:test";
import {
	type BlockedPeriodInput,
	canCreateHold,
	computeAvailability,
	type HoldSlotInput,
	isHoldActive,
	removableManualBlocks,
} from "../src/domain/availability";

const NOW = new Date("2026-06-15T12:00:00Z");

function hold(start: string, end: string, expired = false): HoldSlotInput {
	return {
		start_date: start,
		end_date: end,
		expires_at: expired ? "2026-06-15T11:00:00Z" : "2026-06-15T13:00:00Z",
	};
}

describe("computeAvailability", () => {
	test("all dates are available by default (availability works by exception)", () => {
		const days = computeAvailability("2026-07-01", "2026-07-04", [], [], NOW);
		expect(days).toEqual([
			{ date: "2026-07-01", blocked: false, source: null },
			{ date: "2026-07-02", blocked: false, source: null },
			{ date: "2026-07-03", blocked: false, source: null },
		]);
	});

	test("a blocked period blocks its days with the source, end-exclusive", () => {
		const blocks: BlockedPeriodInput[] = [
			{ start_date: "2026-07-02", end_date: "2026-07-03", source: "manual" },
		];
		const days = computeAvailability(
			"2026-07-01",
			"2026-07-04",
			blocks,
			[],
			NOW,
		);
		expect(days[0]).toEqual({
			date: "2026-07-01",
			blocked: false,
			source: null,
		});
		expect(days[1]).toEqual({
			date: "2026-07-02",
			blocked: true,
			source: "manual",
		});
		// end_date is exclusive: the check-out day is free again
		expect(days[2]).toEqual({
			date: "2026-07-03",
			blocked: false,
			source: null,
		});
	});

	test("an active hold slot blocks its days without a block source", () => {
		const days = computeAvailability(
			"2026-07-01",
			"2026-07-03",
			[],
			[hold("2026-07-01", "2026-07-02")],
			NOW,
		);
		expect(days[0]).toEqual({
			date: "2026-07-01",
			blocked: true,
			source: null,
		});
		expect(days[1]).toEqual({
			date: "2026-07-02",
			blocked: false,
			source: null,
		});
	});

	test("an expired hold slot does not block", () => {
		const days = computeAvailability(
			"2026-07-01",
			"2026-07-03",
			[],
			[hold("2026-07-01", "2026-07-03", true)],
			NOW,
		);
		expect(days.every((d) => !d.blocked)).toBe(true);
	});

	test("blocked period source wins over a hold on the same day", () => {
		const blocks: BlockedPeriodInput[] = [
			{
				start_date: "2026-07-01",
				end_date: "2026-07-02",
				source: "booking_confirmed",
			},
		];
		const days = computeAvailability(
			"2026-07-01",
			"2026-07-02",
			blocks,
			[hold("2026-07-01", "2026-07-02")],
			NOW,
		);
		expect(days[0]).toEqual({
			date: "2026-07-01",
			blocked: true,
			source: "booking_confirmed",
		});
	});
});

describe("isHoldActive", () => {
	test("active until expires_at, expired after", () => {
		expect(isHoldActive(hold("2026-07-01", "2026-07-02"), NOW)).toBe(true);
		expect(isHoldActive(hold("2026-07-01", "2026-07-02", true), NOW)).toBe(
			false,
		);
	});
});

describe("canCreateHold", () => {
	const blocks: BlockedPeriodInput[] = [
		{ start_date: "2026-07-10", end_date: "2026-07-15", source: "ical_airbnb" },
	];

	test("allowed on free dates", () => {
		expect(canCreateHold("2026-07-01", "2026-07-05", blocks, [], NOW)).toBe(
			true,
		);
	});

	test("rejected when overlapping a blocked period", () => {
		expect(canCreateHold("2026-07-12", "2026-07-20", blocks, [], NOW)).toBe(
			false,
		);
	});

	test("rejected when overlapping an active hold (only one active hold per slot)", () => {
		const holds = [hold("2026-07-03", "2026-07-06")];
		expect(canCreateHold("2026-07-05", "2026-07-08", [], holds, NOW)).toBe(
			false,
		);
	});

	test("allowed when the conflicting hold has expired", () => {
		const holds = [hold("2026-07-03", "2026-07-06", true)];
		expect(canCreateHold("2026-07-05", "2026-07-08", [], holds, NOW)).toBe(
			true,
		);
	});

	test("back-to-back with a block is allowed (end-exclusive ranges)", () => {
		expect(canCreateHold("2026-07-05", "2026-07-10", blocks, [], NOW)).toBe(
			true,
		);
		expect(canCreateHold("2026-07-15", "2026-07-20", blocks, [], NOW)).toBe(
			true,
		);
	});
});

describe("removableManualBlocks", () => {
	const blocks: BlockedPeriodInput[] = [
		{ start_date: "2026-07-01", end_date: "2026-07-05", source: "manual" },
		{
			start_date: "2026-07-03",
			end_date: "2026-07-08",
			source: "booking_confirmed",
		},
		{
			start_date: "2026-07-06",
			end_date: "2026-07-09",
			source: "ical_booking",
		},
		{ start_date: "2026-08-01", end_date: "2026-08-05", source: "manual" },
	];

	test("only manual blocks overlapping the range are removable (spec)", () => {
		const removable = removableManualBlocks("2026-07-01", "2026-07-31", blocks);
		expect(removable).toEqual([
			{ start_date: "2026-07-01", end_date: "2026-07-05", source: "manual" },
		]);
	});

	test("manual blocks outside the range are kept", () => {
		const removable = removableManualBlocks("2026-09-01", "2026-09-30", blocks);
		expect(removable).toEqual([]);
	});
});
