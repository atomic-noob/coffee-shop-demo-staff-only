import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Coffee, Plus, Minus, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "./supabaseClient";

const INK = "#0B1D2A";
const SURFACE = "#142B3D";
const OCEAN = "#1E8FA6";
const GOLD = "#F2C14E";
const CREAM = "#EAF3F7";
const MUTED = "#7C93A6";
const PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Card"];
const STATUSES = ["new", "preparing", "ready", "completed"];
const STATUS_COLOR = { new: GOLD, preparing: "#4FA3D1", ready: "#6FBF73", completed: MUTED };

function peso(n) {
  return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function App() {
  const [view, setView] = useState("order"); // "order" | "pending"

  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeCat, setActiveCat] = useState(null);

  const [order, setOrder] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lastOrderNo, setLastOrderNo] = useState(null);

  const [customerName, setCustomerName] = useState("");
  const [orderType, setOrderType] = useState("Dine-in");
  const [tableNumber, setTableNumber] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentRefNumber, setPaymentRefNumber] = useState("");
  const [hasDiscountCard, setHasDiscountCard] = useState(false);
  const [discountCardNumber, setDiscountCardNumber] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    let channel;

    async function loadMenu() {
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("is_available", true)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });

      if (error) {
        setLoadError(error.message);
      } else {
        setMenu(data);
        if (data.length > 0) setActiveCat((c) => c ?? data[0].category);
      }
      setLoading(false);
    }

    loadMenu();

    channel = supabase
      .channel("staff-pos-menu")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, loadMenu)
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .gte("created_at", startOfToday())
      .order("created_at", { ascending: false });

    if (!error) setOrders(data);
    setOrdersLoading(false);
  }, []);

  useEffect(() => {
    loadOrders();

    const channel = supabase
      .channel("staff-pos-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, loadOrders)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadOrders]);

  const pendingOrders = useMemo(() => orders.filter((o) => o.status !== "completed"), [orders]);

  const categories = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu]);

  const items = useMemo(
    () =>
      Object.entries(order)
        .map(([id, qty]) => ({ ...menu.find((m) => m.id === id), qty }))
        .filter((i) => i.qty > 0 && i.id),
    [order, menu]
  );

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discountAmount = hasDiscountCard ? subtotal * 0.2 : 0;
  const total = subtotal - discountAmount;
  const isCash = paymentMethod === "Cash";

  function addItem(id) {
    setOrder((o) => ({ ...o, [id]: (o[id] || 0) + 1 }));
    setLastOrderNo(null);
  }
  function changeQty(id, delta) {
    setOrder((o) => ({ ...o, [id]: Math.max(0, (o[id] || 0) + delta) }));
  }
  function clearOrder() {
    setOrder({});
    setCustomerName("");
    setOrderType("Dine-in");
    setTableNumber("");
    setContactNumber("");
    setPaymentMethod("Cash");
    setPaymentRefNumber("");
    setHasDiscountCard(false);
    setDiscountCardNumber("");
    setAlreadyPaid(false);
  }

  const canSubmit =
    items.length > 0 &&
    customerName.trim().length > 0 &&
    paymentMethod &&
    (orderType === "Takeout" || tableNumber.trim().length > 0) &&
    (isCash || paymentRefNumber.trim().length > 0) &&
    (!hasDiscountCard || discountCardNumber.trim().length > 0);

  async function submitOrder() {
    if (!canSubmit) return;
    setSubmitting(true);

    const { data: newOrder, error: orderErr } = await supabase
      .from("orders")
      .insert({
        status: "new",
        source: "staff",
        customer_name: customerName.trim(),
        contact_number: contactNumber.trim() || null,
        order_type: orderType,
        table_number: orderType === "Dine-in" ? tableNumber.trim() : null,
        payment_method: paymentMethod,
        payment_ref_number: isCash ? null : paymentRefNumber.trim(),
        has_discount_card: hasDiscountCard,
        discount_card_number: hasDiscountCard ? discountCardNumber.trim() : null,
        subtotal,
        discount_amount: discountAmount,
        total,
        is_paid: alreadyPaid,
      })
      .select()
      .single();

    if (orderErr) {
      alert("Could not submit order: " + orderErr.message);
      setSubmitting(false);
      return;
    }

    const lineItems = items.map((i) => ({
      order_id: newOrder.id,
      menu_item_id: i.id,
      name: i.name,
      price: i.price,
      qty: i.qty,
      line_total: i.price * i.qty,
    }));

    const { error: itemsErr } = await supabase.from("order_items").insert(lineItems);

    if (itemsErr) {
      alert("Order was created but items failed to save: " + itemsErr.message);
    } else {
      setLastOrderNo(newOrder.order_no);
      clearOrder();
    }
    setSubmitting(false);
  }

  async function updateOrderField(orderId, field, value) {
    const { error } = await supabase.from("orders").update({ [field]: value }).eq("id", orderId);
    if (error) alert(`Couldn't update ${field}: ` + error.message);
  }

  async function applyDiscountCard(o) {
    const cardNumber = window.prompt("Discount card number (check the physical card first):");
    if (!cardNumber || !cardNumber.trim()) return;
    const sub = Number(o.subtotal ?? o.total);
    const discount_amount = Math.round(sub * 0.2 * 100) / 100;
    const { error } = await supabase
      .from("orders")
      .update({ has_discount_card: true, discount_card_number: cardNumber.trim(), discount_amount, total: sub - discount_amount })
      .eq("id", o.id);
    if (error) alert("Couldn't apply discount: " + error.message);
  }

  async function removeDiscountCard(o) {
    const sub = Number(o.subtotal ?? o.total);
    const { error } = await supabase
      .from("orders")
      .update({ has_discount_card: false, discount_card_number: null, discount_amount: 0, total: sub })
      .eq("id", o.id);
    if (error) alert("Couldn't remove discount: " + error.message);
  }

  async function editRefNumber(o) {
    const val = window.prompt("Payment reference number:", o.payment_ref_number || "");
    if (val === null) return;
    const { error } = await supabase.from("orders").update({ payment_ref_number: val.trim() || null }).eq("id", o.id);
    if (error) alert("Couldn't update reference number: " + error.message);
  }

  return (
    <div style={{ background: INK, color: CREAM, fontFamily: "'Work Sans', sans-serif" }} className="min-h-screen w-full">
      <header
        className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8"
        style={{ background: INK, borderBottom: `1px solid ${SURFACE}` }}
      >
        <div className="flex items-center gap-2">
          <Coffee size={22} color={GOLD} />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }} className="text-xl md:text-2xl">
            KAPEHAN SA KANTO &middot; STAFF POS
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full p-1" style={{ background: SURFACE }}>
            <button
              onClick={() => setView("order")}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: view === "order" ? OCEAN : "transparent", color: view === "order" ? "#fff" : CREAM }}
            >
              New Order
            </button>
            <button
              onClick={() => setView("pending")}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: view === "pending" ? OCEAN : "transparent", color: view === "pending" ? "#fff" : CREAM }}
            >
              Pending Orders {pendingOrders.length > 0 ? `(${pendingOrders.length})` : ""}
            </button>
          </div>
          {lastOrderNo && (
            <span className="text-xs font-semibold" style={{ color: "#6FBF73" }}>
              #{lastOrderNo} submitted &check;
            </span>
          )}
        </div>
      </header>

      {view === "order" ? (
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_380px] md:p-6">
          <div>
            {loading && <p style={{ color: MUTED }}>Loading menu&hellip;</p>}
            {loadError && (
              <p style={{ color: "#E15029" }} className="text-sm">
                Couldn't load the menu ({loadError}). Check your .env values.
              </p>
            )}

            {!loading && !loadError && (
              <>
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCat(cat)}
                      className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors"
                      style={{ background: activeCat === cat ? GOLD : SURFACE, color: activeCat === cat ? INK : CREAM }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {menu
                    .filter((m) => m.category === activeCat)
                    .map((item) => (
                      <button
                        key={item.id}
                        onClick={() => addItem(item.id)}
                        className="flex flex-col items-start rounded-lg p-3 text-left transition-transform hover:scale-[1.02] active:scale-95"
                        style={{ background: SURFACE }}
                      >
                        <span className="text-sm font-semibold" style={{ color: CREAM }}>
                          {item.name}
                        </span>
                        <span className="mt-1 text-sm" style={{ fontFamily: "'JetBrains Mono', monospace", color: GOLD }}>
                          {peso(item.price)}
                        </span>
                        {order[item.id] > 0 && (
                          <span className="mt-2 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: OCEAN, color: "#fff" }}>
                            {order[item.id]} in order
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg p-4 md:sticky md:top-20 md:h-fit" style={{ background: SURFACE }}>
            <div className="mb-2 flex items-center justify-between">
              <h2 style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-xl">
                Current Order
              </h2>
              {items.length > 0 && (
                <button onClick={clearOrder} aria-label="Clear order" className="text-xs" style={{ color: MUTED }}>
                  <Trash2 size={14} className="inline" /> clear
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="py-6 text-center text-sm" style={{ color: MUTED }}>
                Tap items from the menu to start an order.
              </p>
            ) : (
              <div className="mb-3 space-y-2">
                {items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span>{i.name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeQty(i.id, -1)} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: INK }}>
                        <Minus size={12} />
                      </button>
                      <span className="w-4 text-center">{i.qty}</span>
                      <button onClick={() => changeQty(i.id, 1)} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: INK }}>
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <>
                <div className="my-3 border-t" style={{ borderColor: INK }} />

                <div className="space-y-3 text-sm">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="w-full rounded-md px-3 py-2 text-sm"
                    style={{ background: INK, color: CREAM, border: "none" }}
                  />

                  <div className="flex gap-2">
                    {["Dine-in", "Takeout"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setOrderType(opt)}
                        className="flex-1 rounded-md py-2 text-xs font-semibold"
                        style={{ background: orderType === opt ? OCEAN : INK, color: orderType === opt ? "#fff" : CREAM }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>

                  {orderType === "Dine-in" && (
                    <input
                      type="text"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      placeholder="Table number"
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{ background: INK, color: CREAM, border: "none" }}
                    />
                  )}

                  <input
                    type="tel"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="Contact number (optional)"
                    className="w-full rounded-md px-3 py-2 text-sm"
                    style={{ background: INK, color: CREAM, border: "none" }}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPaymentMethod(p)}
                        className="rounded-md py-2 text-xs font-semibold"
                        style={{ background: paymentMethod === p ? OCEAN : INK, color: paymentMethod === p ? "#fff" : CREAM }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  {!isCash && (
                    <input
                      type="text"
                      value={paymentRefNumber}
                      onChange={(e) => setPaymentRefNumber(e.target.value)}
                      placeholder={`${paymentMethod} reference number`}
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{ background: INK, color: CREAM, border: "none" }}
                    />
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={hasDiscountCard} onChange={(e) => setHasDiscountCard(e.target.checked)} />
                    Discount card (20% off) &mdash; check the card first
                  </label>
                  {hasDiscountCard && (
                    <input
                      type="text"
                      value={discountCardNumber}
                      onChange={(e) => setDiscountCardNumber(e.target.value)}
                      placeholder="Card number"
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{ background: INK, color: CREAM, border: "none" }}
                    />
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} />
                    Payment already received
                  </label>
                </div>

                <div className="my-3 border-t" style={{ borderColor: INK }} />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{peso(subtotal)}</span>
                  </div>
                  {hasDiscountCard && (
                    <div className="flex justify-between" style={{ color: GOLD }}>
                      <span>Discount (20%)</span>
                      <span>&minus;{peso(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold">
                    <span>TOTAL</span>
                    <span>{peso(total)}</span>
                  </div>
                </div>

                <button
                  disabled={!canSubmit || submitting}
                  onClick={submitOrder}
                  className="mt-4 w-full rounded-md py-3 text-sm font-bold uppercase tracking-wide disabled:opacity-40"
                  style={{ background: OCEAN, color: "#fff" }}
                >
                  {submitting ? "Submitting..." : "Submit order"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl">
              Pending Orders
            </h2>
            <button
              onClick={loadOrders}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ background: SURFACE, color: CREAM }}
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {ordersLoading && <p style={{ color: MUTED }}>Loading&hellip;</p>}

          {!ordersLoading && pendingOrders.length === 0 && (
            <p className="text-sm" style={{ color: MUTED }}>
              Nothing pending right now &mdash; new orders (from here or the customer site) will show up automatically.
            </p>
          )}

          <div className="space-y-3">
            {pendingOrders.map((o) => (
              <div key={o.id} className="rounded-lg p-4" style={{ background: SURFACE }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }} className="text-sm font-bold">
                      #{o.order_no}
                    </span>
                    {o.customer_name && (
                      <span className="ml-2 text-sm font-semibold" style={{ color: GOLD }}>
                        {o.customer_name}
                      </span>
                    )}
                    <span className="ml-3 text-xs" style={{ color: MUTED }}>
                      {new Date(o.created_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: GOLD }} className="text-sm font-bold">
                      {peso(o.total)}
                    </span>
                    <select
                      value={o.status}
                      onChange={(e) => updateOrderField(o.id, "status", e.target.value)}
                      className="rounded-full px-3 py-1 text-xs font-semibold capitalize focus:outline-none focus-visible:ring-2"
                      style={{ background: STATUS_COLOR[o.status] || MUTED, color: INK, border: "none" }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
                  {o.order_type && (
                    <span className="rounded-full px-2 py-0.5" style={{ background: INK }}>
                      {o.order_type}
                      {o.order_type === "Dine-in" && o.table_number ? ` \u00b7 ${o.table_number}` : ""}
                    </span>
                  )}
                  {o.source && (
                    <span className="rounded-full px-2 py-0.5" style={{ background: INK }}>
                      via {o.source}
                    </span>
                  )}
                  {o.contact_number && <span>{o.contact_number}</span>}
                  {o.has_discount_card ? (
                    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold" style={{ background: GOLD, color: INK }}>
                      discount card {o.discount_card_number ? `#${o.discount_card_number}` : ""}
                      <button onClick={() => removeDiscountCard(o)} aria-label="Remove discount" className="font-bold">
                        &times;
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => applyDiscountCard(o)} className="underline" style={{ color: GOLD }}>
                      + Apply discount card
                    </button>
                  )}
                  {!o.is_paid && (o.status === "ready" || o.status === "completed") && (
                    <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: "#E15029", color: "#fff" }}>
                      &#9888; UNPAID
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span style={{ color: MUTED }}>Payment:</span>
                  <select
                    value={o.payment_method || ""}
                    onChange={(e) => updateOrderField(o.id, "payment_method", e.target.value)}
                    className="rounded-full px-2 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2"
                    style={{ background: INK, color: CREAM, border: "none" }}
                  >
                    <option value="" disabled>
                      not set
                    </option>
                    {PAYMENT_METHODS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {o.payment_method && o.payment_method !== "Cash" && (
                    <button onClick={() => editRefNumber(o)} className="underline" style={{ color: MUTED }}>
                      ref: {o.payment_ref_number || "add ref#"}
                    </button>
                  )}
                  {o.discount_amount > 0 && (
                    <span style={{ color: MUTED }}>
                      (subtotal {peso(o.subtotal)}, &minus;{peso(o.discount_amount)} discount)
                    </span>
                  )}
                  <button
                    onClick={() => updateOrderField(o.id, "is_paid", !o.is_paid)}
                    className="ml-auto rounded-full px-3 py-1 text-xs font-bold"
                    style={{ background: o.is_paid ? "#6FBF73" : "#E15029", color: "#fff" }}
                  >
                    {o.is_paid ? "\u2713 Paid" : "Mark as Paid"}
                  </button>
                </div>

                <ul className="mt-2 space-y-0.5 text-xs" style={{ color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                  {(o.order_items || []).map((li) => (
                    <li key={li.id}>
                      {li.qty}&times; {li.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}