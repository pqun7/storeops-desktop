import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { backendCurrencyService } from "./currency-service.js"
import { finalizeStandaloneInventoryCost } from "./product-cost-service.js"
import type { Accessory, Ammunition, Customer, Invoice, PaymentRecord, Shipment, Supplier, Weapon } from "../../src/lib/types.js"

const PREFIX = "DEMO-"

// Older SQLite installations were populated by src/lib/mock-data.ts before
// demo records received the dedicated DEMO- namespace. Keep the exact ID
// ranges here so those installations can be cleaned without treating later
// user-created records as demonstration data.
const LEGACY_DEMO_IDS = {
  weapons: Array.from({ length: 140 }, (_, index) => `W${String(index + 1).padStart(5, "0")}`),
  invoices: Array.from({ length: 65 }, (_, index) => `INV${String(index + 1).padStart(5, "0")}`),
  payments: Array.from({ length: 55 }, (_, index) => `PAY${String(index + 1).padStart(5, "0")}`),
  shipments: Array.from({ length: 12 }, (_, index) => `SHP${String(index + 1).padStart(4, "0")}`),
  accessories: Array.from({ length: 6 }, (_, index) => `ACC${String(index + 1).padStart(3, "0")}`),
  ammunition: Array.from({ length: 7 }, (_, index) => `AMM${String(index + 1).padStart(3, "0")}`),
  customers: [
    ...Array.from({ length: 15 }, (_, index) => `CUST${String(index + 1).padStart(4, "0")}`),
    ...Array.from({ length: 4 }, (_, index) => `WB${String(index + 1).padStart(3, "0")}`),
  ],
  suppliers: Array.from({ length: 8 }, (_, index) => `SUP${String(index + 1).padStart(3, "0")}`),
} as const

function dateOffset(days: number): string {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(",")
}

