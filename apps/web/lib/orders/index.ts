/** Client-safe orders barrel — never re-export compute-orders (@vantage/core). */
export {
  ORDER_STATUSES,
  canTransitionOrder,
  computeOrderMetrics,
  showBuyPanel,
  statusLabel,
  summarizeOpenOrders,
  totalFromParts,
  unitCostFromEstimate,
  validateOrderSubmit,
} from "./evaluate";
export type { OrderSubmitInput } from "./evaluate";
export { ordersNextActions } from "./orders-next-actions";
export type { OrdersNextAction, OrdersNextActionContext } from "./orders-next-actions";
export type {
  OrderAiSummary,
  OrderMember,
  OrderMetrics,
  OrderRequest,
  OrderStatus,
  OrdersSetupStep,
  OrdersView,
} from "./types";
