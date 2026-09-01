# DashyDashy

A self-hosted, mobile-friendly system dashboard. It shows local weather,
Docker container status, CPU usage/clock speed, CPU/GPU/drive temperatures,
memory, disk (HDD) usage, network throughput, and uptime — all on one screen
you can pull up from your phone.

System metrics are collected the standard way: **Prometheus** scrapes
**node_exporter** running on the host, and a small dashboard server queries
Prometheus (PromQL) and renders the results. Docker container status/stats
come straight from the Docker socket. Weather comes from the free
[Open-Meteo](https://open-meteo.com/) API (no API key required). **Grafana**
sits alongside it, pre-wired to the same Prometheus, for deeper historical
graphs and dashboard editing beyond what the single-screen mobile view shows.

## Stack

| Component       | Role                                              |
|------------------|---------------------------------------------------|
| `node-exporter`  | Exposes host metrics (CPU, memory, disk, network, load, uptime, CPU frequency) |
| `prometheus`     | Scrapes and stores those metrics, exposes a query API |
| `dashboard`      | Node/Express server: queries Prometheus + Docker + weather, serves the mobile-friendly web UI |
| `grafana`        | Prometheus datasource + a provisioned "DashyDashy Overview" dashboard, ready on first boot |

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
   pinned mobile browser tab. A "Grafana ↗" link in the header opens Grafana
   directly.

## Grafana

Grafana is available at `http://<your-server-ip>:3001` (configurable via
`GRAFANA_PORT`). On first boot it's already provisioned with:

- A **Prometheus** datasource pointing at the `prometheus` service — no
  manual setup.
- A **DashyDashy Overview** dashboard (folder "DashyDashy") with CPU usage,
  load average, memory usage, CPU frequency/core count, network traffic, and
  disk usage per mount — the same metrics as the mobile dashboard, but with
  history and zoom.

Default login is `admin` / `admin` (from `GRAFANA_ADMIN_USER` /
`GRAFANA_ADMIN_PASSWORD` in `.env`) — **change these** before exposing
Grafana beyond your own network; Grafana will prompt you to set a new
password on first login unless you change the env vars instead. For an even
deeper view of node_exporter metrics, import the community
[Node Exporter Full dashboard](https://grafana.com/grafana/dashboards/1860)
(ID `1860`) via **Dashboards → New → Import** and point it at the
`Prometheus` datasource — it isn't provisioned by default since it's a large
third-party JSON file, but works out of the box against this stack.

## Temperatures

The Temperatures card reads `node_exporter`'s `hwmon` collector, which is
enabled by default and already has host `/sys` access via the existing mount
— no extra config needed for CPU temps (and, on many rigs, GPU/drive temps
too):

- **CPU**: shown as the highest of the matched core/package sensors (e.g.
  `coretemp` on Intel, `k10temp`/`zenpower` on AMD Ryzen).
- **GPU**: AMD GPUs report through the same `hwmon` path (`amdgpu`/`radeon`)
  with zero setup. **NVIDIA** GPUs don't expose temps via `hwmon` under the
  proprietary driver, so they need the optional `nvidia-gpu-exporter`
  service (wraps `nvidia-smi`), gated behind a Compose profile so it doesn't
  break stacks without an NVIDIA card:

  ```bash
  docker compose --profile gpu-nvidia up -d
  ```

  This requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  installed on the host. Without it (or without an NVIDIA GPU), just omit
  the `--profile gpu-nvidia` flag — the dashboard still works, it just won't
  have an NVIDIA reading.
- **Drives** (NVMe) and any other sensor (motherboard, chipset, Wi-Fi card,
  etc.) show up in a compact list below the CPU/GPU headline numbers.

Sensor chip names vary a lot across motherboards, so the CPU/GPU
classification is regex-based and overridable via `TEMP_CPU_CHIP_REGEX` /
`TEMP_GPU_CHIP_REGEX` in `.env` if the defaults misclassify something on
your hardware. To find your actual chip names, query Prometheus directly:

```bash
curl -s 'http://<server-ip>:9090/api/v1/query?query=node_hwmon_chip_names' | python3 -m json.tool
```

(temporarily add a `ports: ["9090:9090"]` entry to the `prometheus` service
if you haven't already exposed it — see the note below).

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
  host by default — only the dashboard (`:3000`) and Grafana (`:3001`) are,
  both configurable via `DASHBOARD_PORT`/`GRAFANA_PORT`. Add a `ports:` entry
  in `docker-compose.yml` for `prometheus` if you want to query it directly.
- The web UI polls `/api/all` every 10 seconds; the server itself caches
  Prometheus/Docker/weather lookups for a few seconds so multiple open tabs
  don't cause redundant queries.
