#!/usr/bin/env node
/**
 * FreeMap smoke test: site is served and Bee returns tiles for the default manifest.
 *
 * Prerequisites (start in two terminals):
 *   npm run serve
 *   bee start   # gateway on :1633
 *
 * Usage:
 *   npm test
 *   SITE_URL=http://127.0.0.1:8766 BEE_URL=http://127.0.0.1:1633 node test.mjs
 */

const SITE_URL = (process.env.SITE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '')
const BEE_URL = (process.env.BEE_URL || 'http://127.0.0.1:1633').replace(/\/$/, '')

const SAMPLE_TILE = {
	z: 5,
	x: 16,
	y: 10,
}

async function fetchStatus(url, init) {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
	return { url, status: res.status, ok: res.ok, body: res.ok ? await res.text() : await res.text() }
}

function fail(message) {
	console.error(`FAIL: ${message}`)
	process.exit(1)
}

function pass(message) {
	console.log(`ok  ${message}`)
}

async function main() {
	console.log(`site ${SITE_URL}`)
	console.log(`bee  ${BEE_URL}`)
	console.log()

	// 1. Site shell
	const index = await fetchStatus(`${SITE_URL}/`)
	if (!index.ok) {
		fail(`site not reachable (${index.status}). Run: npm run serve`)
	}
	if (!index.body.includes('id="mapid"') || !index.body.includes('config.js')) {
		fail('index.html missing mapid or config.js')
	}
	pass('index.html')

	for (const file of ['config.js', 'map.js', 'leaflet.js']) {
		const r = await fetchStatus(`${SITE_URL}/${file}`)
		if (!r.ok) fail(`${file} returned ${r.status}`)
		pass(file)
	}

	// 2. Tile manifest from config.js
	const config = await fetchStatus(`${SITE_URL}/config.js`)
	const rootMatch = config.body.match(/tileRoot:\s*'([a-fA-F0-9]{64})'/)
	if (!rootMatch) fail('could not parse tileRoot from config.js')

	const tileRoot = rootMatch[1]
	pass(`tile manifest ${tileRoot.slice(0, 8)}…`)

	// 3. Bee tile
	const { z, x, y } = SAMPLE_TILE
	const tileUrl = `${BEE_URL}/bzz/${tileRoot}/${z}/${x}/${y}.png`
	const tile = await fetch(`${tileUrl}`, { signal: AbortSignal.timeout(60_000) })
	if (!tile.ok) {
		fail(`tile ${tile.status} from Bee — is the node running? ${tileUrl}`)
	}
	const bytes = (await tile.arrayBuffer()).byteLength
	if (bytes < 100) fail(`tile too small (${bytes} bytes)`)
	pass(`tile ${z}/${x}/${y}.png (${bytes} bytes)`)

	console.log()
	console.log('PASS')
}

main().catch((err) => {
	console.error('FAIL:', err.message)
	process.exit(1)
})
