const MELO_BASE = 'https://api.melostore.id/api/v1/h2h';
const textEncoder = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}
function cleanUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function isTrue(value) { return String(value).toLowerCase() === 'true'; }
function randomCode() { return `RT-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; }
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function digestHex(algorithm, value) {
  const digest = await crypto.subtle.digest(algorithm, typeof value === 'string' ? textEncoder.encode(value) : value);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, raw, algorithm = 'SHA-256') {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, raw instanceof Uint8Array ? raw : textEncoder.encode(raw));
  return [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function basicAuth(secret) { return `Basic ${btoa(`${secret}:`)}`; }
function asText(value, max = 255) { return String(value ?? '').trim().slice(0, max); }
function intValue(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : fallback; }
function originAllowed(origin, env) {
  if (!origin) return true;
  const allowed = cleanUrl(env.APP_URL);
  if (allowed && origin === allowed) return true;
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true;
  try { return new URL(origin).hostname.endsWith('.netlify.app'); } catch { return false; }
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = originAllowed(origin, env) ? (origin || cleanUrl(env.APP_URL) || '*') : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function requireConfig(env) {
  const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','MELO_API_KEY','MELO_SECRET_KEY','MELO_WEBHOOK_SECRET','MIDTRANS_SERVER_KEY'];
  return required.filter(k => !env[k]);
}
function dbHeaders(env, prefer) {
  // Supabase sb_secret_* keys are opaque API keys, not JWTs.
  // Send them only in the apikey header; do not use them as Bearer tokens.
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}
async function dbRequest(env, path, options = {}) {
  const url = `${cleanUrl(env.SUPABASE_URL)}/rest/v1/${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { ...dbHeaders(env, options.prefer), ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || `Supabase returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return { data, headers: response.headers, status: response.status };
}
async function selectRows(env, table, query) {
  const path = `${table}?${query}`;
  return (await dbRequest(env, path)).data || [];
}
async function insertRows(env, table, rows, prefer = 'return=representation') {
  return (await dbRequest(env, table, { method: 'POST', body: rows, prefer })).data;
}
async function patchRows(env, table, query, values, prefer = 'return=representation') {
  return (await dbRequest(env, `${table}?${query}`, { method: 'PATCH', body: values, prefer })).data;
}
async function upsertRows(env, table, rows, onConflict) {
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return (await dbRequest(env, `${table}${query}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' })).data;
}
async function rpc(env, name, payload) {
  return (await dbRequest(env, `rpc/${name}`, { method: 'POST', body: payload, prefer: 'return=representation' })).data;
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const response = await fetch(`${cleanUrl(env.SUPABASE_URL)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}
async function requireUser(request, env) {
  const user = await authenticate(request, env);
  if (!user?.id) throw Object.assign(new Error('Silakan masuk terlebih dahulu.'), { status: 401 });
  return user;
}
async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  const profiles = await selectRows(env, 'rt_profiles', `id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`);
  if (profiles?.[0]?.role !== 'admin') throw Object.assign(new Error('Akses admin diperlukan.'), { status: 403 });
  return user;
}

async function meloFetch(env, path, options = {}) {
  const response = await fetch(`${MELO_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-Key': env.MELO_API_KEY,
      'X-Secret-Key': env.MELO_SECRET_KEY,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Melo returned HTTP ${response.status}`);
    err.status = response.status;
    err.provider = data;
    throw err;
  }
  return data;
}

async function syncMeloCatalogue(env) {
  const brandsResponse = await meloFetch(env, '/pricelists/categories');
  const brands = Array.isArray(brandsResponse.data) ? brandsResponse.data : [];
  const brandMap = new Map(brands.map(b => [String(b.brand_id), b]));
  let cursor = null;
  let imported = 0;
  let page = 0;
  await dbRequest(env, 'rt_products?status=neq.inactive', { method: 'PATCH', body: { status: 'inactive' }, prefer: 'return=minimal' });
  do {
    const params = new URLSearchParams({ limit: '500' });
    if (cursor) params.set('cursor', cursor);
    const response = await meloFetch(env, `/pricelists?${params.toString()}`);
    const data = Array.isArray(response.data) ? response.data : [];
    const forms = response.meta?.inquiry_forms || {};
    const mapped = data.map(p => {
      const brand = p.brand_id == null ? null : brandMap.get(String(p.brand_id));
      const formKey = p.inquiry_form_key || null;
      const form = formKey ? (forms[formKey] || {}) : {};
      return {
        sku_code: asText(p.sku_code, 100),
        product_name: asText(p.name, 200),
        brand_id: p.brand_id ?? null,
        brand_name: brand?.name || null,
        category_name: asText(p.category_name || brand?.category?.name || 'Lainnya', 100),
        type_name: asText(p.type_name || '', 100),
        provider_price: intValue(p.price),
        status: p.status === 'active' ? 'active' : (p.status === 'out_of_stock' ? 'out_of_stock' : 'inactive'),
        inquiry_form_key: formKey,
        inquiry_form: form,
        server_code: p.server_code || null,
        server_name: p.server_name || null,
        description: p.description || p.h2h_description || null,
        meta: { id: p.id ?? null, inquiry_form_key: formKey, server_code: p.server_code || null, server_name: p.server_name || null },
        synced_at: new Date().toISOString(),
      };
    }).filter(p => p.sku_code && p.product_name && p.provider_price > 0);
    for (let i = 0; i < mapped.length; i += 200) {
      await upsertRows(env, 'rt_products', mapped.slice(i, i + 200), 'sku_code');
      imported += mapped.slice(i, i + 200).length;
    }
    page += 1;
    const pagination = response.meta?.pagination || {};
    cursor = pagination.has_more ? pagination.next_cursor : null;
    if (page >= 30) break;
  } while (cursor);
  return { imported, brands: brands.length, pages: page };
}

async function currentMargin(env) {
  const settings = await selectRows(env, 'rt_store_settings', 'id=eq.1&select=margin_percent&limit=1');
  const value = Number(settings?.[0]?.margin_percent ?? env.DEFAULT_MARGIN_PERCENT ?? 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 10;
}
function midtransConfig(env) {
  const live = isTrue(env.MIDTRANS_IS_PRODUCTION);
  return {
    apiBase: live ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com',
    snapBase: live ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com',
    live,
  };
}
async function midtransRequest(env, path, options = {}) {
  const config = midtransConfig(env);
  const response = await fetch(`${config.apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: basicAuth(env.MIDTRANS_SERVER_KEY),
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const err = new Error(data?.status_message || data?.message || `Midtrans returned HTTP ${response.status}`);
    err.status = response.status;
    err.provider = data;
    throw err;
  }
  return data;
}
async function getMidtransStatus(env, orderCode) {
  return midtransRequest(env, `/v2/${encodeURIComponent(orderCode)}/status`);
}
async function createSnapTransaction(env, order, email) {
  const config = midtransConfig(env);
  const payload = {
    transaction_details: { order_id: order.order_code, gross_amount: order.selling_price },
    item_details: [{ id: order.sku_code.slice(0, 50), price: order.selling_price, quantity: 1, name: order.product_name.slice(0, 50) }],
    customer_details: { email: email || undefined },
    callbacks: { finish: `${cleanUrl(env.APP_URL)}/?order=${encodeURIComponent(order.order_code)}` },
    expiry: { unit: 'minutes', duration: 30 },
  };
  const response = await fetch(`${config.snapBase}/snap/v1/transactions`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env.MIDTRANS_SERVER_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok || !data.token) throw new Error(data?.error_messages?.join(', ') || data?.status_message || `Midtrans Snap HTTP ${response.status}`);
  return data;
}

async function createOrder(request, env, user) {
  const body = await request.json();
  const sku = asText(body.sku_code, 100);
  let target = asText(body.target, 255);
  let zone = asText(body.target_zone, 100) || null;
  if (!sku || !target) throw Object.assign(new Error('Produk dan User ID/nomor tujuan wajib diisi.'), { status: 400 });
  const products = await selectRows(env, 'rt_products', `sku_code=eq.${encodeURIComponent(sku)}&select=*&limit=1`);
  const product = products?.[0];
  if (!product || product.status !== 'active') throw Object.assign(new Error('Produk tidak tersedia. Muat ulang katalog.'), { status: 409 });
  const formFields = Array.isArray(product.inquiry_form?.fields) ? product.inquiry_form.fields : [];
  const targetField = formFields[0];
  const zoneField = formFields[1];
  const isMl = `${product.brand_name || ''} ${product.product_name || ''}`.toLowerCase().includes('mobile legends');
  if ((zoneField?.required || isMl) && !zone) throw Object.assign(new Error(`${zoneField?.name || 'Zone ID'} wajib diisi untuk produk ini.`), { status: 400 });
  if (Array.isArray(targetField?.options) && targetField.options.length && !targetField.options.some(option => String(option.value) === target)) {
    throw Object.assign(new Error(`${targetField.name || 'Tujuan'} tidak sesuai pilihan produk.`), { status: 400 });
  }
  if (zone && Array.isArray(zoneField?.options) && zoneField.options.length) {
    const matchedZone = zoneField.options.find(option => String(option.value) === zone);
    if (!matchedZone) throw Object.assign(new Error(`${zoneField.name || 'Zone ID'} tidak sesuai pilihan produk.`), { status: 400 });
    zone = String(matchedZone.value);
  }
  const suppliedAdditional = body.additional_data && typeof body.additional_data === 'object' && !Array.isArray(body.additional_data) ? body.additional_data : {};
  const additionalData = {};
  for (const field of formFields.slice(2)) {
    const key = asText(field.key, 100);
    if (!key) continue;
    const rawValue = suppliedAdditional[key];
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (field.required && !value) throw Object.assign(new Error(`${field.name || key} wajib diisi.`), { status: 400 });
    if (!value) continue;
    if (value.length > 500) throw Object.assign(new Error(`Nilai ${field.name || key} terlalu panjang.`), { status: 400 });
    if (Array.isArray(field.options) && field.options.length) {
      const allowed = field.options.some(option => String(option.value) === value);
      if (!allowed) throw Object.assign(new Error(`Pilihan ${field.name || key} tidak valid.`), { status: 400 });
      const matching = field.options.find(option => String(option.value) === value);
      additionalData[key] = matching.value;
    } else {
      additionalData[key] = value;
    }
  }
  const margin = await currentMargin(env);
  const providerPrice = intValue(product.provider_price);
  const sellingPrice = Math.ceil(providerPrice * (1 + margin / 100));
  if (sellingPrice < 1) throw Object.assign(new Error('Harga produk tidak valid.'), { status: 400 });
  const orderCode = randomCode();
  const inserted = await insertRows(env, 'rt_orders', {
    order_code: orderCode,
    user_id: user.id,
    customer_email: user.email || null,
    sku_code: product.sku_code,
    product_name: product.product_name,
    category_name: product.category_name,
    target,
    target_zone: zone,
    additional_data: additionalData,
    provider_price: providerPrice,
    selling_price: sellingPrice,
    margin_percent: margin,
  });
  const order = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!order?.id) throw new Error('Pesanan tidak berhasil disimpan ke database.');
  try {
    const snap = await createSnapTransaction(env, order, user.email);
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { midtrans_token: snap.token, midtrans_redirect_url: snap.redirect_url || null });
    return { order: { ...order, midtrans_redirect_url: snap.redirect_url }, snap_token: snap.token, order_code: orderCode };
  } catch (error) {
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { payment_status: 'failed', error_message: `Midtrans: ${error.message}` });
    throw Object.assign(new Error(`Gagal membuat pembayaran Midtrans: ${error.message}`), { status: 502 });
  }
}

async function tryFulfillOrder(env, orderId) {
  const claim = await rpc(env, 'claim_order_for_melo', { p_order_id: orderId });
  const order = Array.isArray(claim) ? claim[0] : claim;
  if (!order?.id) return { claimed: false };
  const payload = {
    sku_code: order.sku_code,
    customer_target: order.target,
    customer_target_zone: order.target_zone || undefined,
    additional_data: order.additional_data && Object.keys(order.additional_data).length ? order.additional_data : undefined,
    buyer_trx_id: order.order_code,
    sandbox_mode: isTrue(env.MELO_SANDBOX_MODE),
  };
  try {
    const result = await meloFetch(env, '/transaction', { method: 'POST', body: payload });
    const tx = result.data || {};
    const status = ['success','failed'].includes(tx.status) ? tx.status : 'processing';
    if (tx.action?.type === 'two_factor' && Number.isSafeInteger(tx.action.version)) {
      await rpc(env, 'update_melo_action', { p_order_id: order.id, p_action: tx.action });
    }
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
      melo_transaction_id: tx.id || null,
      melo_status: tx.status || 'processing',
      fulfillment_status: status,
      serial_number: tx.serial_number || null,
      error_code: tx.error_code || null,
      error_message: tx.message || null,
      completed_at: status === 'success' || status === 'failed' ? new Date().toISOString() : null,
    });
    if (status === 'failed') await attemptRefund(env, { ...order, midtrans_payment_type: order.midtrans_payment_type });
    return { claimed: true, status };
  } catch (error) {
    // A definitive validation/auth rejection means Melo did not queue an order; an ambiguous timeout does not.
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { fulfillment_status: 'failed', melo_status: 'failed', error_code: String(error.status), error_message: error.message, completed_at: new Date().toISOString() });
      await attemptRefund(env, order);
      return { claimed: true, status: 'failed' };
    }
    // Melo documents buyer_trx_id as idempotent; reconcile with the same reference before retrying.
    try {
      const lookup = await meloFetch(env, `/transaction/${encodeURIComponent(order.order_code)}`);
      const tx = lookup.data || {};
      const status = tx.status === 'success' ? 'success' : tx.status === 'failed' ? 'failed' : 'processing';
      await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
        melo_transaction_id: tx.id || null,
        melo_status: tx.status || 'processing',
        fulfillment_status: status,
        serial_number: tx.serial_number || null,
        error_code: tx.error_code || null,
        error_message: tx.message || null,
      });
      if (status === 'failed') await attemptRefund(env, { ...order });
      return { claimed: true, status, reconciled: true };
    } catch (lookupError) {
      await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
        fulfillment_status: 'manual_review',
        error_message: `Melo request outcome uncertain. Check buyer_trx_id ${order.order_code}. ${error.message}`,
      });
      return { claimed: true, status: 'manual_review' };
    }
  }
}

