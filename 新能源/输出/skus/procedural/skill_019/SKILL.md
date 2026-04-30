---
name: design-microgrid-networking-topology
description: Select the networking topology (single, dual, ring, mesh) for microgrid units based on coverage area and reliability needs.
---

## Overview
Microgrid unit interconnection can follow four topologies: single‑network, dual‑network, ring‑network, and mesh‑network. The choice impacts control complexity and reliability.

## Steps
1. **Determine the physical scale of the microgrid** – measure the geographical spread of power sources and loads.
2. **Map criticality of load zones** – identify any areas that cannot tolerate interruption.
3. **Evaluate topologies**:
   - **Single‑network**: simple control, lowest cost, suitable for small areas.
   - **Dual‑network**: moderate redundancy, medium complexity.
   - **Ring‑network**: higher reliability via loop connections, more complex protection.
   - **Mesh‑network**: highest reliability, maximum complexity and cost.
4. **Select the simplest topology that meets reliability requirements** – typical small to medium sites use single or ring topology.
5. **Document the chosen topology and the inter‑connection switching devices** (DC breakers or bidirectional DC/DC converters).

## Decision Points
- If the power supply range is small and loads are not highly critical: use **single‑network** to simplify control.
- If higher reliability is needed for a medium area: consider **ring‑network**.
- For large, highly distributed, mission‑critical systems: evaluate **mesh‑network**.

## Expected Result
A topology design that balances operational reliability, control complexity, and cost.
