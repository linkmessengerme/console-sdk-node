/** Mini Apps merchant contract. All int64 values are decimal strings, never JS numbers. */
export type PaymentInt64 = string;

export const CreateOrderResultCode = {
  Unspecified: "CREATE_ORDER_RESULT_CODE_UNSPECIFIED",
  OK: "CREATE_ORDER_RESULT_CODE_OK",
  PaymentAccessNotApproved: "CREATE_ORDER_RESULT_CODE_PAYMENT_ACCESS_NOT_APPROVED",
  PaymentAccessRevoked: "CREATE_ORDER_RESULT_CODE_PAYMENT_ACCESS_REVOKED",
  MethodNotAvailable: "CREATE_ORDER_RESULT_CODE_METHOD_NOT_AVAILABLE",
  IdempotencyConflict: "CREATE_ORDER_RESULT_CODE_IDEMPOTENCY_CONFLICT",
} as const;
export type CreateOrderResultCode = (typeof CreateOrderResultCode)[keyof typeof CreateOrderResultCode];

export const CancelOrderResultCode = {
  Unspecified: "CANCEL_ORDER_RESULT_CODE_UNSPECIFIED",
  OK: "CANCEL_ORDER_RESULT_CODE_OK",
  OrderExpired: "CANCEL_ORDER_RESULT_CODE_ORDER_EXPIRED",
  AlreadyPaid: "CANCEL_ORDER_RESULT_CODE_ALREADY_PAID",
  IdempotencyConflict: "CANCEL_ORDER_RESULT_CODE_IDEMPOTENCY_CONFLICT",
  AttemptInProgress: "CANCEL_ORDER_RESULT_CODE_ATTEMPT_IN_PROGRESS",
  Cancelled: "CANCEL_ORDER_RESULT_CODE_CANCELLED",
} as const;
export type CancelOrderResultCode = (typeof CancelOrderResultCode)[keyof typeof CancelOrderResultCode];

export const RecordFulfillmentResultCode = {
  Unspecified: "RECORD_FULFILLMENT_RESULT_CODE_UNSPECIFIED",
  OK: "RECORD_FULFILLMENT_RESULT_CODE_OK",
  IdempotencyConflict: "RECORD_FULFILLMENT_RESULT_CODE_IDEMPOTENCY_CONFLICT",
  FulfillmentConflict: "RECORD_FULFILLMENT_RESULT_CODE_FULFILLMENT_CONFLICT",
} as const;
export type RecordFulfillmentResultCode = (typeof RecordFulfillmentResultCode)[keyof typeof RecordFulfillmentResultCode];

export const Environment = {
  Unspecified: "ENVIRONMENT_UNSPECIFIED",
  Test: "ENVIRONMENT_TEST",
  Live: "ENVIRONMENT_LIVE",
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const ProductKind = {
  Unspecified: "PRODUCT_KIND_UNSPECIFIED",
  Consumable: "PRODUCT_KIND_CONSUMABLE",
  NonConsumable: "PRODUCT_KIND_NON_CONSUMABLE",
} as const;
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];

export const TestOutcome = {
  Unspecified: "TEST_OUTCOME_UNSPECIFIED",
  Success: "TEST_OUTCOME_SUCCESS",
  Insufficient: "TEST_OUTCOME_INSUFFICIENT",
  Delayed: "TEST_OUTCOME_DELAYED",
} as const;
export type TestOutcome = (typeof TestOutcome)[keyof typeof TestOutcome];

export const OrderStatus = {
  Unspecified: "ORDER_STATUS_UNSPECIFIED",
  Open: "ORDER_STATUS_OPEN",
  Processing: "ORDER_STATUS_PROCESSING",
  Paid: "ORDER_STATUS_PAID",
  Cancelled: "ORDER_STATUS_CANCELLED",
  Expired: "ORDER_STATUS_EXPIRED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const FulfillmentStatus = {
  Unspecified: "FULFILLMENT_STATUS_UNSPECIFIED",
  NotRequested: "FULFILLMENT_STATUS_NOT_REQUESTED",
  Pending: "FULFILLMENT_STATUS_PENDING",
  Fulfilled: "FULFILLMENT_STATUS_FULFILLED",
} as const;
export type FulfillmentStatus = (typeof FulfillmentStatus)[keyof typeof FulfillmentStatus];

export interface CreateOrderRequest {
  appId: string;
  /** Persist this UUID and retry the entire request unchanged. */
  operationId: string;
  merchantOrderId: string;
  buyerSub: string;
  product: ProductSnapshot;
  payment: PaymentTerms;
  testOutcome?: TestOutcome;
}

export interface CreateOrderResponse {
  result: CreateOrderResultCode;
  checkout?: Checkout;
}

export interface GetOrderRequest {
  appId: string;
  orderId: string;
}

export interface GetOrderResponse {
  order: Order;
}

export interface GetOrderByMerchantReferenceRequest {
  appId: string;
  merchantOrderId: string;
}

export interface GetOrderByMerchantReferenceResponse {
  order: Order;
}

export interface CancelOrderRequest {
  appId: string;
  orderId: string;
  /** Persist this UUID and retry the entire request unchanged. */
  operationId: string;
}

export interface CancelOrderResponse {
  result: CancelOrderResultCode;
  order?: Order;
}

export interface RecordFulfillmentRequest {
  appId: string;
  orderId: string;
  /** Persist this UUID and retry the entire request unchanged. */
  operationId: string;
  receiptId: string;
  sku: string;
  productVersion: PaymentInt64;
  buyerSub: string;
}

export interface RecordFulfillmentResponse {
  result: RecordFulfillmentResultCode;
  order?: Order;
}

export interface ProductSnapshot {
  sku: string;
  version: PaymentInt64;
  name: string;
  kind: ProductKind;
}

export interface PaymentTerms {
  amountMinor: PaymentInt64;
  currency: string;
  method: string;
}

export interface Offer {
  offerId: string;
  version: PaymentInt64;
  amountMinor: PaymentInt64;
  currency: string;
  method: string;
}

export interface Order {
  orderId: string;
  appId: string;
  environment: Environment;
  merchantOrderId: string;
  buyerSub: string;
  product: ProductSnapshot;
  offer: Offer;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  createdAt?: string;
  expiresAt?: string;
  revision: PaymentInt64;
  paidAt?: string;
}

export interface Checkout {
  order: Order;
  checkoutSessionId: string;
  methodAvailable: boolean;
}
