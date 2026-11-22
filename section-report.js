/* Section report — one page per business section (Printing Press, PVC, CTP, Internal Inventory, Accounts)
   for any date range (today / yesterday / week / month / custom). Returns summary figures + detail tables;
   the browser prints it or saves it as CSV / Excel. Read-only: nothing here changes data. */
'use strict';

module.exports = function installSectionReport(h) {
  const { app, q, q1, wrap, bad } = h, PAID_SQL = h.paidSql;
  const iso = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));
  const M = (k, label, extra = {}) => ({ k, label, money: true, n: true, total: true, ...extra });
  const N = (k, label, extra = {}) => ({ k, label, n: true, total: true, ...extra });
  const T = (k, label) => ({ k, label });
  const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + (+r[k] || 0), 0) * 100) / 100;

  /* collection = payments received against this section's invoices (by payment date) */
  async function collection(div, from, to) {
    const tbl = { ctp: 'ctp_invoices', pvc: 'pvc_invoices', press: 'press_invoices' }[div];
    const rows = await q(`SELECT p.date, p.receipt_no, c.name customer, i.inv_no invoice, p.method, pa.amount
      FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id JOIN customers c ON c.id=p.customer_id LEFT JOIN ${tbl} i ON i.id=pa.invoice_id
      WHERE pa.division=$1 AND NOT p.voided AND p.date BETWEEN $2 AND $3 ${div === 'press' ? 'AND p.order_id IS NULL' : ''} ORDER BY p.date, p.id`, [div, from, to]);
    if (div === 'press') {   // order advances / payments taken against an order count in full on the day received
      rows.push(...await q(`SELECT p.date, p.receipt_no, c.name customer, COALESCE(o.order_no,'') invoice, p.method, p.amount
        FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN press_orders o ON o.id=p.order_id
        WHERE p.order_id IS NOT NULL AND NOT p.voided AND p.date BETWEEN $1 AND $2 ORDER BY p.date, p.id`, [from, to]));
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    return rows;
  }
  const expenses = (div, from, to) => q(`SELECT date, category, COALESCE(description,'') description, COALESCE(method,'') method, amount, created_by_name entered_by
    FROM expenses WHERE NOT voided AND division=$1 AND date BETWEEN $2 AND $3 ORDER BY date, id`, [div, from, to]);
  const payTable = rows => ({ title: 'Payments received', columns: [T('date', 'Date'), T('receipt_no', 'Receipt'), T('customer', 'Customer'), T('invoice', 'Invoice / order'), T('method', 'Method'), M('amount', 'Amount')], rows });
  const expTable = rows => ({ title: 'Expenses', columns: [T('date', 'Date'), T('category', 'Category'), T('description', 'Details'), T('method', 'Method'), T('entered_by', 'By'), M('amount', 'Amount')], rows });
  const invCols = qtyCol => [T('date', 'Date'), T('inv_no', 'Invoice'), T('customer', 'Customer'), ...(qtyCol ? [qtyCol] : []), M('grand_total', 'Amount'), M('paid', 'Paid'), M('due', 'Due'), T('status', 'Status')];

  const BUILD = {
    async ctp(from, to) {
      const inv = await q(`SELECT i.date, i.inv_no, c.name customer, (SELECT COALESCE(SUM(qty),0)::int FROM ctp_invoice_items WHERE invoice_id=i.id) plates,
          i.grand_total, ${PAID_SQL('ctp')} paid, i.status FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id
        WHERE i.date BETWEEN $1 AND $2 AND i.status<>'draft' ORDER BY i.date, i.id`, [from, to]);
      inv.forEach(r => { r.paid = +r.paid; r.due = r.status === 'cancelled' ? 0 : Math.max(0, +r.grand_total - r.paid); if (r.status === 'cancelled') { r.grand_total = 0; r.plates = 0; } });
      const stock = await q(`SELECT p.name plate,
          COALESCE(SUM(m.qty) FILTER (WHERE m.date < $1),0)::int opening,
          COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('opening','production','stock_in') AND m.date BETWEEN $1 AND $2),0)::int produced,
          -COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('sale','challan_out') AND m.date BETWEEN $1 AND $2),0)::int sold,
          -COALESCE(SUM(m.qty) FILTER (WHERE m.type='own_use' AND m.date BETWEEN $1 AND $2),0)::int own_use,
          COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('adj_in','adj_out') AND m.date BETWEEN $1 AND $2),0)::int adjust,
          COALESCE(SUM(m.qty) FILTER (WHERE m.date <= $2),0)::int closing
        FROM ctp_products p LEFT JOIN ctp_stock_movements m ON m.product_id=p.id WHERE NOT p.deleted GROUP BY p.id ORDER BY p.sort, p.id`, [from, to]);
      const own = await q(`SELECT m.date, p.name plate, -m.qty qty, COALESCE(m.purpose,'') purpose, COALESCE(m.job_ref,'') job, m.created_by_name entered_by
        FROM ctp_stock_movements m JOIN ctp_products p ON p.id=m.product_id WHERE m.type='own_use' AND m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`, [from, to]);
      const dc = await q(`SELECT ch.date, ch.dc_no, COALESCE(c.name,'') customer, COALESCE(ch.receiver,'') receiver, (SELECT COALESCE(SUM(qty),0) FROM challan_items WHERE challan_id=ch.id) qty, ch.status
        FROM challans ch LEFT JOIN customers c ON c.id=ch.customer_id WHERE ch.division='ctp' AND ch.date BETWEEN $1 AND $2 ORDER BY ch.date, ch.id`, [from, to]);
      const pay = await collection('ctp', from, to), exp = await expenses('ctp', from, to);
      const live = inv.filter(r => r.status !== 'cancelled');
      return {
        summary: [['Sales', sum(live, 'grand_total'), 'money'], ['Invoices', live.length], ['Plates sold', sum(stock, 'sold')], ['Plates produced', sum(stock, 'produced')],
          ['Own use (plates)', sum(stock, 'own_use')], ['Collection', sum(pay, 'amount'), 'money'], ['Expenses', sum(exp, 'amount'), 'money'], ['Cancelled invoices', inv.length - live.length]],
        tables: [
          { title: 'Sales invoices', columns: invCols(N('plates', 'Plates')), rows: inv },
          { title: 'Plate stock', columns: [T('plate', 'Plate'), N('opening', 'Opening', { total: true }), N('produced', 'Produced / in'), N('sold', 'Sold'), N('own_use', 'Own use'), N('adjust', 'Adjust ±'), N('closing', 'Closing')], rows: stock },
          { title: 'Own use', columns: [T('date', 'Date'), T('plate', 'Plate'), N('qty', 'Qty'), T('purpose', 'Purpose'), T('job', 'Job'), T('entered_by', 'By')], rows: own },
          { title: 'Delivery challans', columns: [T('date', 'Date'), T('dc_no', 'Challan'), T('customer', 'Customer'), T('receiver', 'Receiver'), N('qty', 'Qty'), T('status', 'Status')], rows: dc },
          payTable(pay), expTable(exp)],
      };
    },

    async pvc(from, to) {
      const inv = await q(`SELECT i.date, i.inv_no, c.name customer, (SELECT COALESCE(SUM(sqft),0) FROM pvc_invoice_items WHERE invoice_id=i.id) sqft,
          i.grand_total, ${PAID_SQL('pvc')} paid, i.status FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id
        WHERE i.date BETWEEN $1 AND $2 AND i.status<>'draft' ORDER BY i.date, i.id`, [from, to]);
      inv.forEach(r => { r.paid = +r.paid; r.sqft = +r.sqft; r.due = r.status === 'cancelled' ? 0 : Math.max(0, +r.grand_total - r.paid); if (r.status === 'cancelled') { r.grand_total = 0; r.sqft = 0; } });
      const prints = await q(`SELECT e.date, COALESCE(c.name,'') customer, COALESCE(e.job_name,'') job, m.category || ' ' || (m.width_ft::float) || ' ft' media,
          (e.art_w::float) || '×' || (e.art_l::float) size, e.qty, e.printed_sqft sqft, e.used_length used_ft, e.wastage_length wastage_ft, e.created_by_name entered_by
        FROM pvc_print_entries e JOIN pvc_media m ON m.id=e.media_id LEFT JOIN customers c ON c.id=e.customer_id WHERE NOT e.voided AND e.date BETWEEN $1 AND $2 ORDER BY e.date, e.id`, [from, to]);
      const stock = await q(`SELECT m.category || ' ' || (m.width_ft::float) || ' ft' media,
          COALESCE(SUM(s.length_ft) FILTER (WHERE s.date < $1),0)::float opening,
          COALESCE(SUM(s.length_ft) FILTER (WHERE s.type IN ('opening','stock_in') AND s.date BETWEEN $1 AND $2),0)::float stock_in,
          -COALESCE(SUM(s.length_ft) FILTER (WHERE s.type IN ('print','challan_out') AND s.date BETWEEN $1 AND $2),0)::float printed,
          -COALESCE(SUM(s.length_ft) FILTER (WHERE s.type='wastage' AND s.date BETWEEN $1 AND $2),0)::float wastage,
          COALESCE(SUM(s.length_ft) FILTER (WHERE s.type IN ('adj_in','adj_out') AND s.date BETWEEN $1 AND $2),0)::float adjust,
          COALESCE(SUM(s.length_ft) FILTER (WHERE s.date <= $2),0)::float closing
        FROM pvc_media m LEFT JOIN pvc_stock_movements s ON s.media_id=m.id WHERE NOT m.deleted GROUP BY m.id ORDER BY m.category, m.width_ft`, [from, to]);
      const ink = await q(`SELECT color, COALESCE(SUM(liters) FILTER (WHERE date < $1),0)::float opening, COALESCE(SUM(liters) FILTER (WHERE liters>0 AND date BETWEEN $1 AND $2),0)::float added,
          COALESCE(-SUM(liters) FILTER (WHERE liters<0 AND date BETWEEN $1 AND $2),0)::float used, COALESCE(SUM(liters) FILTER (WHERE date <= $2),0)::float closing
        FROM pvc_ink_stock GROUP BY color ORDER BY color`, [from, to]);
      const dc = await q(`SELECT ch.date, ch.dc_no, COALESCE(c.name,'') customer, COALESCE(ch.receiver,'') receiver, (SELECT COALESCE(SUM(sqft),0) FROM challan_items WHERE challan_id=ch.id) sqft, ch.status
        FROM challans ch LEFT JOIN customers c ON c.id=ch.customer_id WHERE ch.division='pvc' AND ch.date BETWEEN $1 AND $2 ORDER BY ch.date, ch.id`, [from, to]);
      const pay = await collection('pvc', from, to), exp = await expenses('pvc', from, to);
      const live = inv.filter(r => r.status !== 'cancelled');
      return {
        summary: [['Sales', sum(live, 'grand_total'), 'money'], ['Invoices', live.length], ['Billed sq ft', sum(live, 'sqft')], ['Printed sq ft', sum(prints, 'sqft')],
          ['Media used (ft)', sum(stock, 'printed')], ['Wastage (ft)', sum(stock, 'wastage')], ['Ink used (ltr)', sum(ink, 'used')], ['Collection', sum(pay, 'amount'), 'money'], ['Expenses', sum(exp, 'amount'), 'money']],
        tables: [
          { title: 'Sales invoices', columns: invCols(N('sqft', 'Sq ft')), rows: inv },
          { title: 'Print entries', columns: [T('date', 'Date'), T('customer', 'Customer'), T('job', 'Job'), T('media', 'Media'), T('size', 'Size (ft)'), N('qty', 'Qty'), N('sqft', 'Sq ft'), N('used_ft', 'Used ft'), N('wastage_ft', 'Wastage ft'), T('entered_by', 'By')], rows: prints },
          { title: 'Media stock (linear ft)', columns: [T('media', 'Media'), N('opening', 'Opening'), N('stock_in', 'Stock in'), N('printed', 'Printed'), N('wastage', 'Wastage'), N('adjust', 'Adjust ±'), N('closing', 'Closing')], rows: stock },
          { title: 'Ink stock (litre)', columns: [T('color', 'Colour'), N('opening', 'Opening'), N('added', 'Added'), N('used', 'Used'), N('closing', 'Closing')], rows: ink },
          { title: 'Delivery challans', columns: [T('date', 'Date'), T('dc_no', 'Challan'), T('customer', 'Customer'), T('receiver', 'Receiver'), N('sqft', 'Sq ft'), T('status', 'Status')], rows: dc },
          payTable(pay), expTable(exp)],
      };
    },

    async press(from, to) {
      const orders = await q(`SELECT o.date, o.order_no, c.name customer, (SELECT string_agg(product || ' ×' || (qty::float), ', ' ORDER BY sl) FROM press_items WHERE order_id=o.id) products,
          o.deadline, o.total, o.status, COALESCE(o.officer_name,'') officer FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.date BETWEEN $1 AND $2 ORDER BY o.date, o.id`, [from, to]);
      orders.forEach(r => { if (r.status === 'cancelled') r.total = 0; });
      const inv = await q(`SELECT i.date, i.inv_no, c.name customer, o.order_no, i.grand_total, ${PAID_SQL('press')} paid, i.status FROM press_invoices i JOIN customers c ON c.id=i.customer_id JOIN press_orders o ON o.id=i.order_id
        WHERE i.date BETWEEN $1 AND $2 ORDER BY i.date, i.id`, [from, to]);
      inv.forEach(r => { r.paid = +r.paid; r.due = r.status === 'final' ? Math.max(0, +r.grand_total - r.paid) : 0; if (r.status !== 'final') r.grand_total = 0; });
      const dc = await q(`SELECT ch.date, ch.dc_no, c.name customer, o.order_no, (SELECT string_agg(it.product || ' ×' || (ci.qty::float), ', ') FROM press_challan_items ci JOIN press_items it ON it.id=ci.item_id WHERE ci.challan_id=ch.id) items,
          COALESCE(ch.receiver,'') receiver, ch.status FROM press_challans ch JOIN customers c ON c.id=ch.customer_id JOIN press_orders o ON o.id=ch.order_id WHERE ch.date BETWEEN $1 AND $2 ORDER BY ch.date, ch.id`, [from, to]);
      const issues = await q(`SELECT s.date, s.issue_no, COALESCE(o.order_no,'') order_no, g.name item, l.qty, COALESCE(l.unit, g.unit) unit, round(l.qty*l.unit_cost,2) cost, COALESCE(s.received_by,'') received_by
        FROM press_issues s JOIN press_issue_lines l ON l.issue_id=s.id JOIN gen_items g ON g.id=l.stock_item_id LEFT JOIN press_orders o ON o.id=s.order_id
        WHERE NOT s.voided AND s.date BETWEEN $1 AND $2 ORDER BY s.date, s.id`, [from, to]);
      const steps = await q(`SELECT (s->>'date')::date date, o.order_no, it.product, s->>'name' step, COALESCE(s->>'by','') by_name
        FROM press_items it JOIN press_orders o ON o.id=it.order_id, jsonb_array_elements(COALESCE(it.steps,'[]'::jsonb)) s
        WHERE (s->>'done')::boolean AND s->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (s->>'date')::date BETWEEN $1 AND $2 AND o.status<>'cancelled' ORDER BY 1, o.id`, [from, to]);
      const pur = await q(`SELECT date, pur_no, COALESCE(supplier_name,'') supplier, COALESCE(bill_ref,'') bill, total FROM store_purchases WHERE NOT voided AND date BETWEEN $1 AND $2 ORDER BY date, id`, [from, to]);
      const pay = await collection('press', from, to), exp = await expenses('press', from, to);
      const liveO = orders.filter(r => r.status !== 'cancelled'), liveI = inv.filter(r => r.status === 'final');
      const overdue = await q1(`SELECT COUNT(*)::int n FROM press_orders WHERE deadline < $1 AND status NOT IN ('delivered','invoiced','cancelled')`, [to]);
      return {
        summary: [['New orders', liveO.length], ['Order value', sum(liveO, 'total'), 'money'], ['Final invoices', liveI.length], ['Invoiced', sum(liveI, 'grand_total'), 'money'],
          ['Deliveries (challans)', dc.filter(d => d.status === 'active').length], ['Material issued (cost)', sum(issues, 'cost'), 'money'], ['Collection', sum(pay, 'amount'), 'money'],
          ['Expenses', sum(exp, 'amount'), 'money'], ['Overdue orders now', overdue.n]],
        tables: [
          { title: 'Orders received', columns: [T('date', 'Date'), T('order_no', 'Order'), T('customer', 'Customer'), T('products', 'Products'), T('deadline', 'Deadline'), M('total', 'Value'), T('status', 'Status'), T('officer', 'Officer')], rows: orders },
          { title: 'Final invoices', columns: [T('date', 'Date'), T('inv_no', 'Invoice'), T('customer', 'Customer'), T('order_no', 'Order'), M('grand_total', 'Amount'), M('paid', 'Paid'), M('due', 'Due'), T('status', 'Status')], rows: inv },
          { title: 'Delivery challans', columns: [T('date', 'Date'), T('dc_no', 'Challan'), T('customer', 'Customer'), T('order_no', 'Order'), T('items', 'Delivered'), T('receiver', 'Receiver'), T('status', 'Status')], rows: dc },
          { title: 'Production work done', columns: [T('date', 'Date'), T('order_no', 'Order'), T('product', 'Product'), T('step', 'Step done'), T('by_name', 'Entered by')], rows: steps },
          { title: 'Material issued', columns: [T('date', 'Date'), T('issue_no', 'Issue slip'), T('order_no', 'Order'), T('item', 'Item'), N('qty', 'Qty'), T('unit', 'Unit'), M('cost', 'Cost'), T('received_by', 'Received by')], rows: issues },
          { title: 'Store purchases', columns: [T('date', 'Date'), T('pur_no', 'Purchase'), T('supplier', 'Supplier'), T('bill', 'Bill ref'), M('total', 'Amount')], rows: pur },
          payTable(pay), expTable(exp)],
      };
    },

    async internal(from, to) {
      const stock = await q(`SELECT i.name item, i.unit,
          COALESCE(SUM(m.qty) FILTER (WHERE m.date < $1),0)::float opening,
          COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('opening','stock_in') AND m.date BETWEEN $1 AND $2),0)::float stock_in,
          -COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('use','job') AND m.date BETWEEN $1 AND $2),0)::float used,
          -COALESCE(SUM(m.qty) FILTER (WHERE m.type='wastage' AND m.date BETWEEN $1 AND $2),0)::float wastage,
          COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('adj_in','adj_out') AND m.date BETWEEN $1 AND $2),0)::float adjust,
          COALESCE(SUM(m.qty) FILTER (WHERE m.date <= $2),0)::float closing
        FROM gen_items i LEFT JOIN gen_moves m ON m.item_id=i.id WHERE i.kind='internal' AND NOT i.deleted GROUP BY i.id ORDER BY i.sort, i.name`, [from, to]);
      const moves = await q(`SELECT m.date, i.name item, m.type, m.qty::float qty, i.unit, COALESCE(m.purpose, m.party, m.remarks, '') details, m.created_by_name entered_by
        FROM gen_moves m JOIN gen_items i ON i.id=m.item_id WHERE i.kind='internal' AND m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`, [from, to]);
      const TY = { opening: 'Opening', stock_in: 'Stock in', use: 'Own use', job: 'Job', wastage: 'Wastage', adj_in: 'Adjust +', adj_out: 'Adjust −' };
      moves.forEach(m => { m.type = TY[m.type] || m.type; });
      return {
        summary: [['Items', stock.length], ['Stock-in entries', moves.filter(m => m.type === 'Stock in').length], ['Use entries', moves.filter(m => m.type === 'Own use').length], ['Low stock items', (await q(`SELECT 1 FROM gen_items i WHERE i.kind='internal' AND NOT i.deleted AND i.low_stock>0 AND (SELECT COALESCE(SUM(qty),0) FROM gen_moves WHERE item_id=i.id) <= i.low_stock`)).length]],
        tables: [
          { title: 'Item stock', columns: [T('item', 'Item'), T('unit', 'Unit'), N('opening', 'Opening', { total: false }), N('stock_in', 'In', { total: false }), N('used', 'Used', { total: false }), N('wastage', 'Wastage', { total: false }), N('adjust', 'Adjust ±', { total: false }), N('closing', 'Closing', { total: false })], rows: stock },
          { title: 'All entries', columns: [T('date', 'Date'), T('item', 'Item'), T('type', 'Type'), N('qty', 'Qty', { total: false }), T('unit', 'Unit'), T('details', 'Purpose / from'), T('entered_by', 'By')], rows: moves }],
      };
    },

    async accounts(from, to) {
      const pay = await q(`SELECT p.date, p.receipt_no, c.name customer, COALESCE(p.method,'') method, COALESCE(p.reference,'') reference, p.amount, p.created_by_name entered_by
        FROM payments p JOIN customers c ON c.id=p.customer_id WHERE NOT p.voided AND p.date BETWEEN $1 AND $2 ORDER BY p.date, p.id`, [from, to]);
      const ref = await q(`SELECT r.date, r.refund_no, c.name customer, COALESCE(r.method,'') method, r.reason, r.amount FROM refunds r JOIN customers c ON c.id=r.customer_id
        WHERE NOT r.voided AND r.date BETWEEN $1 AND $2 ORDER BY r.date, r.id`, [from, to]);
      const exp = await q(`SELECT date, category, division section, COALESCE(description,'') description, COALESCE(method,'') method, amount FROM expenses WHERE NOT voided AND date BETWEEN $1 AND $2 ORDER BY date, id`, [from, to]);
      const byMethod = {}; pay.forEach(p => { byMethod[p.method || 'Other'] = (byMethod[p.method || 'Other'] || 0) + +p.amount; });
      const collected = sum(pay, 'amount'), refunded = sum(ref, 'amount'), spent = sum(exp, 'amount');
      return {
        summary: [['Money received', collected, 'money'], ['Refunded', refunded, 'money'], ['Expenses', spent, 'money'], ['Net cash', Math.round((collected - refunded - spent) * 100) / 100, 'money'],
          ...Object.entries(byMethod).map(([k, v]) => [`Received by ${k}`, Math.round(v * 100) / 100, 'money'])],
        tables: [
          { title: 'Payments received', columns: [T('date', 'Date'), T('receipt_no', 'Receipt'), T('customer', 'Customer'), T('method', 'Method'), T('reference', 'Reference'), T('entered_by', 'By'), M('amount', 'Amount')], rows: pay },
          { title: 'Refunds paid', columns: [T('date', 'Date'), T('refund_no', 'Refund'), T('customer', 'Customer'), T('method', 'Method'), T('reason', 'Reason'), M('amount', 'Amount')], rows: ref },
          { title: 'Expenses (all sections)', columns: [T('date', 'Date'), T('category', 'Category'), T('section', 'Section'), T('description', 'Details'), T('method', 'Method'), M('amount', 'Amount')], rows: exp }],
      };
    },
  };
  const TITLES = { press: 'Printing Press', pvc: 'PVC / Media', ctp: 'CTP', internal: 'Internal Inventory', accounts: 'Accounts (all sections)' };
  /* who may see which section: the same people who work in it (or anyone with Reports) */
  /* these reports show money (sales, collection, expenses) → only roles with the Reports permission; the section itself must be one the user works in */
  const PERM = { press: ['press.view', 'press.orders', 'press.store', 'press.invoice'], pvc: ['pvc.view', 'pvc.invoice', 'pvc.print'], ctp: ['ctp.view', 'ctp.invoice'], internal: ['internal'], accounts: ['accounts.view', 'payments'] };

  app.get('/api/section-report/:sec', wrap(async (req, res, next) => {
    const sec = req.params.sec;
    if (!BUILD[sec]) bad('Unknown section', 404);
    if (!req.user.perms.includes('reports') || !PERM[sec].some(p => req.user.perms.includes(p))) bad('You need the Reports permission for this report', 403);
    const off = (await q1(`SELECT value->'off' off FROM settings WHERE key='sections'`))?.off || [];
    if (off.includes(sec)) bad(`The ${TITLES[sec]} section is switched off (Settings → Sections)`, 403);
    const { from, to } = req.query;
    if (!iso(from) || !iso(to)) bad('Pick a valid date range');
    if (from > to) bad('"From" date is after "To" date');
    const r = await BUILD[sec](from, to);
    res.json({ section: sec, title: TITLES[sec], from, to, generated_at: new Date().toISOString(), generated_by: req.user.full_name, ...r });
  }));
  h.SECTION_TITLES = TITLES;
};