async function setRefundRequestState(env, orderId, state, note = null) {
  const requests = await selectRows(env, 'rt_refund_requests', `order_id=eq.${encodeURIComponent(orderId)}&select=id&order=created_at.desc&limit=10`).catch(() => []);
  for (const request of requests) await patchRows(env, 'rt_refund_requests', `id=eq.${request.id}`, { status: state, admin_note: note }).catch(() => null);
}

async function attemptRefund(env, order) {
  try {
    const status = await getMidtransStatus(env, order.order_code);
    const providerStatus = status.transaction_status;
    if (providerStatus !== 'settlement') {
      await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
        payment_status: 'refund_pending', refund_status: 'manual_required',
        midtrans_transaction_status: providerStatus || null,
        error_message: 'Top-up gagal. Status pembayaran belum dapat direfund otomatis; admin perlu memeriksa dashboard Midtrans.',
      });
      await setRefundRequestState(env, order.id, 'manual_required', 'Perlu proses refund manual.');
      return { submitted: false, manual: true };
    }
    const refundKey = order.refund_key || `RF-${order.order_code}`;
    const result = await midtransRequest(env, `/v2/${encodeURIComponent(order.order_code)}/refund`, {
      method: 'POST',
      body: { refund_key: refundKey, amount: intValue(order.selling_price), reason: 'Top-up gagal dipenuhi oleh penyedia' },
    });
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
      payment_status: 'refund_pending', refund_status: 'submitted', refund_key: refundKey,
      refund_reference: result.refund_key || result.refund_id || null,
    });
    await setRefundRequestState(env, order.id, 'submitted', 'Permintaan refund diteruskan ke Midtrans; menunggu konfirmasi provider.');
    return { submitted: true };
  } catch (error) {
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
      payment_status: 'refund_pending', refund_status: 'manual_required',
      error_message: `Refund API tidak berhasil: ${error.message}. Periksa kelayakan metode pembayaran dan proses manual bila diperlukan.`,
    });
    await setRefundRequestState(env, order.id, 'manual_required', error.message);
    return { submitted: false, manual: true, message: error.message };
  }
}

