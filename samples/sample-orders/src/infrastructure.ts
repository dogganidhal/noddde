/* eslint-disable no-unused-vars */

import type { ViewStore } from "@noddde/core";

// ---- Clock (deterministic time injection) ----

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly date: Date) {}
  now(): Date {
    return this.date;
  }
}

// ---- Notification service ----

export interface NotificationService {
  notifyCustomer(customerId: string, message: string): Promise<void>;
}

export class ConsoleNotificationService implements NotificationService {
  async notifyCustomer(customerId: string, message: string): Promise<void> {
    console.log(`[Notification -> ${customerId}]: ${message}`);
  }
}

// ---- Order summary view ----

export interface OrderSummary {
  orderId: string;
  customerId: string;
  status: string;
  total: number;
  itemCount: number;
  trackingNumber: string | null;
}

// ---- Aggregate infrastructure (shared) ----

export interface EcommerceInfrastructure {
  clock: Clock;
  notificationService: NotificationService;
  orderSummaryViewStore: ViewStore<OrderSummary>;
}
