<p align="center">
  <img src="site/favicon.svg" alt="FreeMap" width="96" />
</p>

# FreeMap

Viewer shell for [Swarm](https://www.ethswarm.org/)-hosted OpenStreetMap tiles. Open it via `bzz://` in any capable browser or through a [Bee](https://docs.ethswarm.org) gateway.

**Live:** `bzz://freemap.eth/`

This repository ships only the **app shell** (~220 KB). Map tiles stay on existing Swarm manifests listed in `site/config.js`.

## Quick start (local)

From the repository root:

1. Run a Bee node on `http://127.0.0.1:1633`.
2. Serve the site:

```bash
npm run serve
```

3. Open [http://127.0.0.1:8766/?debug=1&lat=51.49&lon=0.01&zoom=5](http://127.0.0.1:8766/?debug=1&lat=51.49&lon=0.01&zoom=5)

Tiles load from Bee on port 1633, not from the static server on 8766.

### Smoke test

Node 18+, with Bee and `npm run serve` running. No `npm install` required.

```bash
npm run serve   # terminal 1 (repo root)
npm test        # terminal 2 (repo root)
```

Override endpoints: `SITE_URL=http://127.0.0.1:8766 BEE_URL=http://127.0.0.1:1633 npm test`

## Query parameters

| Parameter | Description |
|-----------|-------------|
| `lat`, `lon` | Initial map center (skips geolocation) |
| `zoom`, `minzoom`, `maxzoom`, `maxnativezoom`, `singlezoom` | Zoom levels |
| `bee` | Bee gateway URL for off-gateway hosting (default `http://127.0.0.1:1633` for local dev, `https://api.gateway.ethswarm.org` for public ENS gateways) |
| `debug` | Log diagnostics to the console |

## Tile gateway resolution

The viewer picks where to fetch tiles based on how it was loaded:

- `bzz://…/` (Swarm-aware browser) — `bzz://<tileRoot>/…`
- `https://<gateway>/[<prefix>/]bzz/<shellHash>/` — same gateway and prefix
- Other public hosts (e.g. ENS gateways) — falls back to `defaultPublicGateway` (`https://api.gateway.ethswarm.org`)
- `http://localhost:*` / `http://127.0.0.1:*` — `defaultBeeGateway` (`http://127.0.0.1:1633`)
- `?bee=<url>` overrides any of the above

## Deploy to Swarm

From the repository root:

1. Buy or obtain a postage batch on your Bee node ([upload docs](https://docs.ethswarm.org/docs/develop/upload-and-download/)).
2. Upload `site/` (shell only; tiles stay on existing manifests):

```bash
export BEE_URL=http://127.0.0.1:1633
export SWARM_POSTAGE_BATCH_ID=<your-batch-id>
cd site && tar -cf - . | curl -fsS -X POST \
  -H "Swarm-Postage-Batch-Id: $SWARM_POSTAGE_BATCH_ID" \
  -H "Content-Type: application/x-tar" \
  -H "Swarm-Index-Document: index.html" \
  --data-binary @- \
  "$BEE_URL/bzz?dir=true"
```

3. Note the `reference` in the JSON response — your `bzz://` root hash.
4. Optional: pin on your node for faster repeat access: `curl -X POST "$BEE_URL/pins/<reference>"` ([Bee API](https://docs.ethswarm.org/api/)).

## Point an ENS name

Set your name's **contenthash** to the uploaded Swarm reference (`eip1577` / `bzz://<64-char-hash>`). Resolvers then serve:

- `bzz://freemap.eth/` (this deployment)
- `bzz://yourname.eth/`
- `https://<gateway>/bzz/<hash>/`

After each shell update, upload again and update the contenthash.

## Project layout

```
site/                             # Swarm upload root
  index.html                      # Index document
  favicon.svg, favicon.png, favicon.ico
  config.js                       # Tile manifest references (FREEMAP_CONFIG)
  map.js                          # Viewer logic
  leaflet.js, leaflet.css         # Leaflet 1.9.4
  images/                         # Leaflet marker assets
  leaflet.tilelayer.fallback.js
test.mjs                          # Smoke test (npm test)
package.json                      # serve + test scripts
```

## Provenance

Derived from the community Swarm OSM map viewer originally authored by [`ldeffenb`](https://github.com/ldeffenb), who built the underlying tile manifests on Swarm. Tile data remains content-addressed on Swarm, independent of this shell.

## License

MIT — see [`LICENSE`](./LICENSE). Third-party libraries: [`NOTICE`](./NOTICE).