async function handleMidtransWebhook(request, env) {
  const raw = await request.text();
  let notification;
  try { notification = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const signature = asText(notification.signature_key, 200);
  const expected = await digestHex('SHA-512', `${notification.order_id || ''}${notification.status_code || ''}${notification.gross_amount || ''}${env.MIDTRANS_SERVER_KEY}`);
  if (!safeEqual(signature.toLowerCase(), expected.toLowerCase())) return json({ error: 'Invalid Midtrans signature' }, 401);
  if (!notification.order_id) return json({ error: 'Missing order_id' }, 400);
  // Verify the transaction status against Midtrans rather than trusting the callback body alone.
  const verified = await getMidtransStatus(env, notification.order_id);
  const orders = await selectRows(env, 'rt_orders', `order_code=eq.${encodeURIComponent(notification.order_id)}&select=*&limit=1`);
  const order = orders?.[0];
  if (!order) return json({ ok: true, ignored: 'unknown order' });
  const paidAmount = Math.round(Number(verified.gross_amount));
  if (!Number.isFinite(paidAmount) || paidAmount !== intValue(order.selling_price)) {
    await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { fulfillment_status: 'manual_review', error_message: 'Jumlah pembayaran Midtrans tidak sama dengan total pesanan. Perlu pemeriksaan admin.' });
    return json({ error: 'Transaction amount mismatch' }, 409);
  }
  const eventKey = `${verified.transaction_id || notification.order_id}:${verified.transaction_status || 'unknown'}:${verified.status_code || notification.status_code || ''}`;
  await insertRows(env, 'rt_payment_events', { event_key: eventKey, order_code: notification.order_id, event_payload: verified }).catch(() => null);
  const paymentStatus = verified.transaction_status === 'settlement' || (verified.transaction_status === 'capture' && verified.fraud_status === 'accept')
    ? 'paid'
    : verified.transaction_status === 'expire' ? 'expired'
      : ['cancel','deny'].includes(verified.transaction_status) ? 'failed'
        : verified.transaction_status === 'refund' && (notification.bank_confirmed_at || verified.bank_confirmed_at) ? 'refunded'
          : verified.transaction_status === 'refund' || verified.transaction_status === 'partial_refund' ? 'refund_pending' : 'pending';
  await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
    payment_status: paymentStatus,
    midtrans_transaction_id: verified.transaction_id || null,
    midtrans_payment_type: verified.payment_type || null,
    midtrans_transaction_status: verified.transaction_status || null,
    paid_at: paymentStatus === 'paid' ? (order.paid_at || new Date().toISOString()) : order.paid_at,
    refund_status: paymentStatus === 'refunded' ? 'refunded' : order.refund_status,
  });
  if (paymentStatus === 'refunded') await setRefundRequestState(env, order.id, 'refunded', 'Refund dikonfirmasi Midtrans.');
  if (paymentStatus === 'paid') await tryFulfillOrder(env, order.id);
  return json({ ok: true });
}

