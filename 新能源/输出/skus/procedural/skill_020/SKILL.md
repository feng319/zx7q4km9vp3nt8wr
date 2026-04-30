---
name: optimize-underperforming-microgrid
description: Diagnose and improve a microgrid that suffers from low PV/storage utilization due to sizing errors or policy changes.
---

## Overview
Many microgrids underperform because initial design failed to accurately predict load profiles or because regulations changed after construction. This method enables systematic optimization.

## Steps
1. **Collect operational data** – gather historical data on load consumption, PV generation, and storage charge/discharge.
2. **Investigate local grid policy changes** – identify new constraints (e.g., prohibition of surplus feed‑in, new tariff structures).
3. **Analyze root causes of underperformance**:
   - Compare actual load curves against design assumptions.
   - Identify mismatches between storage capacity and actual usable capacity.
   - Check if control strategy aligns with current regulations.
4. **Re‑design the control strategy**:
   - If export is banned, shift to maximizing self‑consumption (e.g., store excess PV in batteries and use during non‑generation hours).
   - Adjust charge/discharge schedules to avoid fixed peak/valley cycles that no longer fit.
5. **Simulate and validate** the new strategy using digital twin or offline simulation.
6. **Deploy updated parameters** to the energy management system.
7. **Monitor KPIs** (PV self‑consumption rate, storage utilization rate) for at least one billing cycle.

## Decision Points
- If policy no longer allows power export: **reconfigure storage to absorb surplus PV** and discharge during load peaks, even if not aligned with grid peak/valley pricing.
- If storage capacity is severely oversized: accept that full utilization may be impossible; focus on maximizing useful cycles within remaining constraints.

## Expected Result
Significantly improved PV self‑consumption rate (e.g., from <50% to >90%) and storage utilization rate (e.g., from 50% to >75%), with the limitation that some overcapacity losses may persist.
