# DashyDashy

A self-hosted, mobile-friendly system dashboard. It shows local weather,
Docker container status, CPU usage/clock speed, memory, disk (HDD) usage,
network throughput, and uptime — all on one screen you can pull up from your
phone.

System metrics are collected the standard way: **Prometheus** scrapes
**node_exporter** running on the host, and a small dashboard server queries
Prometheus (PromQL) and renders the results. Docker container status/stats
come straight from the Docker socket. Weather comes from the free
[Open-Meteo](https://open-meteo.com/) API (no API key required).

## Stack

| Component     | Role                                              |
|---------------|----------------------------------------------------|
| `node-exporter` | Exposes host metrics (CPU, memory, disk, network, load, uptime, CPU frequency) |
| `prometheus`    | Scrapes and stores those metrics, exposes a query API |
| `dashboard`     | Node/Express server: queries Prometheus + Docker + weather, serves the web UI |

## Setup

1. Copy the env file and edit it for your location:

   ```bash
   cp .env.example .env
   ```

   Set `WEATHER_LAT`, `WEATHER_LON`, and `WEATHER_LOCATION_NAME` to your
   location (find coordinates at https://www.latlong.net/). Set
   `DISK_MOUNTPOINTS` to a comma-separated list of mountpoints you want shown
   on the Storage card (defaults to `/`).

2. Build and start everything:

   ```bash
   docker compose up -d --build
   ```

3. Open `http://<your-server-ip>:3000` from any device on your network,
   including your phone. The layout is responsive and works well as a
   pinned mobile browser tab.

## Notes

- **CPU clock speed** relies on node_exporter's `cpufreq` collector reading
  `/sys/devices/system/cpu/*/cpufreq`. Some VMs/cloud hosts and some CPU
  governors don't expose this — if so, the card shows the max frequency
  (or `N/A`) instead of live clock speed. This is a host limitation, not a
  dashboard bug.
- The dashboard mounts `/var/run/docker.sock` read-only to list containers
  and read their live CPU/memory usage. It does not start, stop, or modify
  containers.
- Prometheus data persists in a named volume (`prometheus-data`) with a
  15-day retention window; adjust `--storage.tsdb.retention.time` in
  `docker-compose.yml` if you want longer history.
- Prometheus (`:9090`) and node_exporter (`:9100`) aren't published to the
  host by default — only the dashboard (`:3000`, configurable via
  `DASHBOARD_PORT`) is. Add a `ports:` entry in `docker-compose.yml` if you
  want to query Prometheus directly or hook up Grafana later.
- The web UI polls `/api/all` every 10 seconds; the server itself caches
  Prometheus/Docker/weather lookups for a few seconds so multiple open tabs
  don't cause redundant queries.
