import { Injectable } from '@angular/core';
// import { Firestore, collection, getCountFromServer } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {

  constructor() { }

  get_invoice_by_id = "/api/firebase/invoices/";//+invoiceId
  get_invoice_by_date = "/api/firebase/invoices/date";
  post_add_invoice = "/api/firebase/add_invoice";
  put_update_invoice = "/api/firebase/invoices/";//+invoiceId
  delete_del_invoice = "/api/firebase/invoices/";//+invoiceId
  get_invoices_by_customer = "/api/firebase/invoices/customer/";//+ <customer_name>
  post_all_products_indexedDB_firebase = "/api/sync/kiotviet/firebase/products";

  post_add_customer = "/api/firebase/add_customer";
  post_add_customers = "/api/firebase/add_customers";
  get_all_customers = "/api/firebase/get/customers";

  get_revenue_by_daily = "/api/firebase/daily_summary";
  get_revenue_by_monthly = "/api/firebase/monthly_summary";
  get_revenue_by_yearly = "/api/firebase/yearly_summary";
  get_top_sell_products = "/api/firebase/top_products";

  get_all_products_from_firebase = "/api/firebase/get/products";
  get_product_by_id_from_firebase = "/api/firebase/get/products/";//+<product_id>
  add_product_to_firebase = "/api/firebase/add/product";
  update_product_by_id = "/api/firebase/update/products/";//+<product_id>
  delete_poduct_by_id_from_firebase = "/api/firebase/products/del/";//+<product_id>
  update_multi_products_by_id_to_firebase = "/api/firebase/update/products/batch";
  delete_products_batch_from_firebase = "/api/firebase/products/delete-batch";
}
