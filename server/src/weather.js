const LAT = process.env.WEATHER_LAT || "40.7128";
const LON = process.env.WEATHER_LON || "-74.0060";
const LOCATION_NAME = process.env.WEATHER_LOCATION_NAME || "Home";
const UNITS = process.env.WEATHER_UNITS === "celsius" ? "celsius" : "fahrenheit";

// WMO weather interpretation codes -> label + emoji.
const WEATHER_CODES = {
  0: ["Clear sky", "☀️"],
  1: ["Mostly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"],
  57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"],
  67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "❄️"],
  80: ["Light showers", "🌦️"],
  81: ["Showers", "🌧️"],
  82: ["Violent showers", "⛈️"],
  85: ["Snow showers", "🌨️"],
  86: ["Heavy snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm w/ hail", "⛈️"],
  99: ["Thunderstorm w/ hail", "⛈️"],
};

let cache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getWeather() {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  const params = new URLSearchParams({
    latitude: LAT,
    longitude: LON,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
    temperature_unit: UNITS,
    wind_speed_unit: "mph",
    timezone: "auto",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`weather fetch failed: ${res.status}`);
  const data = await res.json();
  const current = data.current || {};
  const [label, icon] = WEATHER_CODES[current.weather_code] || ["Unknown", "❓"];

  cache = {
    locationName: LOCATION_NAME,
    temperature: current.temperature_2m ?? null,
    feelsLike: current.apparent_temperature ?? null,
    humidity: current.relative_humidity_2m ?? null,
    windSpeed: current.wind_speed_10m ?? null,
    precipitation: current.precipitation ?? null,
    condition: label,
    icon,
    units: UNITS === "celsius" ? "C" : "F",
    windUnits: "mph",
    updatedAt: new Date().toISOString(),
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}
