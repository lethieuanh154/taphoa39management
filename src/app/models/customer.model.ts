export interface CustomerNote {
    id: string;
    text: string;
    createdAt: string;
    createdBy?: string;
}

export interface Customer {
    Code: string;
    CompareCode: string;
    CompareName: string;
    ContactNumber: string;
    CreatedBy: number;
    CreatedDate: Date;
    CreatedName: string;
    CustomerType: string;
    Debt: number;
    GenderName: string;
    Groups: string;
    Id: number;
    InvoiceCount: number;
    Invoices: any[];
    IsActive: boolean;
    LastTradingDate: Date;
    ModifiedDate: Date;
    MustUpdateDebt: boolean;
    MustUpdatePoint: boolean;
    Name: string;
    Orders: any[];
    Organization: string;
    RetailerId: number;
    Returns: any[];
    RewardPoint: number;
    TotalInvoiced: number;
    TotalPoint: number;
    LastResetLunarYear?: number;
    RegistrationBonus?: number;
    BonusPoint?: number;
    RedeemedPoints?: number;
    BirthDate?: string;
    Address?: string;
    TaxCode?: string;
    Email?: string;
    Comments?: string;
    GiftNotes?: CustomerNote[];
    TotalReturn: number;
    TotalRevenue: number;
    Uuid: string;
    isDeleted: boolean;
}
