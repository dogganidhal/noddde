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

// ---- Order view repository (for projections) ----

export interface OrderSummary {
  orderId: string;
  customerId: string;
  status: string;
  total: number;
  itemCount: number;
  trackingNumber: string | null;
}

export interface OrderSummaryRepository {
  getById(orderId: string): Promise<OrderSummary | null>;
  save(summary: OrderSummary): Promise<void>;
}

export class InMemoryOrderSummaryRepository implements OrderSummaryRepository {
  async getById(orderId: string): Promise<OrderSummary | null> {
    throw new Error("Not implemented");
  }
  async save(summary: OrderSummary): Promise<void> {
    throw new Error("Not implemented");
  }
}

// ---- Aggregate infrastructure (shared) ----

export interface EcommerceInfrastructure {
  clock: Clock;
  notificationService: NotificationService;
  orderSummaryRepository: OrderSummaryRepository;
}
