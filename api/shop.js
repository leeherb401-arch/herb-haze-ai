// ============================================================
// Herb Haze AI — Shopify Integration (2025 OAuth method)
// Uses Client Credentials to get access token automatically
// ============================================================

let cachedToken = null;
let tokenExpiry = 0;

async function getShopifyToken() {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const store     = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';
  const clientId  = process.env.SHOPIFY_CLIENT_ID;
  const clientSec = process.env.SHOPIFY_CLIENT_SECRET;

  // Accept any Shopify token format - shpat_, atkn_, shpca_ all work
  const directToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (directToken && (
    directToken.startsWith('shpat_') ||
    directToken.startsWith('atkn_')  ||
    directToken.startsWith('shpca_') ||
    directToken.startsWith('shpua_')
  )) {
    return directToken;
  }

  // Try client credentials grant (correct 2026 format - urlencoded not JSON)
  if (clientId && clientSec) {
    try {
      // Must use x-www-form-urlencoded NOT json
      const body = new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSec,
      }).toString();

      const res = await fetch(`https://${store}/admin/oauth/access_token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      const text = await res.text();
      console.log('[Shopify token response]', res.status, text.slice(0, 200));

      let data;
      try { data = JSON.parse(text); } catch { data = {}; }

      if (data.access_token) {
        cachedToken = data.access_token;
        tokenExpiry = Date.now() + (50 * 60 * 1000);
        return cachedToken;
      }
      console.error('[Shopify token] No access_token in response:', data);
    } catch (e) {
      console.error('[Shopify token]', e.message);
    }
  }

  // Fallback to whatever token we have
  return process.env.SHOPIFY_ACCESS_TOKEN || process.env.APIEASE_KEY || null;
}

async function shopifyRequest(path, method = 'GET', body = null) {
  const store = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';
  const token = await getShopifyToken();

  if (!token) throw new Error('No Shopify token available. Add SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET to Vercel.');

  const opts = {
    method,
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': token,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`https://${store}/admin/api/2024-01${path}`, opts);
  const data = await res.json();

  if (!res.ok) throw new Error(data.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`);
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, product, orderId } = req.body;

  // ── Create product in Shopify ────────────────────────────
  if (action === 'shopify_create_product') {
    try {
      const p = product;
      const sellPrice = parseFloat(p.sellPrice || p.cost * 2.5 || 19.99).toFixed(2);
      const compareAt  = (parseFloat(sellPrice) * 1.3).toFixed(2);

      const data = await shopifyRequest('/products.json', 'POST', {
        product: {
          title:        p.name,
          body_html:    `<p>${p.description || 'Quality product with fast shipping.'}</p>
                         <ul>${(p.tags||[]).slice(0,4).map(t => `<li>${t}</li>`).join('')}</ul>`,
          vendor:       'Herb Haze Studios',
          product_type: p.niche || 'General',
          tags:         (p.tags || []).join(', ') + ', dropship, trending',
          status:       'active',
          variants: [{
            price:              sellPrice,
            compare_at_price:   compareAt,
            inventory_management: 'shopify',
            inventory_quantity: 999,
            fulfillment_service: 'manual',
          }],
        },
      });

      return res.status(200).json({
        success:    true,
        productId:  data.product.id,
        productUrl: `https://${process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com'}/products/${data.product.handle}`,
        adminUrl:   `https://${process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com'}/admin/products/${data.product.id}`,
        title:      data.product.title,
      });

    } catch (err) {
      console.error('[Create product]', err.message);
      return res.status(200).json({
        success: false,
        error:   err.message,
        hint:    'Make sure SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set in Vercel env vars',
      });
    }
  }

  // ── Get orders from Shopify ──────────────────────────────
  if (action === 'shopify_get_orders') {
    try {
      const data = await shopifyRequest('/orders.json?status=any&limit=20');
      return res.status(200).json({
        success: true,
        orders:  (data.orders || []).map(o => ({
          id:         o.id,
          name:       o.name,
          total:      o.total_price,
          customer:   o.shipping_address?.name || o.email,
          status:     o.fulfillment_status || 'unfulfilled',
          createdAt:  o.created_at,
          lineItems:  o.line_items?.map(li => ({
            name:     li.name,
            quantity: li.quantity,
            price:    li.price,
          })),
        })),
      });
    } catch (err) {
      console.error('[Get orders]', err.message);
      return res.status(200).json({ success: false, error: err.message, orders: [] });
    }
  }

  // ── Get products from Shopify ────────────────────────────
  if (action === 'shopify_get_products') {
    try {
      const data = await shopifyRequest('/products.json?limit=20&status=active');
      return res.status(200).json({
        success:  true,
        products: (data.products || []).map(p => ({
          id:     p.id,
          title:  p.title,
          status: p.status,
          price:  p.variants?.[0]?.price,
          image:  p.image?.src,
          handle: p.handle,
        })),
      });
    } catch (err) {
      return res.status(200).json({ success: false, error: err.message, products: [] });
    }
  }

  // ── CJDropshipping: Search products ─────────────────────
  if (action === 'cj_search') {
    try {
      const { keyword } = req.body;

      const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: process.env.CJ_EMAIL, password: process.env.CJ_PASSWORD }),
      });
      const tokenData = await tokenRes.json();
      const cjToken   = tokenData.data?.accessToken;

      if (!cjToken) return res.status(200).json({ success: false, error: 'CJ auth failed', products: [] });

      const searchRes = await fetch(
        `https://developers.cjdropshipping.com/api2.0/v1/product/list?keyword=${encodeURIComponent(keyword)}&pageNum=1&pageSize=10`,
        { headers: { 'CJ-Access-Token': cjToken } }
      );
      const searchData = await searchRes.json();

      return res.status(200).json({
        success:  true,
        products: (searchData.data?.list || []).map(p => ({
          id:       p.pid,
          name:     p.productName,
          cost:     parseFloat(p.sellPrice),
          image:    p.productImage,
          category: p.categoryName,
          supplier: 'CJDropshipping',
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── AliExpress: Search products ──────────────────────────
  if (action === 'ali_search') {
    try {
      const { keyword } = req.body;
      const aliKey = process.env.ALIEXPRESS_API_KEY;
      if (!aliKey) return res.status(200).json({ success: false, error: 'No AliExpress API key', products: [] });

      const searchRes = await fetch(
        `https://aliexpress-datahub.p.rapidapi.com/item_search_2?q=${encodeURIComponent(keyword)}&page=1`,
        { headers: { 'X-RapidAPI-Key': aliKey, 'X-RapidAPI-Host': 'aliexpress-datahub.p.rapidapi.com' } }
      );
      const data = await searchRes.json();

      return res.status(200).json({
        success:  true,
        products: (data.result?.resultList || []).slice(0,10).map(p => ({
          id:       p.item?.itemId,
          name:     p.item?.title,
          cost:     parseFloat(p.item?.sku?.def?.promotionPrice || 0),
          image:    p.item?.image,
          supplier: 'AliExpress',
          orders:   p.item?.trade?.realTradedCount || 0,
          rating:   p.item?.evaluation?.starRating || 0,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
};
