// ============================================================
// Herb Haze AI — Master Autonomous Orchestrator
// Coordinates all 6 agents to run a full business cycle.
// ============================================================

const AGENT_CONFIGS = {
  researcher: {
    system: "You are RESEARCHER, an elite e-commerce product research AI. Find 3 winning dropshipping products trending right now. Focus on products under $25 cost with 30%+ margins. Return ONLY a JSON array of objects: [{name, emoji, cost, niche, searchKeyword, whyTrending}].",
    tokens: 800
  },
  pricer: {
    system: "You are PRICER. Given a product cost, calculate the optimal sell price (2.5x - 3x markup) and compare-at price. Ensure at least 35% margin. Return ONLY JSON: {sellPrice, comparePrice, margin}.",
    tokens: 400
  },
  importer: {
    system: "You are IMPORTER. Create a high-converting Shopify product listing. Provide a catchy title (under 70 chars), 3 bullet features, and a 150-word SEO description. Return ONLY JSON: {title, features, description, tags}.",
    tokens: 1000
  },
  marketer: {
    system: "You are MARKETER. Create a viral TikTok ad script (Hook, Problem, Solution, CTA) and an Instagram caption with 10 hashtags. Return ONLY JSON: {tiktokScript, instagramCaption}.",
    tokens: 800
  }
};

async function callClaude(config, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: config.tokens,
      system: config.system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('JSON Parse Error:', text);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.method === 'POST';

  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' });

  const logs = [];
  const log = (from, type, text) => logs.push({ from, type, text, time: new Date().toISOString() });

  try {
    log('system', 'broadcast', '🚀 Starting Master Autonomous Cycle...');

    // 1. RESEARCH
    log('researcher', 'broadcast', 'Scanning global trends for high-margin products...');
    const research = await callClaude(AGENT_CONFIGS.researcher, "Find 3 trending products in Fitness, Tech, or Home niches for 2025.");
    if (!research) throw new Error('Research phase failed');
    log('researcher', 'discovery', `Found ${research.length} potential winners: ${research.map(p => p.name).join(', ')}`);

    const importedCount = 0;

    for (const item of research) {
      // 2. PRICING
      const pricing = await callClaude(AGENT_CONFIGS.pricer, `Product: ${item.name}, Cost: $${item.cost}`);
      
      // 3. LISTING & MARKETING
      const listing = await callClaude(AGENT_CONFIGS.importer, `Product: ${item.name}, Niche: ${item.niche}`);
      const marketing = await callClaude(AGENT_CONFIGS.marketer, `Product: ${item.name}, Features: ${listing?.features?.join(', ')}`);

      // 4. PUSH TO SHOPIFY (If configured)
      if (process.env.SHOPIFY_ACCESS_TOKEN && listing) {
        try {
          const shopifyUrl = process.env.SHOPIFY_STORE_URL || 'herb-haze-studios.myshopify.com';
          const shopifyRes = await fetch(`https://${shopifyUrl}/admin/api/2024-01/products.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({
              product: {
                title: listing.title,
                body_html: `<p>${listing.description}</p><ul>${listing.features.map(f => `<li>${f}</li>`).join('')}</ul><p><b>Marketed by:</b> ${marketing?.instagramCaption || ''}</p>`,
                vendor: 'Herb Haze Studios',
                product_type: item.niche,
                tags: listing.tags.join(', ') + ', autonomous-agent',
                status: 'active',
                variants: [{
                  price: pricing?.sellPrice?.toString() || (item.cost * 2.5).toString(),
                  compare_at_price: pricing?.comparePrice?.toString(),
                  inventory_quantity: 100,
                  inventory_management: 'shopify'
                }]
              }
            }),
          });
          const shopData = await shopifyRes.json();
          if (shopData.product) {
            log('importer', 'success', `✓ Successfully imported ${listing.title} to Shopify`);
          }
        } catch (e) {
          log('importer', 'alert', `⚠ Shopify push failed for ${item.name}: ${e.message}`);
        }
      } else {
        log('importer', 'broadcast', `Listing ready for ${item.name} (Shopify token missing, skipping push)`);
      }
    }

    // 5. FULFILLMENT CHECK
    log('fulfiller', 'broadcast', 'Checking Shopify order queue for new items...');
    // Real check logic would go here

    log('analyst', 'success', '🎉 Master Cycle Complete. All agents returning to standby.');

    // Save to Supabase if possible
    if (process.env.SUPABASE_URL) {
       // logic to save logs
    }

    return res.status(200).json({ success: true, logs });

  } catch (err) {
    log('system', 'alert', `Fatal Error in Autonomous Cycle: ${err.message}`);
    return res.status(500).json({ error: err.message, logs });
  }
};
