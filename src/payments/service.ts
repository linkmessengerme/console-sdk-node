import { InvalidResponseError, ValidationError } from "../errors";
import type { HttpTransport } from "../internal/transport";
import {
  CancelOrderResultCode, CreateOrderResultCode, Environment, FulfillmentStatus,
  OrderStatus, ProductKind, RecordFulfillmentResultCode,
  type CancelOrderRequest, type CancelOrderResponse, type Checkout,
  type CreateOrderRequest, type CreateOrderResponse, type GetOrderRequest,
  type GetOrderResponse, type GetOrderByMerchantReferenceRequest,
  type GetOrderByMerchantReferenceResponse, type Order,
  type RecordFulfillmentRequest, type RecordFulfillmentResponse,
} from "./types";

const ORDERS = "/sdk/v1/miniapps/payments/orders";
const MAX_INT64 = 9223372036854775807n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PaymentOptions { signal?: AbortSignal }

/** Merchant API (`client.payments`). Business refusals are returned with HTTP 200. */
export class PaymentsService {
  constructor(private readonly transport: HttpTransport) {}

  /** Persist this entire request before sending. Inspect result before using checkout. */
  async createOrder(req: CreateOrderRequest, options: PaymentOptions = {}): Promise<CreateOrderResponse> {
    operation(req.operationId);
    const body = {
      app_id: req.appId, operation_id: req.operationId,
      merchant_order_id: req.merchantOrderId, buyer_sub: req.buyerSub,
      product: {
        sku: req.product.sku, version: positiveInt64(req.product.version),
        name: req.product.name, kind: req.product.kind,
      },
      payment: {
        amount_minor: positiveInt64(req.payment.amountMinor),
        currency: req.payment.currency, method: req.payment.method,
      },
      test_outcome: req.testOutcome,
    };
    const wire = await this.call("", body, options);
    const result = enumValue(wire.result, CreateOrderResultCode);
    if (result === CreateOrderResultCode.Unspecified) throw invalid();
    const checkout = wire.checkout == null ? undefined : decodeCheckout(wire.checkout);
    if (result === CreateOrderResultCode.OK && !checkout) throw invalid();
    return { result, checkout };
  }

  async getOrder(req: GetOrderRequest, options: PaymentOptions = {}): Promise<GetOrderResponse> {
    const wire = await this.call("/get", { app_id: req.appId, order_id: req.orderId }, options);
    return { order: decodeOrder(wire.order) };
  }

  async getOrderByMerchantReference(req: GetOrderByMerchantReferenceRequest, options: PaymentOptions = {}): Promise<GetOrderByMerchantReferenceResponse> {
    const wire = await this.call("/by-merchant-reference", {
      app_id: req.appId, merchant_order_id: req.merchantOrderId,
    }, options);
    return { order: decodeOrder(wire.order) };
  }

  /** Cancellation is not a refund. Inspect result even when the request succeeds. */
  async cancelOrder(req: CancelOrderRequest, options: PaymentOptions = {}): Promise<CancelOrderResponse> {
    operation(req.operationId);
    const wire = await this.call("/cancel", {
      app_id: req.appId, order_id: req.orderId, operation_id: req.operationId,
    }, options);
    const result = enumValue(wire.result, CancelOrderResultCode);
    if (result === CancelOrderResultCode.Unspecified) throw invalid();
    const order = wire.order == null ? undefined : decodeOrder(wire.order);
    if (result !== CancelOrderResultCode.IdempotencyConflict && !order) throw invalid();
    return { result, order };
  }

  /** Records an already committed item grant and receipt after observing PAID. */
  async recordFulfillment(req: RecordFulfillmentRequest, options: PaymentOptions = {}): Promise<RecordFulfillmentResponse> {
    operation(req.operationId);
    const wire = await this.call("/fulfillment", {
      app_id: req.appId, order_id: req.orderId, operation_id: req.operationId,
      receipt_id: req.receiptId, sku: req.sku,
      product_version: positiveInt64(req.productVersion), buyer_sub: req.buyerSub,
    }, options);
    const result = enumValue(wire.result, RecordFulfillmentResultCode);
    if (result === RecordFulfillmentResultCode.Unspecified) throw invalid();
    const order = wire.order == null ? undefined : decodeOrder(wire.order);
    if (result !== RecordFulfillmentResultCode.IdempotencyConflict && !order) throw invalid();
    return { result, order };
  }

  private async call(suffix: string, body: unknown, options: PaymentOptions): Promise<Record<string, unknown>> {
    return object(await this.transport.doJSON("POST", ORDERS + suffix, body, {
      retrySafe: true, signal: options.signal,
    }));
  }
}

function operation(id: string): void {
  if (typeof id !== "string" || !UUID.test(id) || id === "00000000-0000-0000-0000-000000000000") {
    throw new ValidationError("operationId must be a persisted nonzero UUID; retry the same request unchanged");
  }
}

function positiveInt64(value: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > MAX_INT64) {
    throw new ValidationError("payment amount/version must be a positive int64 decimal string");
  }
  return value;
}

function invalid(): InvalidResponseError { return new InvalidResponseError("invalid payments response"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  return value;
}
function timestamp(value: unknown): string | undefined {
  // Keep the ProtoJSON timestamp string, including nanoseconds, without Date rounding.
  return value == null ? undefined : string(value);
}
function int64(value: unknown): string {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,18})$/.test(value)) throw invalid();
  const n = BigInt(value);
  if (n < -9223372036854775808n || n > MAX_INT64) throw invalid();
  return value;
}
function enumValue<T extends string>(value: unknown, values: Record<string, T>): T {
  if (typeof value !== "string" || !Object.values<string>(values).includes(value)) throw invalid();
  return value as T;
}
function decodeOrder(value: unknown): Order {
  const o = object(value), p = object(o.product), offer = object(o.offer);
  return {
    orderId: string(o.order_id), appId: string(o.app_id),
    environment: enumValue(o.environment, Environment),
    merchantOrderId: string(o.merchant_order_id), buyerSub: string(o.buyer_sub),
    product: {
      sku: string(p.sku), version: int64(p.version), name: string(p.name),
      kind: enumValue(p.kind, ProductKind),
    },
    offer: {
      offerId: string(offer.offer_id), version: int64(offer.version),
      amountMinor: int64(offer.amount_minor), currency: string(offer.currency), method: string(offer.method),
    },
    status: enumValue(o.status, OrderStatus),
    fulfillmentStatus: enumValue(o.fulfillment_status, FulfillmentStatus),
    revision: int64(o.revision ?? "0"),
    createdAt: timestamp(o.created_at), expiresAt: timestamp(o.expires_at), paidAt: timestamp(o.paid_at),
  };
}
function decodeCheckout(value: unknown): Checkout {
  const c = object(value);
  if (c.method_available != null && typeof c.method_available !== "boolean") throw invalid();
  return {
    order: decodeOrder(c.order), checkoutSessionId: string(c.checkout_session_id),
    methodAvailable: c.method_available === true,
  };
}