function hasLegacyDemoFingerprint(): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM suppliers WHERE id = 'SUP001' AND name = 'Global Arms Distributors') AS supplier_match,
      EXISTS(SELECT 1 FROM accessories WHERE id = 'ACC001' AND name = 'Pistol Case') AS accessory_match,
      EXISTS(SELECT 1 FROM ammunition WHERE id = 'AMM001' AND caliber = '9x19') AS ammunition_match
  `).get() as { supplier_match: number; accessory_match: number; ammunition_match: number }
  return Number(row.supplier_match) + Number(row.accessory_match) + Number(row.ammunition_match) === 3
}

function deleteLegacyDemoRows(): void {
  const db = getDb()
  const ids = LEGACY_DEMO_IDS
  const productIds = [...ids.weapons, ...ids.accessories, ...ids.ammunition]
  const notificationEntityIds = [...productIds, ...ids.invoices, ...ids.shipments, ...ids.customers, ...ids.suppliers]

  db.prepare(`DELETE FROM sale_operations WHERE invoice_id IN (${placeholders(ids.invoices)})`).run(...ids.invoices)
  db.prepare(`DELETE FROM payment_records WHERE id IN (${placeholders(ids.payments)}) OR invoice_id IN (${placeholders(ids.invoices)})`).run(...ids.payments, ...ids.invoices)
  db.prepare(`DELETE FROM audit_logs WHERE
    (id GLOB 'LOG[0-9]*' AND description = 'Admin User logged into the system') OR
    (id GLOB 'LOG[0-9]*' AND CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.invoiceId') END IN (${placeholders(ids.invoices)}))
  `).run(...ids.invoices)
  db.prepare(`DELETE FROM app_notifications WHERE id GLOB 'NTF[0-9]*' AND
    (entity_id IN (${placeholders(notificationEntityIds)}) OR (type = 'BackupOmission' AND title = 'Backup Reminder'))
  `).run(...notificationEntityIds)
  db.prepare(`DELETE FROM invoices WHERE id IN (${placeholders(ids.invoices)})`).run(...ids.invoices)
  db.prepare(`DELETE FROM inventory_transactions WHERE item_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM stock_operations WHERE item_id IN (${placeholders([...ids.accessories, ...ids.ammunition])})`).run(...ids.accessories, ...ids.ammunition)
  db.prepare(`DELETE FROM product_costs WHERE product_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM inventory_cost_snapshots WHERE product_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM ammunition_weapon_compatibility WHERE ammunition_id IN (${placeholders(ids.ammunition)}) OR weapon_id IN (${placeholders(ids.weapons)})`).run(...ids.ammunition, ...ids.weapons)
  db.prepare(`DELETE FROM accessory_weapon_compatibility WHERE accessory_id IN (${placeholders(ids.accessories)}) OR weapon_id IN (${placeholders(ids.weapons)})`).run(...ids.accessories, ...ids.weapons)
  db.prepare(`DELETE FROM weapons WHERE id IN (${placeholders(ids.weapons)})`).run(...ids.weapons)
  db.prepare(`DELETE FROM shipments WHERE id IN (${placeholders(ids.shipments)})`).run(...ids.shipments)
  db.prepare(`DELETE FROM accessories WHERE id IN (${placeholders(ids.accessories)})`).run(...ids.accessories)
  db.prepare(`DELETE FROM ammunition WHERE id IN (${placeholders(ids.ammunition)})`).run(...ids.ammunition)
  db.prepare(`DELETE FROM customers WHERE id IN (${placeholders(ids.customers)})`).run(...ids.customers)
  db.prepare(`DELETE FROM suppliers WHERE id IN (${placeholders(ids.suppliers)})`).run(...ids.suppliers)
}

function countRemainingNamespacedDemoRows(): number {
  const db = getDb()
  const row = db.prepare(`SELECT
    (SELECT count(*) FROM invoices WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM shipments WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM accessories WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM ammunition WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM customers WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM suppliers WHERE id LIKE 'DEMO-%') AS count
  `).get() as { count: number }
  return Number(row.count)
}

function deleteDemoRows(): void {
  const db = getDb()
  const legacyDemoDetected = hasLegacyDemoFingerprint()
  db.prepare("DELETE FROM sale_operations WHERE invoice_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM payment_records WHERE id LIKE 'DEMO-%' OR invoice_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM invoices WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM inventory_transactions WHERE id LIKE 'DEMO-%' OR item_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM stock_operations WHERE item_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM product_costs WHERE product_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM inventory_cost_snapshots WHERE product_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM shipment_items WHERE shipment_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM ammunition_weapon_compatibility WHERE ammunition_id LIKE 'DEMO-%' OR weapon_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM accessory_weapon_compatibility WHERE accessory_id LIKE 'DEMO-%' OR weapon_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM weapons WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM shipments WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM accessories WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM ammunition WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM customers WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM suppliers WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM audit_logs WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM app_notifications WHERE id LIKE 'DEMO-%'").run()
  if (legacyDemoDetected) deleteLegacyDemoRows()

  const settingsUpdate = db.prepare("UPDATE system_settings SET show_demo_data = 0 WHERE id = 1").run()
  if (settingsUpdate.changes !== 1 || countRemainingNamespacedDemoRows() !== 0 || (legacyDemoDetected && hasLegacyDemoFingerprint())) {
    throw new Error("Demonstration data deletion could not be verified")
  }
}

export function deleteDemoData(): void {
  getDb().transaction(deleteDemoRows)()
}

export function resetDemoData(userId: string): void {
  const db = getDb()
  db.transaction(() => {
    deleteDemoRows()
    const today = dateOffset(0)
    const currency = backendCurrencyService.getDefaultTransactionCurrency()
    const snapshot = backendCurrencyService.getRateSnapshot(currency)
    const valuation = (amount: number) => backendCurrencyService.createValuationFromSnapshot(amount, snapshot)

    const suppliers: Supplier[] = [
      { id: `${PREFIX}SUPPLIER`, name: "Alpine Arms Distribution", contactPerson: "Maya Chen", phone: "+1 555 0141", email: "orders@alpine-arms.example.test", address: "420 Industrial Parkway", dateAdded: dateOffset(-120) },
      { id: `${PREFIX}SUP-002`, name: "Frontier Outdoor Wholesale", contactPerson: "Omar Hassan", phone: "+1 555 0142", email: "sales@frontier-outdoor.example.test", address: "18 Commerce Avenue", dateAdded: dateOffset(-95) },
      { id: `${PREFIX}SUP-003`, name: "Precision Ammunition Co.", contactPerson: "Elena Brooks", phone: "+1 555 0143", email: "accounts@precision-ammo.example.test", address: "77 Range Road", dateAdded: dateOffset(-80) },
    ]
    suppliers.forEach((item) => repo.insertSupplier(item))

    const customers: Customer[] = [
      { id: `${PREFIX}CUSTOMER`, name: "James Carter", phone: "+1 555 0201", email: "james.carter@example.test", address: "14 Oak Street", isWholesaleBuyer: false, wholesaleDiscountPercent: 0, dateAdded: dateOffset(-75) },
      { id: `${PREFIX}CUS-002`, name: "Lakeside Security Services", phone: "+1 555 0202", email: "purchasing@lakeside-security.example.test", address: "220 Harbor Road", isWholesaleBuyer: true, wholesaleDiscountPercent: 8, dateAdded: dateOffset(-64), notes: "Commercial customer; normally pays by bank transfer." },
      { id: `${PREFIX}CUS-003`, name: "Nile Sporting Club", phone: "+1 555 0203", email: "club@nile-sporting.example.test", address: "9 Stadium Lane", isWholesaleBuyer: true, wholesaleDiscountPercent: 12, dateAdded: dateOffset(-48) },
      { id: `${PREFIX}CUS-004`, name: "Sarah Williams", phone: "+1 555 0204", email: "sarah.williams@example.test", address: "6 Cedar Court", isWholesaleBuyer: false, wholesaleDiscountPercent: 0, dateAdded: dateOffset(-30) },
      { id: `${PREFIX}CUS-005`, name: "Redwood Training Center", phone: "+1 555 0205", email: "office@redwood-training.example.test", address: "88 Academy Drive", isWholesaleBuyer: true, wholesaleDiscountPercent: 10, dateAdded: dateOffset(-20) },
    ]
    customers.forEach((item) => repo.insertCustomer(item))

    const shipments: Shipment[] = [
      { id: `${PREFIX}SHIPMENT`, shipmentNumber: "DEMO-SHP-2401", supplierId: suppliers[0].id, shipmentDate: dateOffset(-70), expectedArrivalDate: dateOffset(-58), actualArrivalDate: dateOffset(-57), totalExpectedItems: 4, attachments: [], notes: "Received handgun and rifle stock.", status: "Arrived", timeline: [], currency, lineItems: [], documents: [], workflowStatus: "received", plannedCosts: [], createdAt: `${dateOffset(-57)}T10:00:00.000Z`, totalCostValuation: valuation(3150) },
      { id: `${PREFIX}SHP-002`, shipmentNumber: "DEMO-SHP-2402", supplierId: suppliers[1].id, shipmentDate: dateOffset(-18), expectedArrivalDate: dateOffset(-4), totalExpectedItems: 80, attachments: [], notes: "Delayed shipment awaiting carrier confirmation.", status: "Delayed", timeline: [], currency, lineItems: [], documents: [], workflowStatus: "scheduled", plannedCosts: [], createdAt: `${dateOffset(-18)}T10:00:00.000Z`, delayReason: "Carrier reported a two-day customs delay.", totalCostValuation: valuation(860) },
      { id: `${PREFIX}SHP-003`, shipmentNumber: "DEMO-SHP-2403", supplierId: suppliers[2].id, shipmentDate: dateOffset(-2), expectedArrivalDate: dateOffset(8), totalExpectedItems: 500, attachments: [], notes: "Training ammunition replenishment.", status: "In Transit", timeline: [], currency, lineItems: [], documents: [], workflowStatus: "scheduled", plannedCosts: [], createdAt: `${dateOffset(-2)}T10:00:00.000Z`, totalCostValuation: valuation(540) },
    ]
    shipments.forEach((item) => repo.insertShipment(item))

    const products = [
      { id: "001", brandId: "br-1", modelId: "mdl-3", typeId: "wt-4", subtypeId: "ws-10", caliberId: "cal-7", serial: "DEMO-G17-001", label: "Glock G17 Gen 5", cost: 520, retail: 720, wholesale: 675, condition: "Excellent" as const, status: "Available" as const, loc: "loc-1", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "002", brandId: "br-2", modelId: "mdl-4", typeId: "wt-4", subtypeId: "ws-10", caliberId: "cal-7", serial: "DEMO-P320-001", label: "SIG Sauer P320", cost: 610, retail: 845, wholesale: 795, condition: "Excellent" as const, status: "Reserved" as const, loc: "loc-2", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "003", brandId: "br-3", modelId: "mdl-1", typeId: "wt-1", subtypeId: "ws-1", caliberId: "cal-1", serial: "DEMO-870-001", label: "Remington 870", cost: 430, retail: 625, wholesale: 580, condition: "Good" as const, status: "Sold" as const, loc: "loc-3", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "004", brandId: "br-6", modelId: "mdl-6", typeId: "wt-5", subtypeId: "ws-15", caliberId: "cal-12", serial: "DEMO-HAWKEYE-001", label: "Ruger Hawkeye", cost: 980, retail: 1325, wholesale: 1240, condition: "Excellent" as const, status: "Available" as const, loc: "loc-4", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "005", brandId: "br-4", modelId: "mdl-2", typeId: "wt-1", subtypeId: "ws-4", caliberId: "cal-1", serial: "DEMO-SUPERSPORT-001", label: "Benelli Supersport", cost: 760, retail: 1050, wholesale: 980, condition: "Good" as const, status: "Available" as const, loc: "loc-1", supplier: suppliers[1].id, shipment: null },
      { id: "006", brandId: "br-1", modelId: "mdl-3", typeId: "wt-4", subtypeId: "ws-10", caliberId: "cal-7", serial: "DEMO-G17-002", label: "Glock G17 Gen 5", cost: 520, retail: 720, wholesale: 675, condition: "Excellent" as const, status: "Available" as const, loc: "loc-1", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "007", brandId: "br-2", modelId: "mdl-4", typeId: "wt-4", subtypeId: "ws-10", caliberId: "cal-7", serial: "DEMO-P320-002", label: "SIG Sauer P320", cost: 610, retail: 845, wholesale: 795, condition: "Good" as const, status: "Sold" as const, loc: "loc-2", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "008", brandId: "br-3", modelId: "mdl-1", typeId: "wt-1", subtypeId: "ws-2", caliberId: "cal-1", serial: "DEMO-870-002", label: "Remington 870", cost: 430, retail: 625, wholesale: 580, condition: "Excellent" as const, status: "Available" as const, loc: "loc-3", supplier: suppliers[1].id, shipment: shipments[1].id },
      { id: "009", brandId: "br-5", modelId: "mdl-5", typeId: "wt-5", subtypeId: "ws-15", caliberId: "cal-12", serial: "DEMO-AR15-001", label: "Colt AR-15", cost: 1180, retail: 1590, wholesale: 1490, condition: "Excellent" as const, status: "Reserved" as const, loc: "loc-4", supplier: suppliers[1].id, shipment: shipments[1].id },
      { id: "010", brandId: "br-7", modelId: "mdl-7", typeId: "wt-2", subtypeId: "ws-7", caliberId: "cal-4", serial: "DEMO-TRAIL-001", label: "Benjamin Trail", cost: 340, retail: 520, wholesale: 475, condition: "Good" as const, status: "Available" as const, loc: "loc-4", supplier: suppliers[1].id, shipment: shipments[1].id },
      { id: "011", brandId: "br-8", modelId: "mdl-8", typeId: "wt-3", subtypeId: "ws-9", caliberId: "cal-6", serial: "DEMO-VOLGA-001", label: "Ekol Volga", cost: 190, retail: 295, wholesale: 270, condition: "Good" as const, status: "Sold" as const, loc: "loc-2", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "012", brandId: "br-9", modelId: "mdl-9", typeId: "wt-1", subtypeId: "ws-5", caliberId: "cal-1", serial: "DEMO-ESCORT-001", label: "Hatsan Escort", cost: 410, retail: 595, wholesale: 550, condition: "Fair" as const, status: "Returned" as const, loc: "loc-3", supplier: suppliers[1].id, shipment: shipments[1].id },
      { id: "013", brandId: "br-6", modelId: "mdl-6", typeId: "wt-5", subtypeId: "ws-16", caliberId: "cal-13", serial: "DEMO-HAWKEYE-002", label: "Ruger Hawkeye", cost: 980, retail: 1325, wholesale: 1240, condition: "Excellent" as const, status: "Available" as const, loc: "loc-4", supplier: suppliers[0].id, shipment: shipments[0].id },
      { id: "014", brandId: "br-4", modelId: "mdl-2", typeId: "wt-1", subtypeId: "ws-1", caliberId: "cal-1", serial: "DEMO-SUPERSPORT-002", label: "Benelli Supersport", cost: 760, retail: 1050, wholesale: 980, condition: "Excellent" as const, status: "Reserved" as const, loc: "loc-1", supplier: suppliers[1].id, shipment: shipments[1].id },
      { id: "015", brandId: "br-1", modelId: "mdl-3", typeId: "wt-4", subtypeId: "ws-10", caliberId: "cal-7", serial: "DEMO-G17-003", label: "Glock G17 Gen 5", cost: 520, retail: 720, wholesale: 675, condition: "Excellent" as const, status: "Available" as const, loc: "loc-2", supplier: suppliers[0].id, shipment: shipments[0].id },
    ]
    const locationLabels: Record<string, { warehouse: string; shelf: string; bin: string }> = {
      "loc-1": { warehouse: "Main", shelf: "A", bin: "A-1" }, "loc-2": { warehouse: "Main", shelf: "A", bin: "A-2" },
      "loc-3": { warehouse: "Main", shelf: "B", bin: "B-1" }, "loc-4": { warehouse: "Secondary", shelf: "A", bin: "A-1" },
    }
    const weapons: Weapon[] = products.map((item) => ({
      id: `${PREFIX}WPN-${item.id}`, serialNumber: item.serial, weaponTypeId: item.typeId, weaponSubtypeId: item.subtypeId,
      caliberId: item.caliberId, brandId: item.brandId, modelId: item.modelId, storageLocationId: item.loc,
      weaponType: "demo", subType: "demo", caliber: "demo", brand: "demo", model: "demo", location: locationLabels[item.loc],
      condition: item.condition, status: item.status, purchasePrice: item.cost, retailPrice: item.retail, wholesalePrice: item.wholesale,
      retailPriceMode: "manual", wholesalePriceMode: "manual", actualFinalPrice: item.status === "Sold" ? 610 : null, supplierId: item.supplier,
      shipmentId: item.shipment, dateAdded: dateOffset(-55), batchId: "DEMO-BATCH-01", notes: item.status === "Reserved" ? "Reserved for Lakeside Security Services." : "Removable demonstration inventory.", images: [], movementHistory: [],
      purchasePriceValuation: valuation(item.cost), retailPriceValuation: valuation(item.retail), wholesalePriceValuation: valuation(item.wholesale),
    }))
    repo.bulkInsertWeapons(weapons)
    weapons.forEach((item) => finalizeStandaloneInventoryCost("weapon", item.id, item.purchasePrice, snapshot, [], userId))

    const accessories: Accessory[] = [
      { id: `${PREFIX}ACCESSORY`, name: "Universal Pistol Holster", type: "Holster", quantity: 24, safetyThreshold: 8, price: 12, priceCurrency: currency, priceValuation: valuation(12), retailPrice: 24, wholesalePrice: 20, retailPriceValuation: valuation(24), wholesalePriceValuation: valuation(20), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-45), location: { warehouse: "Main", shelf: "A", bin: "A-2" } },
      { id: `${PREFIX}ACC-002`, name: "Hard Rifle Case 42in", type: "Case", quantity: 7, safetyThreshold: 3, price: 48, priceCurrency: currency, priceValuation: valuation(48), retailPrice: 89, wholesalePrice: 78, retailPriceValuation: valuation(89), wholesalePriceValuation: valuation(78), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-42), location: { warehouse: "Main", shelf: "B", bin: "B-1" } },
      { id: `${PREFIX}ACC-003`, name: "Electronic Hearing Protection", type: "Safety", quantity: 3, safetyThreshold: 6, price: 36, priceCurrency: currency, priceValuation: valuation(36), retailPrice: 69, wholesalePrice: 60, retailPriceValuation: valuation(69), wholesalePriceValuation: valuation(60), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-15), location: { warehouse: "Secondary", shelf: "A", bin: "A-1" } },
    ]
    accessories.forEach((item) => { repo.insertAccessory(item); finalizeStandaloneInventoryCost("accessory", item.id, item.price, snapshot, [], userId) })

    const ammunition: Ammunition[] = [
      { id: `${PREFIX}AMMUNITION`, name: "9x19mm FMJ 124gr", caliber: "9x19", packageType: "Box", unitsPerPackage: 50, fullPackages: 18, looseRounds: 0, safetyThreshold: 500, price: 14, priceCurrency: currency, priceValuation: valuation(14), retailPrice: 22, wholesalePrice: 19, retailPriceValuation: valuation(22), wholesalePriceValuation: valuation(19), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-35), location: { warehouse: "Main", shelf: "B", bin: "B-1" } },
      { id: `${PREFIX}AMM-002`, name: "12 GA Target Load", caliber: "12 GA", packageType: "Box", unitsPerPackage: 25, fullPackages: 5, looseRounds: 0, safetyThreshold: 10, price: 9, priceCurrency: currency, priceValuation: valuation(9), retailPrice: 16, wholesalePrice: 14, retailPriceValuation: valuation(16), wholesalePriceValuation: valuation(14), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-28), location: { warehouse: "Main", shelf: "B", bin: "B-1" } },
      { id: `${PREFIX}AMM-003`, name: ".22 LR Standard Velocity", caliber: ".22 LR", packageType: "Box", unitsPerPackage: 50, fullPackages: 2, looseRounds: 15, safetyThreshold: 250, price: 6, priceCurrency: currency, priceValuation: valuation(6), retailPrice: 11, wholesalePrice: 9, retailPriceValuation: valuation(11), wholesalePriceValuation: valuation(9), retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-10), location: { warehouse: "Secondary", shelf: "A", bin: "A-1" } },
    ]
    ammunition.forEach((item) => { repo.insertAmmunition(item); finalizeStandaloneInventoryCost("ammunition", item.id, item.price, snapshot, [], userId) })

    const makeInvoice = (id: string, number: string, customer: Customer, date: string, dueDate: string, subtotal: number, paid: number, status: Invoice["status"], lineItems: Invoice["lineItems"], notes: string): Invoice => {
      const tax = Number((subtotal * repo.getSettings().taxPercent / 100).toFixed(snapshot.transactionPrecision))
      const total = subtotal + tax
      return { id: `${PREFIX}${id}`, invoiceNumber: number, type: "Sale", customerId: customer.id, supplierId: null, customerName: customer.name, date, dueDate, totalOriginal: subtotal, totalNegotiated: subtotal, totalPaid: paid, balance: total - paid, status, weaponIds: lineItems.filter((line) => line.itemType === "weapon").map((line) => line.itemId), lineItems, saleMode: customer.isWholesaleBuyer ? "Wholesale" : "Retail", employeeId: userId, employeeName: "Demo Administrator", attachments: [], shipmentId: null, notes, voided: false, taxAmount: tax, currency, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, totalOriginalAccounting: valuation(subtotal).accountingAmount, totalNegotiatedAccounting: valuation(subtotal).accountingAmount, totalPaidAccounting: valuation(paid).accountingAmount, balanceAccounting: valuation(total - paid).accountingAmount, taxAmountAccounting: valuation(tax).accountingAmount, totalValuation: valuation(total) }
    }
    const invoices = [
      makeInvoice("INVOICE", "DEMO-INV-1001", customers[0], dateOffset(-22), dateOffset(-22), 744, 744, "Paid", [{ itemType: "accessory", itemId: accessories[0].id, name: accessories[0].name, quantity: 1, unitPrice: 24, total: 24 }, { itemType: "ammunition", itemId: ammunition[0].id, name: ammunition[0].name ?? "", quantity: 30, unitPrice: 22, total: 660 }], "Paid at counter by card."),
      makeInvoice("INV-002", "DEMO-INV-1002", customers[1], dateOffset(-16), dateOffset(14), 845, 500, "Pending", [{ itemType: "weapon", itemId: weapons[1].id, name: "SIG Sauer P320", quantity: 1, unitPrice: 845, total: 845 }], "Commercial order with partial bank transfer."),
      makeInvoice("INV-003", "DEMO-INV-1003", customers[2], dateOffset(-48), dateOffset(-18), 1050, 0, "Overdue", [{ itemType: "weapon", itemId: weapons[4].id, name: "Benelli Supersport", quantity: 1, unitPrice: 1050, total: 1050 }], "Wholesale club balance is overdue."),
      makeInvoice("INV-004", "DEMO-INV-1004", customers[3], dateOffset(-4), dateOffset(26), 69, 0, "Pending", [{ itemType: "accessory", itemId: accessories[2].id, name: accessories[2].name, quantity: 1, unitPrice: 69, total: 69 }], "Customer requested payment on collection."),
      makeInvoice("INV-005", "DEMO-INV-1005", customers[1], dateOffset(-12), dateOffset(18), 845, 845, "Paid", [{ itemType: "weapon", itemId: weapons[6].id, name: "SIG Sauer P320", quantity: 1, unitPrice: 845, total: 845 }], "Paid in full by commercial bank transfer."),
      makeInvoice("INV-006", "DEMO-INV-1006", customers[4], dateOffset(-9), dateOffset(21), 1590, 800, "Pending", [{ itemType: "weapon", itemId: weapons[8].id, name: "Colt AR-15", quantity: 1, unitPrice: 1590, total: 1590 }], "Training center deposit; remaining balance is due."),
      makeInvoice("INV-007", "DEMO-INV-1007", customers[0], dateOffset(-35), dateOffset(-5), 295, 100, "Overdue", [{ itemType: "weapon", itemId: weapons[10].id, name: "Ekol Volga", quantity: 1, unitPrice: 295, total: 295 }], "Retail customer has an overdue balance."),
      makeInvoice("INV-008", "DEMO-INV-1008", customers[3], dateOffset(-7), dateOffset(23), 520, 0, "Pending", [{ itemType: "weapon", itemId: weapons[9].id, name: "Benjamin Trail", quantity: 1, unitPrice: 520, total: 520 }, { itemType: "accessory", itemId: accessories[0].id, name: accessories[0].name, quantity: 1, unitPrice: 24, total: 24 }], "New customer order awaiting collection."),
    ]
    invoices.forEach((invoice) => repo.insertInvoice(invoice))
    const payments: PaymentRecord[] = [
      { id: `${PREFIX}PAYMENT`, invoiceId: invoices[0].id, invoiceNumber: invoices[0].invoiceNumber, date: dateOffset(-22), amount: 744, currency, accountingAmount: valuation(744).accountingAmount, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, method: "card", employee: "Demo Administrator", notes: "Paid in full." },
      { id: `${PREFIX}PAY-002`, invoiceId: invoices[1].id, invoiceNumber: invoices[1].invoiceNumber, date: dateOffset(-15), amount: 500, currency, accountingAmount: valuation(500).accountingAmount, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, method: "bank_transfer", employee: "Demo Administrator", notes: "Initial deposit; remaining balance due." },
      { id: `${PREFIX}PAY-003`, invoiceId: invoices[4].id, invoiceNumber: invoices[4].invoiceNumber, date: dateOffset(-11), amount: 845, currency, accountingAmount: valuation(845).accountingAmount, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, method: "bank_transfer", employee: "Demo Administrator", notes: "Paid in full." },
      { id: `${PREFIX}PAY-004`, invoiceId: invoices[5].id, invoiceNumber: invoices[5].invoiceNumber, date: dateOffset(-8), amount: 800, currency, accountingAmount: valuation(800).accountingAmount, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, method: "card", employee: "Demo Administrator", notes: "Deposit received." },
      { id: `${PREFIX}PAY-005`, invoiceId: invoices[6].id, invoiceNumber: invoices[6].invoiceNumber, date: dateOffset(-34), amount: 100, currency, accountingAmount: valuation(100).accountingAmount, accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate, exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource, method: "cash", employee: "Demo Administrator", notes: "Partial payment; balance remains overdue." },
    ]
    payments.forEach((payment) => repo.insertPayment(payment))
    repo.insertAuditLog({ id: `${PREFIX}AUDIT`, timestamp: new Date().toISOString(), date: today, userId, actionType: "Import", description: "Demonstration dataset created", metadata: JSON.stringify({ demo: true }) })
    repo.insertNotification({ id: `${PREFIX}NOTIFICATION`, type: "System", title: "Demo data enabled", message: "This sample dataset can be reset or removed in Settings.", date: today, read: false, entityId: null })
    db.prepare("UPDATE system_settings SET show_demo_data = 1 WHERE id = 1").run()
  })()
}

export function ensureDemoData(userId: string): void {
  const db = getDb()
  const enabled = Number((db.prepare("SELECT show_demo_data FROM system_settings WHERE id = 1").get() as { show_demo_data: number }).show_demo_data) === 1
  const businessRows = Number((db.prepare("SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM accessories) + (SELECT count(*) FROM ammunition) AS count").get() as { count: number }).count)
  if (enabled && businessRows === 0) resetDemoData(userId)
}
