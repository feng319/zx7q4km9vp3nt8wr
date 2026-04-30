---
name: offgrid-microgrid-feasibility-analysis
description: Calculate cost savings and ROI for a solar-storage-diesel off-grid microgrid replacing pure diesel generation.
---

## Overview
For remote off‑grid sites, building a solar‑storage‑diesel hybrid microgrid can drastically reduce fuel costs. This method structures the financial evaluation for both the energy off‑taker and the developer.

## Steps
1. **Inventory current diesel consumption** – collect daily/hourly fuel usage of all generators, diesel price, and annual maintenance costs.
2. **Calculate baseline 15‑year fuel costs** assuming annual price escalation (e.g., 2%): `Sum_{year=1..15} (annual_diesel_cost * (1+escalation)^(year-1))`.
3. **Design a hybrid system** – size PV (MWp), battery storage (MWh), and remaining diesel backup based on load profiles and solar resource data.
4. **Estimate total investment cost** – include solar, storage, diesel generators, transmission lines, and construction.
5. **Structure the Power Purchase Agreement (PPA)/lease terms** – define off‑taker annual payment, escalation rate, and contract duration.
6. **Compute off‑taker’s new annual costs** – PPA payment plus remaining diesel fuel and maintenance (still paid by off‑taker).
7. **Compute off‑taker’s total cost over 15 years** with the same escalation assumption.
8. **Compute developer revenue** – sum of PPA payments over the contract period.
9. **Evaluate payback** – developer’s simple payback = investment / first‑year revenue.
10. **Present results** – savings for off‑taker, IRR for developer, payback period.

## Decision Points
- If the simple payback exceeds 5‑7 years, renegotiate PPA price or consider system downsizing.

## Expected Result
A clear financial model showing a win‑win outcome: double‑digit million‑dollar savings for the off‑taker and an attractive return for the developer (e.g., payback in 4 years, >$46M total revenue over 15 years).