async function handleMeloWebhook(request, env) {
  const raw = new Uint8Array(await request.arrayBuffer());
  const signature = asText(request.headers.get('X-H2H-Signature'), 200).toLowerCase();
  const expected = await hmacHex(env.MELO_WEBHOOK_SECRET, raw, 'SHA-256');
  if (!safeEqual(signature, expected)) return json({ error: 'Invalid Melo signature' }, 401);
  let event;
  try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const orderCode = asText(event.buyer_trx_id, 64);
  const txId = asText(event.id, 100);
  const actionEvent = event.event === 'transaction.action_change';
  const eventKey = asText(actionEvent ? `action:${event.event_id}:${event.action?.version}` : `${txId}:${event.status || 'final'}`, 180);
  await insertRows(env, 'rt_melo_events', { event_key: eventKey, order_code: orderCode || null, event_payload: event }).catch(() => null);
  if (!orderCode) return json({ ok: true, ignored: true });
  const orders = await selectRows(env, 'rt_orders', `order_code=eq.${encodeURIComponent(orderCode)}&select=*&limit=1`);
  const order = orders?.[0];
  if (!order) return json({ ok: true, ignored: 'unknown order' });
  if (actionEvent) {
    const a = event.action || {};
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const valid = validUuid.test(String(event.event_id || '')) && validUuid.test(String(a.id || '')) && a.type === 'two_factor' && Number.isSafeInteger(a.version) && a.version > 0 && ['required','submitted','resolved'].includes(a.state) && a.can_submit === (a.state === 'required') && typeof a.message === 'string' && event.need_action === (a.state === 'required') && ['pending','processing','success','failed'].includes(event.status);
    if (!valid) return json({ error: 'Invalid Melo customer-action event' }, 422);
    await rpc(env, 'update_melo_action', { p_order_id: order.id, p_action: a });
    return json({ ok: true, action_saved: true });
  }
  if (event.action?.id && Number.isSafeInteger(event.action.version)) {
    await rpc(env, 'update_melo_action', { p_order_id: order.id, p_action: event.action });
  }
  if (!['success','failed'].includes(event.status)) return json({ ok: true, ignored: 'non-final status' });
  const state = event.status;
  await patchRows(env, 'rt_orders', `id=eq.${order.id}`, {
    melo_transaction_id: txId || order.melo_transaction_id,
    melo_status: state,
    fulfillment_status: state,
    serial_number: event.serial_number || null,
    error_code: event.error_code || null,
    error_message: event.message || null,
    completed_at: new Date().toISOString(),
  });
  if (state === 'failed') await attemptRefund(env, { ...order, ...event, id: order.id });
  return json({ ok: true });
}

