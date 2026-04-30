---
name: design-dc-voltage-level
description: Determine the DC bus voltage level for a DC microgrid using demand, economy, and safety principles.
---

## Overview
Selecting the DC supply voltage level is critical for a direct-current microgrid. The design must balance the needs of connected equipment, economic efficiency, and safety.

## Steps
1. **Inventory all DC loads and storage devices** – list each equipment's required voltage level, including batteries and power converters.
2. **Apply the demand principle** – minimize the number of voltage tiers while covering as many devices as possible. Group equipment with similar voltage requirements.
3. **Apply the economy principle** – favor higher voltage levels to reduce current, thereby decreasing cable cross‑section and line losses.
4. **Apply the safety principle** – evaluate touch voltage risks and select a level that meets local safety standards (e.g., below hazardous thresholds).
5. **Finalize the voltage level** – choose a single value that satisfies all three principles. Document the rationale.

## Decision Points
- If multiple voltage tiers are unavoidable, limit them to the minimum necessary and add DC/DC converters only where essential.

## Expected Result
A single DC bus voltage (e.g., 750 V) that serves the majority of loads efficiently and safely, with clear justification for any additional converter stages.
