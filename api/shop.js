// ============================================================
// Herb Haze AI — Supplier & Shopify Integration
// Handles: CJDropshipping, AliExpress, Spocket, Shopify
// ============================================================

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, product, orderId, supplier } = req.body;

  // ── Shopify: Create product listing ──────────────────────
  if (action === 'shopify_create_product') {
    try {
      const shopifyUrl = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';
      const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

      if (!shopifyToken) {
        return res.status(200).json({
          success: false,
          error: 'Add SHOPIFY_ACCESS_TOKEN to Vercel environment variables',
          instructions: [
            '1. Go to your Shopify admin → Settings → Apps and sales channels',
            '2. Click "Develop apps" → Create an app',
            '3. Configure Admin API scopes: write_products, write_orders, read_orders',
            '4. Install app → copy Admin API access token',
            '5. Add to Vercel: SHOPIFY_ACCESS_TOKEN=shpat_...',
          ]
        });
      }

      const shopifyProduct = {
        product: {
          title: product.name,
          body_html: `<p>${product.description}</p>`,
          vendor: 'Herb Haze Studios',
          product_type: product.niche || 'General',
          tags: (product.tags || []).join(', '),
          variants: [{
            price: product.sellPrice?.toString(),
            compare_at_price: (product.sellPrice * 1.3)?.toFixed(2),
            inventory_management: 'shopify',
            inventory_quantity: 999,
          }],
          status: 'active',
        }
      };

      const res2 = await fetch(`https://${shopifyUrl}/admin/api/2024-01/products.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shopifyToken,
        },
        body: JSON.stringify(shopifyProduct),
      });

      const data = await res2.json();
      if (data.product) {
        return res.status(200).json({
          success: true,
          productId: data.product.id,
          productUrl: `https://${shopifyUrl}/products/${data.product.handle}`,
          adminUrl: `https://${shopifyUrl}/admin/products/${data.product.id}`,
        });
      }
      return res.status(200).json({ success: false, error: data.errors, raw: data });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── CJDropshipping: Search products ──────────────────────
  if (action === 'cj_search') {
    try {
      const { keyword, page = 1 } = req.body;

      // Get CJ access token first
      const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.CJ_EMAIL,
          password: process.env.CJ_PASSWORD,
        }),
      });
      const tokenData = await tokenRes.json();

      if (!tokenData.data?.accessToken) {
        return res.status(200).json({
          success: false,
          error: 'CJ login failed. Add CJ_EMAIL and CJ_PASSWORD to Vercel env vars.',
          fallback: true,
        });
      }

      const token = tokenData.data.accessToken;
      const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?keyword=${encodeURIComponent(keyword)}&pageNum=${page}&pageSize=20`, {
        headers: { 'CJ-Access-Token': token },
      });
      const searchData = await searchRes.json();

      return res.status(200).json({
        success: true,
        products: (searchData.data?.list || []).map(p => ({
          id: p.pid,
          name: p.productName,
          cost: parseFloat(p.sellPrice),
          image: p.productImage,
          category: p.categoryName,
          supplier: 'CJDropshipping',
        })),
      });

    } catch (err) {
      return res.status(200).json({ success: false, error: err.message, fallback: true });
    }
  }

  // ── CJDropshipping: Create order ─────────────────────────
  if (action === 'cj_create_order') {
    try {
      const { shopifyOrder, cjProductId } = req.body;

      // Get token
      const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.CJ_EMAIL, password: process.env.CJ_PASSWORD }),
      });
      const tokenData = await tokenRes.json();
      const token = tokenData.data?.accessToken;
      if (!token) return res.status(200).json({ success: false, error: 'CJ auth failed' });

      // Create order
      const orderRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
        body: JSON.stringify({
          orderNumber: shopifyOrder.id?.toString(),
          shippingZip: shopifyOrder.shipping_address?.zip,
          shippingCountryCode: shopifyOrder.shipping_address?.country_code,
          shippingCountry: shopifyOrder.shipping_address?.country,
          shippingProvince: shopifyOrder.shipping_address?.province,
          shippingCity: shopifyOrder.shipping_address?.city,
          shippingAddress: shopifyOrder.shipping_address?.address1,
          shippingCustomerName: shopifyOrder.shipping_address?.name,
          shippingPhone: shopifyOrder.shipping_address?.phone || '0000000000',
          products: [{ vid: cjProductId, quantity: 1 }],
          logisticName: 'CJPacket',
          remark: `Herb Haze Studios Order #${shopifyOrder.id}`,
        }),
      });

      const orderData = await orderRes.json();
      return res.status(200).json({
        success: orderData.result,
        cjOrderId: orderData.data?.orderId,
        message: orderData.message,
      });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── AliExpress: Search products (via RapidAPI) ────────────
  if (action === 'ali_search') {
    try {
      const { keyword } = req.body;
      const aliKey = process.env.ALIEXPRESS_API_KEY;

      if (!aliKey) {
        return res.status(200).json({
          success: false,
          error: 'Add ALIEXPRESS_API_KEY to Vercel env vars',
          instructions: ['1. Go to rapidapi.com', '2. Search "AliExpress Data"', '3. Subscribe to free tier', '4. Copy API key', '5. Add to Vercel as ALIEXPRESS_API_KEY'],
          fallback: true,
        });
      }

      const searchRes = await fetch(`https://aliexpress-datahub.p.rapidapi.com/item_search_2?q=${encodeURIComponent(keyword)}&page=1`, {
        headers: {
          'X-RapidAPI-Key': aliKey,
          'X-RapidAPI-Host': 'aliexpress-datahub.p.rapidapi.com',
        },
      });
      const data = await searchRes.json();

      return res.status(200).json({
        success: true,
        products: (data.result?.resultList || []).slice(0,10).map(p => ({
          id: p.item?.itemId,
          name: p.item?.title,
          cost: parseFloat(p.item?.sku?.def?.promotionPrice || p.item?.sku?.def?.price || 0),
          image: p.item?.image,
          supplier: 'AliExpress',
          orders: p.item?.trade?.realTradedCount || 0,
          rating: p.item?.evaluation?.starRating || 0,
        })),
      });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Shopify: Get orders ───────────────────────────────────
  if (action === 'shopify_get_orders') {
    try {
      const shopifyUrl = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';
      const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

      if (!shopifyToken) return res.status(200).json({ success: false, error: 'No Shopify token', orders: [] });

      const ordersRes = await fetch(`https://${shopifyUrl}/admin/api/2024-01/orders.json?status=open&limit=20`, {
        headers: { 'X-Shopify-Access-Token': shopifyToken },
      });
      const data = await ordersRes.json();

      return res.status(200).json({
        success: true,
        orders: (data.orders || []).map(o => ({
          id: o.id,
          name: o.name,
          total: o.total_price,
          customer: o.shipping_address?.name,
          status: o.fulfillment_status || 'unfulfilled',
          createdAt: o.created_at,
          lineItems: o.line_items?.map(li => ({ name: li.name, quantity: li.quantity, price: li.price })),
        })),
      });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
};