async function submitMeloTwoFactor(request, env, user, orderId) {
  const body = await request.json();
  const code = asText(body.code, 128);
  if (!code || /[\u0000-\u001f\u007f]/.test(code)) throw Object.assign(new Error('Kode verifikasi tidak valid.'), { status: 400 });
  const orders = await selectRows(env, 'rt_orders', `id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,order_code,melo_action,fulfillment_status&limit=1`);
  const order = orders?.[0];
  if (!order) throw Object.assign(new Error('Pesanan tidak ditemukan.'), { status: 404 });
  const action = order.melo_action || {};
  if (action.type !== 'two_factor' || action.state !== 'required' || action.can_submit !== true) throw Object.assign(new Error('Pesanan saat ini tidak meminta kode verifikasi.'), { status: 409 });
  const result = await meloFetch(env, '/transactions/2fa', { method: 'POST', body: { buyer_trx_id: order.order_code, code, action_id: action.id, action_version: action.version } });
  const latestAction = { ...action, state: 'submitted', can_submit: false, message: result.message || 'Kode diterima dan menunggu penanganan penyedia.' };
  await rpc(env, 'update_melo_action', { p_order_id: order.id, p_action: latestAction });
  return { accepted: true, message: 'Kode diterima untuk penanganan penyedia. Ini belum berarti kode sudah divalidasi.' };
}

