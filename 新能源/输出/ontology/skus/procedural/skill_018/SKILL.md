---
name: select-main-bus-structure
description: Choose between a single or redundant main bus architecture for a DC microgrid based on reliability requirements.
---

## Overview
The main bus is the backbone of the microgrid, connecting all power sources, storage, and loads. It can be implemented as a single string or with a redundant backup line.

## Steps
1. **Assess the user's power supply continuity requirement** – consult the facility owner about the maximum acceptable outage duration and sensitivity to interruptions.
2. **Evaluate single‑bus structure** – suitable for non‑critical sites where occasional downtime is acceptable and cost savings are prioritized.
3. **Evaluate redundant‑bus structure** – adds a secondary main bus used only during faults or maintenance; suitable for critical operations.
4. **Compare total cost and complexity** – redundant structure increases cabling, switchgear, and control complexity.
5. **Make recommendation** – based on the balance between reliability needs and budget.

## Decision Points
- If reliability is paramount (e.g., data centers, hospitals): choose **redundant main bus**.
- If reliability is moderate (e.g., commercial buildings, general parks): choose **single main bus** to control costs.

## Expected Result
A clearly documented main bus architecture choice aligned with the client's operational requirements and budget.
