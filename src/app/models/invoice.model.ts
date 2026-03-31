import { CartItem } from "./cart-item.model";
import { Customer } from "./customer.model";
import { AppliedPromotion } from "./promotion.model";

export interface InvoiceTab {
    id: string;
    name: string;
    cartItems: CartItem[];
    createdDate?: string,
    totalPrice: number,
    discountAmount: number,
    customer: Customer | null,
    customerPaid: number,
    totalQuantity: number,
    debt: number,
    note: string,
    totalCost: number,
    deliveryTime?: string,
    status?: string,
    onHandSynced?: boolean;
    invoiceVAT?: number;
    isMergeEnabled?: boolean;  // GỘP: ON=true, OFF=false (default)
    appliedPromotions?: AppliedPromotion[];  // KM đã áp dụng
}
