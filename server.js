import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const CATEGORIES = {
  'uk-world': {
    label: 'UK & World',
    prompt: `Search for today's top 4 news stories about UK politics, UK economy, major world events, international politics, and global affairs. Focus on the most significant stories from the last 24 hours.`
  },
  'business': {
    label: 'Business',
    prompt: `Search for today's top 4 business news stories covering M&A deals, company moves, market movements, macroeconomics, earnings, and corporate strategy from the last 24 hours.`
  },
  'luxury-brand': {
    label: 'Luxury & Brand',
    prompt: `Search for today's top 4 news stories about luxury brands including LVMH, Kering, Hermès, Richemont, luxury market trends, high-end hospitality, and premium consumer brands from the last 24 hours.`
  },
  'creative-design': {
    label: 'Creative & Design',
    prompt: `Search for today's top 4 news stories about branding and design industry activity. Focus specifically on work or news from these agencies: Chandelier Creative, Collins, Pentagram, Wolff Olins, Uncommon, Porto Rocha, Koto, Ragged Edge, Franklyn, Mouthwash, DIA. Also include significant branding and design industry news, new campaigns, client wins, leadership moves, and industry commentary from the last 24 hours.`
  },
  'advertising-media': {
    label: 'Advertising & Media',
    prompt: `Search for today's top 4 news stories about advertising and media including WPP, Publicis, Omnicom, IPG, dentsu, adtech developments, streaming services, publishing industry moves, and marketing industry news from the last 24 hours.`
  },
  'culture-trends': {
    label: 'Culture & Trends',
    prompt: `Search for today's top 4 news stories about consumer behaviour shifts, cultural zeitgeist, music industry news, art world developments, fashion industry news, and emerging trends from the last 24 hours.`
  }
};

const OUTPUT_FORMAT = `
Return ONLY a valid JSON array with exactly 4 story objects. No markdown, no explanation, just the raw JSON array starting with [ and ending with ].

[
  {
    "headline": "Max 8 words capturing the story",
    "summary": "Two sentences summarising what happened and how.",
    "why_it_matters": "One sentence on the strategic or commercial significance.",
    "source": "Publication or source name"
  }
]`;

async function fetchBriefing(category) {
  const config = CATEGORIES[category];
  if (!config) throw new Error('Unknown category');

  const userMessage = {
    role: 'user',
    content: `${config.prompt}\n\nFor each story found, provide:\n${OUTPUT_FORMAT}`
  };

  let messages = [userMessage];

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock) throw new Error('No text in response');
      return parseStories(textBlock.text);
    }

    if (response.stop_reason === 'pause_turn') {
      messages = [
        userMessage,
        { role: 'assistant', content: response.content }
      ];
      continue;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (textBlock) return parseStories(textBlock.text);
    throw new Error(`Unexpected stop reason: ${response.stop_reason}`);
  }

  throw new Error('Max iterations reached');
}

function parseStories(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in response');
  const stories = JSON.parse(match[0]);
  if (!Array.isArray(stories)) throw new Error('Response is not an array');
  return stories.map(s => ({
    headline: s.headline || 'Untitled',
    summary: s.summary || '',
    why_it_matters: s.why_it_matters || '',
    source: s.source || 'Unknown'
  }));
}

app.get('/api/briefing/:category', async (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES[category]) {
    return res.status(404).json({ error: 'Unknown category' });
  }
  try {
    const stories = await fetchBriefing(category);
    res.json({ stories, category, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`Error fetching ${category}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', (req, res) => {
  res.json(Object.entries(CATEGORIES).map(([id, { label }]) => ({ id, label })));
});

app.listen(PORT, () => {
  console.log(`The Brief is running at http://localhost:${PORT}`);
});