async function listOrdersForUser(env, user) {
  return selectRows(env, 'rt_orders', `user_id=eq.${encodeURIComponent(user.id)}&select=id,order_code,product_name,category_name,target,target_zone,selling_price,payment_status,fulfillment_status,refund_status,serial_number,error_message,melo_action,created_at,paid_at,completed_at&order=created_at.desc&limit=100`);
}
async function createRefundRequest(request, env, user, orderId) {
  const body = await request.json();
  const reason = asText(body.reason, 500);
  if (!reason) throw Object.assign(new Error('Alasan refund wajib diisi.'), { status: 400 });
  const orders = await selectRows(env, 'rt_orders', `id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,fulfillment_status,payment_status&limit=1`);
  if (!orders?.[0]) throw Object.assign(new Error('Pesanan tidak ditemukan.'), { status: 404 });
  if (orders[0].fulfillment_status !== 'failed' || !['paid','refund_pending'].includes(orders[0].payment_status)) {
    throw Object.assign(new Error('Refund hanya dapat diminta untuk pembayaran sukses dengan top-up yang gagal.'), { status: 409 });
  }
  const existing = await selectRows(env, 'rt_refund_requests', `order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&status=in.(requested,approved,submitted,manual_required)&select=id&limit=1`);
  if (existing.length) return { id: existing[0].id, exists: true };
  const inserted = await insertRows(env, 'rt_refund_requests', { order_id: orderId, user_id: user.id, reason });
  await patchRows(env, 'rt_orders', `id=eq.${encodeURIComponent(orderId)}`, { refund_status: 'requested' });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}
