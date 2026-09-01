import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSystemMetrics } from "./prometheus.js";
import { getContainers } from "./docker.js";
import { getWeather } from "./weather.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Small helper cache so several browser tabs polling at once don't each
// trigger their own round trip to Prometheus / the Docker socket.
function withCache(fn, ttlMs) {
  let value = null;
  let expiresAt = 0;
  let pending = null;
  return async () => {
    if (value && Date.now() < expiresAt) return value;
    if (pending) return pending;
    pending = fn()
      .then((result) => {
        value = result;
        expiresAt = Date.now() + ttlMs;
        return result;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

// System/Docker are cheap to re-fetch and benefit from staying current
// second-to-second; weather doesn't change that fast (and weather.js itself
// already holds a 10-minute cache in front of the actual Open-Meteo call).
const cachedSystemMetrics = withCache(getSystemMetrics, 1000);
const cachedContainers = withCache(getContainers, 1000);
const cachedWeather = withCache(getWeather, 30000);

app.get("/api/system", async (_req, res) => {
  try {
    res.json(await cachedSystemMetrics());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/docker", async (_req, res) => {
  try {
    res.json(await cachedContainers());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/weather", async (_req, res) => {
  try {
    res.json(await cachedWeather());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/all", async (_req, res) => {
  const [system, docker, weather] = await Promise.allSettled([
    cachedSystemMetrics(),
    cachedContainers(),
    cachedWeather(),
  ]);

  res.json({
    system: system.status === "fulfilled" ? system.value : null,
    systemError: system.status === "rejected" ? system.reason.message : null,
    docker: docker.status === "fulfilled" ? docker.value : null,
    dockerError: docker.status === "rejected" ? docker.reason.message : null,
    weather: weather.status === "fulfilled" ? weather.value : null,
    weatherError: weather.status === "rejected" ? weather.reason.message : null,
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/config", (_req, res) => {
  res.json({ grafanaPort: Number(process.env.GRAFANA_PORT) || 3001 });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`DashyDashy listening on port ${PORT}`);
});
