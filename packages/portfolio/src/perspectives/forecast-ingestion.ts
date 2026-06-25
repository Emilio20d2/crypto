// ─── Servicio de ingestión de previsiones (Perspectivas) ─────────────────────
// Consulta periódicamente fuentes públicas (RSS, HTTP) para detectar nuevas
// previsiones de precios de activos. NO accede a contenidos de pago.
// NO extrae automáticamente precios de artículos — detecta artículos relevantes
// y los marca para revisión manual.
//
// Logging estándar: [ForecastIngestion] source=X status=Y new=Z items_scanned=N

import * as https from "https";
import * as http from "http";

export interface IngestableSource {
  id: string;
  name: string;
  rssUrl: string | null;
  baseUrl: string;
  method: "rss" | "http" | "manual";
  checkFrequencyHours: number;
  lastCheckedAt: number | null;
  subscriptionRequired: number;
}

export interface IngestResult {
  sourceId: string;
  status: "success" | "error" | "no_change" | "skipped";
  newItems: number;
  itemsScanned: number;
  errorMessage: string | null;
  flaggedTitles: string[];
}

// Palabras clave que sugieren previsión de precio en un artículo
const FORECAST_KEYWORDS = [
  "price target", "price forecast", "price prediction", "by 2025", "by 2026", "by 2027",
  "by 2028", "by 2029", "by 2030", "2030 target", "2030 forecast", "2030 prediction",
  "bull case", "bear case", "base case", "bullish target", "price outlook",
  "analyst forecast", "research report", "$100,000", "$200,000", "$300,000",
  "$500,000", "$1 million", "1m btc", "million dollar bitcoin",
];

const ASSET_KEYWORDS: Record<string, string[]> = {
  bitcoin: ["bitcoin", "btc"],
  ethereum: ["ethereum", "ether", "eth"],
  sui:      ["sui", "sui network"],
};

function containsForecastKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FORECAST_KEYWORDS.some(kw => lower.includes(kw));
}

function detectAssets(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(ASSET_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([assetId]) => assetId);
}

// Tiempo límite para petición HTTP
const FETCH_TIMEOUT_MS = 10_000;

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          resolve(fetchUrl(location));
          return;
        }
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.on("error", reject);
  });
}

// Parser RSS mínimo — extrae títulos y descripciones sin dependencias externas
interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  for (const m of itemMatches) {
    const block = m[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1]
      ?? block.match(/<title>(.*?)<\/title>/i)?.[1] ?? "").trim();
    const link  = (block.match(/<link>(.*?)<\/link>/i)?.[1] ?? "").trim();
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? "").trim();
    const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1]
      ?? block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "").trim();
    if (title || link) items.push({ title, link, pubDate, description: desc });
  }
  return items;
}

// Comprueba si el artículo tiene una fecha de publicación reciente (< 30 días)
function isRecent(pubDateStr: string, nowMs: number, maxDaysOld = 30): boolean {
  if (!pubDateStr) return true; // sin fecha → tratar como reciente
  try {
    const ts = new Date(pubDateStr).getTime();
    if (isNaN(ts)) return true;
    return (nowMs - ts) < maxDaysOld * 24 * 3600 * 1000;
  } catch {
    return true;
  }
}

export async function ingestRssSource(source: IngestableSource, nowMs: number): Promise<IngestResult> {
  if (!source.rssUrl) {
    return { sourceId: source.id, status: "skipped", newItems: 0, itemsScanned: 0, errorMessage: "No RSS URL", flaggedTitles: [] };
  }

  try {
    const xml = await fetchUrl(source.rssUrl);
    const items = parseRssItems(xml);
    const recentItems = items.filter(i => isRecent(i.pubDate, nowMs));

    const flaggedTitles: string[] = [];
    for (const item of recentItems) {
      const text = `${item.title} ${item.description}`;
      if (containsForecastKeyword(text)) {
        const assets = detectAssets(text);
        if (assets.length > 0) {
          flaggedTitles.push(`[${assets.map(a => a.toUpperCase()).join(",")}] ${item.title}`);
        }
      }
    }

    const status = "success";
    console.log(`[ForecastIngestion] source=${source.id} status=${status} new=${flaggedTitles.length} items_scanned=${recentItems.length}`);
    return {
      sourceId: source.id,
      status,
      newItems: flaggedTitles.length,
      itemsScanned: recentItems.length,
      errorMessage: null,
      flaggedTitles,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ForecastIngestion] source=${source.id} status=error message="${msg}"`);
    return { sourceId: source.id, status: "error", newItems: 0, itemsScanned: 0, errorMessage: msg, flaggedTitles: [] };
  }
}

export async function ingestHttpSource(source: IngestableSource, nowMs: number): Promise<IngestResult> {
  if (source.subscriptionRequired) {
    console.log(`[ForecastIngestion] source=${source.id} status=skipped reason=subscription_required`);
    return { sourceId: source.id, status: "skipped", newItems: 0, itemsScanned: 0, errorMessage: null, flaggedTitles: [] };
  }

  try {
    const html = await fetchUrl(source.baseUrl);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const sentences = text.split(/[.!?\n]/).map(s => s.trim()).filter(s => s.length > 20);
    const flagged: string[] = [];
    for (const s of sentences) {
      if (containsForecastKeyword(s) && detectAssets(s).length > 0) {
        flagged.push(s.slice(0, 120));
        if (flagged.length >= 5) break; // límite por fuente
      }
    }
    const status = "success";
    console.log(`[ForecastIngestion] source=${source.id} status=${status} new=${flagged.length} items_scanned=${sentences.length}`);
    return { sourceId: source.id, status, newItems: flagged.length, itemsScanned: sentences.length, errorMessage: null, flaggedTitles: flagged };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ForecastIngestion] source=${source.id} status=error message="${msg}"`);
    return { sourceId: source.id, status: "error", newItems: 0, itemsScanned: 0, errorMessage: msg, flaggedTitles: [] };
  }
}

export async function ingestSource(source: IngestableSource, nowMs: number): Promise<IngestResult> {
  if (source.method === "manual") {
    return { sourceId: source.id, status: "skipped", newItems: 0, itemsScanned: 0, errorMessage: null, flaggedTitles: [] };
  }
  if (source.method === "rss" && source.rssUrl) {
    return ingestRssSource(source, nowMs);
  }
  return ingestHttpSource(source, nowMs);
}

// Verificación de URL: comprueba que una URL de observación responde (HTTP 200)
export async function verifyUrl(url: string): Promise<{ reachable: boolean; statusCode: number | null; errorMessage: string | null }> {
  try {
    const lib = url.startsWith("https") ? https : http;
    return await new Promise((resolve) => {
      const req = lib.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        res.resume(); // consume response
        const reachable = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
        resolve({ reachable, statusCode: res.statusCode ?? null, errorMessage: null });
      });
      req.on("timeout", () => { req.destroy(); resolve({ reachable: false, statusCode: null, errorMessage: "timeout" }); });
      req.on("error", (e) => resolve({ reachable: false, statusCode: null, errorMessage: e.message }));
    });
  } catch (e) {
    return { reachable: false, statusCode: null, errorMessage: e instanceof Error ? e.message : String(e) };
  }
}