async function adminOrderList(env) {
  return selectRows(env, 'rt_orders', 'select=*&order=created_at.desc&limit=200');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/health' && request.method === 'GET') {
        const missing = requireConfig(env);
        return json({ ok: missing.length === 0, service: 'ryuutopup-api', mode: isTrue(env.MIDTRANS_IS_PRODUCTION) ? 'midtrans-live' : 'midtrans-sandbox', melo_mode: isTrue(env.MELO_SANDBOX_MODE) ? 'sandbox' : 'live', missing_configuration: missing }, missing.length ? 503 : 200, cors);
      }
      if (path === '/api/webhooks/midtrans' && request.method === 'POST') return handleMidtransWebhook(request, env);
      if (path === '/api/webhooks/melo' && request.method === 'POST') return handleMeloWebhook(request, env);
      const missing = requireConfig(env);
      if (missing.length) return json({ error: 'Backend belum dikonfigurasi.', missing_configuration: missing }, 503, cors);

      if (path === '/api/catalog' && request.method === 'GET') {
        let products = await selectRows(env, 'rt_products', 'status=eq.active&select=sku_code,product_name,brand_id,brand_name,category_name,type_name,provider_price,inquiry_form_key,inquiry_form,server_code,server_name,description&order=category_name.asc,brand_name.asc,provider_price.asc&limit=1000');
        if (!products.length) {
          await syncMeloCatalogue(env);
          products = await selectRows(env, 'rt_products', 'status=eq.active&select=sku_code,product_name,brand_id,brand_name,category_name,type_name,provider_price,inquiry_form_key,inquiry_form,server_code,server_name,description&order=category_name.asc,brand_name.asc,provider_price.asc&limit=1000');
        }
        const margin = await currentMargin(env);
        const result = products.map(p => ({ ...p, selling_price: Math.ceil(intValue(p.provider_price) * (1 + margin / 100)), margin_percent: margin }));
        return json({ products: result, margin_percent: margin, count: result.length }, 200, cors);
      }

      if (path === '/api/me' && request.method === 'GET') {
        const user = await requireUser(request, env);
        const rows = await selectRows(env, 'rt_profiles', `id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`);
        return json({ user: { id: user.id, email: user.email }, profile: rows[0] || null }, 200, cors);
      }
      if (path === '/api/orders' && request.method === 'GET') {
        const user = await requireUser(request, env);
        return json({ orders: await listOrdersForUser(env, user) }, 200, cors);
      }
      if (path === '/api/orders' && request.method === 'POST') {
        const user = await requireUser(request, env);
        return json(await createOrder(request, env, user), 201, cors);
      }
      const twoFactorMatch = path.match(/^\/api\/orders\/([0-9a-f-]+)\/2fa$/i);
      if (twoFactorMatch && request.method === 'POST') {
        const user = await requireUser(request, env);
        return json(await submitMeloTwoFactor(request, env, user, twoFactorMatch[1]), 202, cors);
      }
      const refundMatch = path.match(/^\/api\/orders\/([0-9a-f-]+)\/refund$/i);
      if (refundMatch && request.method === 'POST') {
        const user = await requireUser(request, env);
        return json({ refund_request: await createRefundRequest(request, env, user, refundMatch[1]) }, 201, cors);
      }

      if (path === '/api/admin/catalog/sync' && request.method === 'POST') {
        await requireAdmin(request, env);
        const result = await syncMeloCatalogue(env);
        return json({ ok: true, ...result }, 200, cors);
      }
      if (path === '/api/admin/orders' && request.method === 'GET') {
        await requireAdmin(request, env);
        return json({ orders: await adminOrderList(env) }, 200, cors);
      }
      if (path === '/api/admin/refund-requests' && request.method === 'GET') {
        await requireAdmin(request, env);
        const requests = await selectRows(env, 'rt_refund_requests', 'select=*&order=created_at.desc&limit=100');
        return json({ refund_requests: requests }, 200, cors);
      }
      const adminRefundMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]+)\/refund$/i);
      if (adminRefundMatch && request.method === 'POST') {
        await requireAdmin(request, env);
        const orders = await selectRows(env, 'rt_orders', `id=eq.${encodeURIComponent(adminRefundMatch[1])}&select=*&limit=1`);
        const order = orders?.[0];
        if (!order) return json({ error: 'Pesanan tidak ditemukan.' }, 404, cors);
        if (order.payment_status !== 'paid' || order.fulfillment_status !== 'failed') return json({ error: 'Refund hanya dapat dilakukan untuk pembayaran sukses dengan top-up gagal.' }, 409, cors);
        const outcome = await attemptRefund(env, order);
        return json({ ok: outcome.submitted, outcome }, 200, cors);
      }
      const markRefundMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]+)\/mark-refunded$/i);
      if (markRefundMatch && request.method === 'POST') {
        await requireAdmin(request, env);
        const body = await request.json();
        const reference = asText(body.reference, 160);
        if (!reference) return json({ error: 'Nomor referensi refund wajib diisi.' }, 400, cors);
        const orders = await selectRows(env, 'rt_orders', `id=eq.${encodeURIComponent(markRefundMatch[1])}&select=*&limit=1`);
        const order = orders?.[0];
        if (!order) return json({ error: 'Pesanan tidak ditemukan.' }, 404, cors);
        if (order.fulfillment_status !== 'failed' || !['paid','refund_pending'].includes(order.payment_status)) return json({ error: 'Hanya pesanan top-up gagal yang dapat ditandai refund.' }, 409, cors);
        await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { payment_status: 'refunded', refund_status: 'refunded', refund_reference: reference });
        await setRefundRequestState(env, order.id, 'refunded', `Refund manual diselesaikan. Referensi: ${reference}`);
        return json({ ok: true }, 200, cors);
      }
      const retryMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]+)\/reconcile$/i);
      if (retryMatch && request.method === 'POST') {
        await requireAdmin(request, env);
        const orders = await selectRows(env, 'rt_orders', `id=eq.${encodeURIComponent(retryMatch[1])}&select=*&limit=1`);
        const order = orders?.[0];
        if (!order) return json({ error: 'Pesanan tidak ditemukan.' }, 404, cors);
        if (order.payment_status !== 'paid') return json({ error: 'Pembayaran belum terkonfirmasi.' }, 409, cors);
        // Query Melo by the stable buyer reference; never submit a new provider order from this action.
        const result = await meloFetch(env, `/transaction/${encodeURIComponent(order.order_code)}`);
        const tx = result.data || {};
        const state = tx.status === 'success' ? 'success' : tx.status === 'failed' ? 'failed' : 'processing';
        await patchRows(env, 'rt_orders', `id=eq.${order.id}`, { melo_transaction_id: tx.id || order.melo_transaction_id, melo_status: tx.status || null, fulfillment_status: state, serial_number: tx.serial_number || null, error_code: tx.error_code || null, error_message: tx.message || null });
        if (state === 'failed') await attemptRefund(env, order);
        return json({ ok: true, status: state }, 200, cors);
      }
      if (path === '/api/admin/summary' && request.method === 'GET') {
        await requireAdmin(request, env);
        const orders = await selectRows(env, 'rt_orders', 'select=payment_status,fulfillment_status,refund_status,selling_price,created_at&limit=1000');
        const summary = orders.reduce((a, o) => {
          a.total += 1;
          if (o.payment_status === 'paid') a.paid += 1;
          if (o.fulfillment_status === 'success') a.success += 1;
          if (o.fulfillment_status === 'failed') a.failed += 1;
          if (o.refund_status === 'manual_required') a.manual_refund += 1;
          if (o.payment_status === 'paid') a.revenue += intValue(o.selling_price);
          return a;
        }, { total: 0, paid: 0, success: 0, failed: 0, manual_refund: 0, revenue: 0 });
        return json({ summary }, 200, cors);
      }
      return json({ error: 'Endpoint tidak ditemukan.' }, 404, cors);
    } catch (error) {
      const status = Number(error.status) || 500;
      return json({ error: error.message || 'Terjadi kesalahan pada server.' }, status, cors);
    }
  },
};
