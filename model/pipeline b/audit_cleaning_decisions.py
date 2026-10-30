"""Streaming, read-only audit of the Online Retail cleaning decisions."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook


ANALYSIS_START = datetime(2010, 12, 1)
ANALYSIS_END = datetime(2011, 12, 1)


def audit(source: Path) -> dict[str, object]:
    workbook = load_workbook(source, read_only=True, data_only=True)
    sheet = workbook.active
    headers = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True))
    index = {str(name): position for position, name in enumerate(headers)}
    required = {"InvoiceNo", "StockCode", "Quantity", "InvoiceDate", "UnitPrice", "CustomerID"}
    missing_headers = required - index.keys()
    if missing_headers:
        raise ValueError(f"Missing required columns: {sorted(missing_headers)}")

    count = {
        "source_rows_in_period": 0,
        "source_rows_outside_period": 0,
        "missing_customer_id_rows": 0,
        "paid_positive_sale_rows_with_customer_id": 0,
        "negative_quantity_rows": 0,
        "negative_quantity_C_invoice_rows": 0,
        "negative_quantity_non_C_rows": 0,
        "positive_price_linked_reversal_rows": 0,
        "matched_reversal_rows": 0,
        "unmatched_reversal_rows": 0,
        "zero_price_positive_quantity_rows": 0,
        "zero_price_negative_quantity_rows": 0,
        "negative_unit_price_rows": 0,
    }
    seen_hashes: dict[bytes, int] = {}
    duplicates = 0
    duplicate_examples: list[dict[str, object]] = []
    duplicate_paid_sale_rows = 0
    duplicate_paid_sale_value = 0.0
    gross_if_duplicates_retained = 0.0
    sales_customers: set[int | float] = set()
    inventory: dict[tuple[int | float, str, float], float] = {}
    gross_value = 0.0
    unlinked_sales_value = 0.0
    unlinked_sales_rows = 0
    unlinked_reversal_qty = 0.0
    unlinked_reversal_value = 0.0
    reversal_qty = reversal_value = matched_qty = matched_value = 0.0
    unmatched_qty = unmatched_value = 0.0
    matched_customers: set[int | float] = set()
    unmatched_customers: set[int | float] = set()
    last_date: datetime | None = None
    out_of_order_rows = 0

    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        if not row or row[index["InvoiceDate"]] is None:
            continue
        timestamp = row[index["InvoiceDate"]]
        if isinstance(timestamp, datetime):
            date = timestamp
        else:
            try:
                date = datetime.fromisoformat(str(timestamp))
            except ValueError:
                continue
        if last_date is not None and date < last_date:
            out_of_order_rows += 1
        last_date = date
        if not ANALYSIS_START <= date < ANALYSIS_END:
            count["source_rows_outside_period"] += 1
            continue
        count["source_rows_in_period"] += 1

        customer = row[index["CustomerID"]]
        stock = str(row[index["StockCode"]] or "").strip()
        invoice = str(row[index["InvoiceNo"]] or "").strip()
        try:
            quantity = float(row[index["Quantity"]])
            price = float(row[index["UnitPrice"]])
        except (TypeError, ValueError):
            continue
        is_c_invoice = invoice.upper().startswith("C")
        signature = hashlib.blake2b(repr(tuple(row)).encode("utf-8"), digest_size=16).digest()
        is_duplicate = signature in seen_hashes
        if is_duplicate:
            duplicates += 1
            if len(duplicate_examples) < 20:
                duplicate_examples.append({
                    "first_excel_row": seen_hashes[signature],
                    "duplicate_excel_row": row_number,
                    "invoice_no": invoice,
                    "stock_code": stock,
                    "customer_id": customer,
                    "date": date.isoformat(sep=" "),
                    "quantity": quantity,
                    "unit_price": price,
                })
            if customer is not None and quantity > 0 and price > 0 and not is_c_invoice:
                duplicate_paid_sale_rows += 1
                duplicate_paid_sale_value += quantity * price
        else:
            seen_hashes[signature] = row_number
        if customer is None:
            count["missing_customer_id_rows"] += 1
        if price < 0:
            count["negative_unit_price_rows"] += 1
        if quantity > 0 and price == 0:
            count["zero_price_positive_quantity_rows"] += 1
        if quantity < 0 and price == 0:
            count["zero_price_negative_quantity_rows"] += 1
        if quantity < 0:
            count["negative_quantity_rows"] += 1
            key_type = "negative_quantity_C_invoice_rows" if is_c_invoice else "negative_quantity_non_C_rows"
            count[key_type] += 1

        if customer is not None and quantity > 0 and price > 0 and not is_c_invoice:
            gross_if_duplicates_retained += quantity * price
        if customer is None and quantity > 0 and price > 0 and not is_c_invoice:
            unlinked_sales_rows += 1
            unlinked_sales_value += quantity * price
        if customer is None and quantity < 0 and price > 0:
            unlinked_reversal_qty += -quantity
            unlinked_reversal_value += -quantity * price

        # Exact repeated source rows have no distinct transaction-line identifier.
        # Preserve them in the raw audit and sensitivity total, but process one copy
        # in the primary customer-level cleaning ledger.
        if is_duplicate:
            continue

        if customer is None or price <= 0:
            continue
        key = (customer, stock, price)
        if quantity > 0 and not is_c_invoice:
            count["paid_positive_sale_rows_with_customer_id"] += 1
            sales_customers.add(customer)
            gross_value += quantity * price
            inventory[key] = inventory.get(key, 0.0) + quantity
        elif quantity < 0:
            count["positive_price_linked_reversal_rows"] += 1
            reversed_units = -quantity
            reversal_qty += reversed_units
            reversal_value += reversed_units * price
            available = inventory.get(key, 0.0)
            consumed = min(available, reversed_units)
            inventory[key] = available - consumed
            matched_qty += consumed
            matched_value += consumed * price
            unmatched = reversed_units - consumed
            unmatched_qty += unmatched
            unmatched_value += unmatched * price
            if consumed > 0:
                count["matched_reversal_rows"] += 1
                matched_customers.add(customer)
            if unmatched > 0:
                count["unmatched_reversal_rows"] += 1
                unmatched_customers.add(customer)

        if row_number % 100000 == 0:
            print(f"Scanned {row_number:,} workbook rows", flush=True)

    workbook.close()
    return {
        "analysis_period_start_inclusive": "2010-12-01",
        "analysis_period_end_exclusive": "2011-12-01",
        **count,
        "exact_duplicate_rows_after_first": duplicates,
        "exact_duplicate_paid_sale_rows": duplicate_paid_sale_rows,
        "exact_duplicate_paid_sale_value": round(duplicate_paid_sale_value, 2),
        "duplicate_examples": duplicate_examples,
        "paid_positive_sale_customers": len(sales_customers),
        "gross_paid_sales_value_after_exact_deduplication": round(gross_value, 2),
        "gross_paid_sales_value_if_exact_duplicates_retained": round(gross_if_duplicates_retained, 2),
        "exact_duplicate_paid_sales_value_removed_from_primary": round(duplicate_paid_sale_value, 2),
        "unlinked_customer_paid_sale_rows": unlinked_sales_rows,
        "unlinked_customer_paid_sales_value": round(unlinked_sales_value, 2),
        "unlinked_customer_reversal_quantity": unlinked_reversal_qty,
        "unlinked_customer_reversal_value": round(unlinked_reversal_value, 2),
        "positive_price_linked_reversal_quantity": reversal_qty,
        "positive_price_linked_reversal_value": round(reversal_value, 2),
        "matched_reversal_quantity": matched_qty,
        "matched_reversal_value": round(matched_value, 2),
        "unmatched_reversal_quantity": unmatched_qty,
        "unmatched_reversal_value": round(unmatched_value, 2),
        "customers_with_matched_reversals": len(matched_customers),
        "customers_with_unmatched_reversals": len(unmatched_customers),
        "net_paid_sales_value_after_matched_reversals": round(gross_value - matched_value, 2),
        "out_of_order_rows": out_of_order_rows,
        "matching_rule": "Audit-only estimate: earlier paid purchases are matched FIFO by CustomerID, StockCode, and exact UnitPrice; reversal quantity is capped at prior quantity. This estimate does not alter customer RFM in the selected positive-sales policy.",
        "customer_model_inclusion_rule": "Only linked, exact-row-deduplicated rows with positive Quantity, positive UnitPrice, and a non-C InvoiceNo enter customer RFM and clustering. All zero/negative quantity, zero/negative price, and cancellation rows are excluded from customer features and retained in the source/audit.",
        "notes": [
            "Missing-CustomerID transactions are retained in the audit but excluded from customer-level modeling.",
            "All returns/reversals and cancellation rows are excluded from customer RFM; the FIFO estimates are audit-only and do not reduce customer paid-sales value.",
            "Zero-price lines and negative-price adjustments remain in the audit but do not contribute to customer RFM or value.",
            "Exact repeated full-row records are counted and excluded once from the primary customer-level ledger because the workbook has no unique transaction-line ID; raw source rows and the gross total with repeats retained remain available for sensitivity.",
            "The matching rule is conservative: refunds at a different price or without prior same-price quantity remain unmatched for review.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="UCI Online Retail workbook")
    parser.add_argument("output", type=Path, help="JSON output path")
    args = parser.parse_args()
    summary = audit(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
