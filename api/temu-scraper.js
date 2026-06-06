// ============================================================
// Temu Trend Scraper — Runs every 24hrs via Vercel Cron
// Finds trending Temu products → matches on CJDropshipping
// ============================================================

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Verify cron job or manual trigger
  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.method === 'POST';

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = {
      scrapedAt: new Date().toISOString(),
      temuTrending: [],
      cjMatches: [],
      importedToStore: [],
      errors: [],
    };

    // ── STEP 1: Scrape Temu trending categories ─────────────
    const temuCategories = [
      { url: 'https://www.temu.com/channel/best-sellers.html', category: 'Best Sellers' },
      { url: 'https://www.temu.com/channel/new-arrivals.html', category: 'New Arrivals' },
      { url: 'https://www.temu.com/channel/flash-deals.html',  category: 'Flash Deals'  },
    ];

    for (const cat of temuCategories) {
      try {
        const temuRes = await fetch(cat.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
          },
        });

        if (!temuRes.ok) {
          results.errors.push(`Temu ${cat.category}: HTTP ${temuRes.status}`);
          continue;
        }

        const html = await temuRes.text();

        // Extract product data from Temu's HTML/JSON
        const productPatterns = [
          // Match JSON product data embedded in page
          /"goods_name":"([^"]+)"/g,
          /"title":"([^"]+)"/g,
          /"product_name":"([^"]+)"/g,
        ];

        const pricePatterns = [
          /"price_info":\{"price":(\d+\.?\d*)/g,
          /"original_price":(\d+\.?\d*)/g,
          /"sale_price":(\d+\.?\d*)/g,
        ];

        const foundProducts = [];
        for (const pattern of productPatterns) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(html)) !== null && foundProducts.length < 20) {
            const name = match[1].replace(/\\u[\dA-F]{4}/gi, '').trim();
            if (name.length > 5 && name.length < 100 && !foundProducts.includes(name)) {
              foundProducts.push(name);
            }
          }
          if (foundProducts.length > 0) break;
        }

        // Also extract from Next.js __NEXT_DATA__ if available
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
          try {
            const nextData = JSON.parse(nextDataMatch[1]);
            const products = nextData?.props?.pageProps?.data?.goods_list ||
                           nextData?.props?.pageProps?.goodsList ||
                           nextData?.props?.pageProps?.products || [];

            products.slice(0, 10).forEach(p => {
              const name = p.goods_name || p.name || p.title || '';
              const price = p.price || p.sale_price || p.original_price || 0;
              if (name && !foundProducts.includes(name)) {
                foundProducts.push(name);
                results.temuTrending.push({
                  name,
                  temuPrice: parseFloat(price) || 0,
                  category: cat.category,
                  source: 'temu',
                });
              }
            });
          } catch (parseErr) {
            results.errors.push(`Next.js data parse error: ${parseErr.message}`);
          }
        }

        // Add found products
        foundProducts.slice(0, 10).forEach(name => {
          if (!results.temuTrending.find(p => p.name === name)) {
            results.temuTrending.push({
              name,
              category: cat.category,
              source: 'temu',
              temuPrice: null,
            });
          }
        });

      } catch (err) {
        results.errors.push(`Temu scrape error (${cat.category}): ${err.message}`);
      }
    }

    // ── STEP 2: If scraping blocked, use AI to identify trends ─
    if (results.temuTrending.length < 5) {
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 600,
            messages: [{
              role: 'user',
              content: `You are a dropshipping product researcher. Based on current Temu trending data and e-commerce trends as of 2025, list 15 specific products that are currently trending on Temu and similar platforms. 

Return ONLY a JSON array, no markdown:
[
  {"name": "product name", "category": "category", "estimatedTemuPrice": 9.99, "searchKeyword": "cj search term"},
  ...
]

Focus on: home gadgets, beauty tools, pet accessories, kitchen items, phone accessories, fitness gear, LED lights, organization products. Include specific product names, not generic categories.`
            }],
          }),
        });

        const aiData = await aiRes.json();
        const aiText = aiData.content?.[0]?.text || '[]';
        const aiProducts = JSON.parse(aiText.replace(/```json|```/g, '').trim());

        aiProducts.forEach(p => {
          results.temuTrending.push({
            name: p.name,
            category: p.category,
            temuPrice: p.estimatedTemuPrice,
            searchKeyword: p.searchKeyword,
            source: 'ai-research',
          });
        });

      } catch (aiErr) {
        results.errors.push(`AI trend research error: ${aiErr.message}`);
      }
    }

    // ── STEP 3: Match each Temu product on CJDropshipping ──
    if (process.env.CJ_EMAIL && process.env.CJ_PASSWORD && results.temuTrending.length > 0) {
      try {
        // Get CJ token
        const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: process.env.CJ_EMAIL, password: process.env.CJ_PASSWORD }),
        });
        const tokenData = await tokenRes.json();
        const cjToken = tokenData.data?.accessToken;

        if (cjToken) {
          // Search top 5 trending products on CJ
          const topProducts = results.temuTrending.slice(0, 5);

          for (const product of topProducts) {
            const keyword = product.searchKeyword || product.name;
            const cjSearchRes = await fetch(
              `https://developers.cjdropshipping.com/api2.0/v1/product/list?keyword=${encodeURIComponent(keyword)}&pageNum=1&pageSize=5`,
              { headers: { 'CJ-Access-Token': cjToken } }
            );
            const cjData = await cjSearchRes.json();
            const cjProducts = cjData.data?.list || [];

            if (cjProducts.length > 0) {
              const best = cjProducts[0];
              const cjCost = parseFloat(best.sellPrice) || 0;
              const recommendedSellPrice = parseFloat((cjCost * 2.8).toFixed(2));
              const margin = Math.round(((recommendedSellPrice - cjCost) / recommendedSellPrice) * 100);

              if (margin >= 30) {
                results.cjMatches.push({
                  temuProduct: product.name,
                  temuCategory: product.category,
                  temuPrice: product.temuPrice,
                  cjProductId: best.pid,
                  cjProductName: best.productName,
                  cjCost: cjCost,
                  recommendedSellPrice,
                  margin: margin + '%',
                  cjImage: best.productImage,
                  approved: margin >= 35,
                });
              }
            }
            // Rate limit protection
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (cjErr) {
        results.errors.push(`CJ matching error: ${cjErr.message}`);
      }
    }

    // ── STEP 4: Auto-import approved matches to Shopify ────
    const approved = results.cjMatches.filter(p => p.approved);

    if (approved.length > 0 && process.env.SHOPIFY_ACCESS_TOKEN) {
      const shopifyUrl = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';

      for (const product of approved.slice(0, 3)) {
        try {
          const shopifyProduct = {
            product: {
              title: product.cjProductName,
              body_html: `<p>Trending product — sourced via CJDropshipping. Fast shipping available.</p>`,
              vendor: 'Herb Haze Studios',
              product_type: product.temuCategory || 'General',
              tags: `trending, temu-trend, ${product.temuCategory?.toLowerCase()}, dropship, new`,
              variants: [{
                price: product.recommendedSellPrice?.toString(),
                compare_at_price: (product.recommendedSellPrice * 1.3)?.toFixed(2),
                inventory_management: 'shopify',
                inventory_quantity: 999,
              }],
              status: 'active',
            }
          };

          const shopifyRes = await fetch(`https://${shopifyUrl}/admin/api/2024-01/products.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify(shopifyProduct),
          });

          const shopifyData = await shopifyRes.json();
          if (shopifyData.product) {
            results.importedToStore.push({
              name: product.cjProductName,
              shopifyId: shopifyData.product.id,
              price: product.recommendedSellPrice,
              margin: product.margin,
            });
          }
        } catch (shopifyErr) {
          results.errors.push(`Shopify import error: ${shopifyErr.message}`);
        }
      }
    }

    // ── STEP 5: Save results to Supabase if available ──────
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        await supabase.from('temu_scrapes').insert({
          scraped_at: results.scrapedAt,
          trending_count: results.temuTrending.length,
          cj_matches: results.cjMatches.length,
          imported_count: results.importedToStore.length,
          data: results,
        });
      } catch (dbErr) {
        results.errors.push(`DB save error: ${dbErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        temuProductsFound: results.temuTrending.length,
        cjMatchesFound: results.cjMatches.length,
        importedToShopify: results.importedToStore.length,
        errors: results.errors.length,
      },
      results,
    });

  } catch (err) {
    console.error('[Temu Scraper]', err);
    return res.status(500).json({ error: err.message });
  }
};
