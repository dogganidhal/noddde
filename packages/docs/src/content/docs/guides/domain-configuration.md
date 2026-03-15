---
title: Domain Configuration
description: Wiring aggregates, projections, and infrastructure together
---

## Overview

`configureDomain` is the entry point for assembling your domain. It connects aggregates, projections, and infrastructure (buses, persistence) into a running domain.

```typescript
import { configureDomain } from "@noddde/core";

const domain = await configureDomain({
  writeModel: {
    aggregates: { MyAggregate },
  },
  readModel: {
    projections: { MyProjection },
  },
  infrastructure: {
    // ...
  },
});
```

<!-- TODO: DomainConfiguration interface, infrastructure providers, persistence -->
