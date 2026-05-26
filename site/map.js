(function () {
	'use strict'

	const cfg = window.FREEMAP_CONFIG
	const BZZ_HASH_RE = /^[a-fA-F0-9]{64}([a-fA-F0-9]{64})?$/
	const BZZ_PATH_RE = /^\/bzz\/([a-fA-F0-9]{64}(?:[a-fA-F0-9]{64})?)\//i
	const ZOOM_METADATA_DELAY_MS = 400
	const GEOLOCATION_TIMEOUT_MS = 8000

	const urlParams = new URLSearchParams(window.location.search)
	const DEBUG = urlParams.has('debug')
	const SHOW_ALL_LAYERS = urlParams.has('alllayers')

	function log(...args) {
		if (DEBUG) console.log(...args)
	}

	function isBzzHash(value) {
		return typeof value === 'string' && BZZ_HASH_RE.test(value)
	}

	function isEnsHost(host) {
		if (!host) return false
		const lower = host.toLowerCase()
		return lower.endsWith('.eth') || lower.endsWith('.box')
	}

	const proto = window.location.protocol
	const pathname = window.location.pathname
	const pathMatch = pathname.match(BZZ_PATH_RE)

	let urlServer = cfg.defaultBeeGateway
	if (urlParams.has('bee')) {
		urlServer = urlParams.get('bee')
	} else if (proto === 'bzz:') {
		urlServer = ''
	} else if ((proto === 'http:' || proto === 'https:') && pathMatch) {
		urlServer = ''
	}

	let bzzReference
	let bzzRoot = ''
	if (pathMatch) {
		bzzReference = pathMatch[1]
		bzzRoot = `/bzz/${pathMatch[1]}/`
	} else if (proto === 'bzz:') {
		const host = window.location.hostname
		if (isBzzHash(host)) {
			bzzReference = host
		} else if (isEnsHost(host)) {
			bzzReference = host.toLowerCase()
		}
	}

	function bzzResourceRoot(reference) {
		if (proto === 'bzz:') return `bzz://${reference}/`
		return `${urlServer}/bzz/${reference}/`
	}

	function resourceUrl(reference, path) {
		if (proto === 'bzz:' && isBzzHash(bzzReference) && reference === bzzReference) return path
		return bzzResourceRoot(reference) + path
	}

	function latLonToTileXY(lat, lon, z) {
		const n = 2 ** z
		const x = Math.floor(((lon + 180) / 360) * n)
		const latRad = (lat * Math.PI) / 180
		const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
		return { z, x, y }
	}

	async function layerTilesReachable(reference, z, x, y) {
		const url = resourceUrl(reference, `${z}/${x}/${y}.png`)
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
			return res.ok
		} catch (e) {
			log(`Layer ${reference}: tile probe error`, e)
			return false
		}
	}

	const isMainnet = urlParams.has('mainnet')
	const urlRoots = isMainnet ? cfg.mainnetRoots : cfg.testnetRoots
	const DEFAULT_TILES_REFERENCE = urlRoots[urlRoots.length - 1]

	if (proto === 'file:' && !bzzReference) {
		bzzReference = DEFAULT_TILES_REFERENCE
		bzzRoot = `/bzz/${bzzReference}/`
		urlServer = urlParams.get('bee') || cfg.defaultBeeGateway
	}

	log('location', { href: window.location.href, proto, bzzReference, bzzRoot, urlServer, defaultTiles: DEFAULT_TILES_REFERENCE })

	const defLat = cfg.defaultLat
	const defLon = cfg.defaultLon

	let zoom = 5
	let minZoom = 0
	let maxZoom = 18
	let maxNativeZoom = 18
	let currentLayer

	if (urlParams.has('singlezoom') && !Number.isNaN(+urlParams.get('singlezoom'))) {
		zoom = minZoom = maxZoom = maxNativeZoom = +urlParams.get('singlezoom')
	} else {
		if (urlParams.has('zoom') && !Number.isNaN(+urlParams.get('zoom'))) zoom = +urlParams.get('zoom')
		if (urlParams.has('minzoom') && !Number.isNaN(+urlParams.get('minzoom'))) minZoom = +urlParams.get('minzoom')
		if (urlParams.has('maxzoom') && !Number.isNaN(+urlParams.get('maxzoom'))) {
			maxZoom = +urlParams.get('maxzoom')
			if (maxZoom < maxNativeZoom) maxNativeZoom = maxZoom
		}
		if (urlParams.has('maxnativezoom') && !Number.isNaN(+urlParams.get('maxnativezoom'))) {
			maxNativeZoom = +urlParams.get('maxnativezoom')
		}
	}

	let currentAttribution
	let firstAttribution = true

	function getLocation() {
		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(showPosition, onError, {
				timeout: GEOLOCATION_TIMEOUT_MS,
				maximumAge: 300000,
			})
		} else {
			makeMap(defLat, defLon)
		}
	}

	function showPosition(position) {
		makeMap(position.coords.latitude, position.coords.longitude)
	}

	function onError() {
		makeMap(defLat, defLon)
	}

	function makeMap(lat, lon) {
		let layer
		const mymap = L.map('mapid')
		let zoomMetadataTimer = null

		function updateAttribution(text) {
			if (currentAttribution) mymap.attributionControl.removeAttribution(currentAttribution)
			if (text) mymap.attributionControl.addAttribution(text)
			currentAttribution = text
		}

		function layerLabel(reference, modified) {
			const shortRef = `${reference.slice(0, 8)}…`
			if (!modified) return isMainnet ? shortRef : `${shortRef} ${reference}`
			const date = modified.toISOString().substring(0, 10)
			return isMainnet ? date : `${date} ${reference}`
		}

		async function getLatestModified(url) {
			try {
				const response = await fetch(url)
				if (!response.ok) {
					log(`${url} HTTP ${response.status}`)
					return null
				}
				const obj = await response.json()
				if (obj && obj.latestModified) {
					if (typeof obj.latestModified === 'string') return new Date(obj.latestModified)
					return obj.latestModified
				}
				log(`${url} missing latestModified`, obj)
			} catch (e) {
				log(`${url} error:`, e)
			}
			return null
		}

		function setZoomUpdate(zoomLevel, latestModified) {
			if (zoomLevel === mymap.getZoom() && latestModified != null) {
				updateAttribution(`zoom ${zoomLevel} updated ${latestModified.toISOString().substring(0, 10)}`)
			}
		}

		function getZoomUpdate(zoomLevel) {
			if (!firstAttribution) updateAttribution(`zoom ${zoomLevel}`)
			else {
				window.setTimeout(function () {
					firstAttribution = false
					if (zoomLevel === mymap.getZoom()) updateAttribution(`zoom ${zoomLevel}`)
				}, 1000)
			}

			if (currentLayer !== layer) return

			clearTimeout(zoomMetadataTimer)
			zoomMetadataTimer = window.setTimeout(async function () {
				if (zoomLevel !== mymap.getZoom() || currentLayer !== layer) return
				const ref = layer.reference || DEFAULT_TILES_REFERENCE
				const latestModified = await getLatestModified(resourceUrl(ref, `${zoomLevel}/update.json`))
				if (currentLayer === layer) setZoomUpdate(zoomLevel, latestModified)
			}, ZOOM_METADATA_DELAY_MS)
		}

		const osmAttribution = 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
			'<a href="https://www.ethswarm.org/">Swarm</a>'

		function createTileLayer(tileTemplate, reference, modified) {
			const options = {
				id: modified ? modified.toISOString() + ' ' + reference : reference,
				minZoom,
				maxZoom,
				maxNativeZoom,
				attribution: osmAttribution,
			}
			const created = (minZoom === maxZoom && maxZoom === maxNativeZoom)
				? L.tileLayer(tileTemplate, options)
				: L.tileLayer.fallback(tileTemplate, options)
			created.reference = reference
			if (modified) created.latestUpdated = modified
			return created
		}

		layer = createTileLayer(
			resourceUrl(DEFAULT_TILES_REFERENCE, '{z}/{x}/{y}.png'),
			DEFAULT_TILES_REFERENCE
		)
		layer.addTo(mymap)
		currentLayer = layer

		mymap.on('zoomend', function () { getZoomUpdate(mymap.getZoom()) })
		mymap.setView([lat, lon], zoom)

		async function addLayers() {
			const layerControl = L.control.layers(null, null, {
				collapsed: true,
				hideSingleBase: false,
				position: 'topright',
			})
			layerControl.addTo(mymap)
			mymap.on('baselayerchange', function (e) {
				currentLayer = e.layer
				layer = e.layer
				getZoomUpdate(mymap.getZoom())
			})

			const defaultUpdated = await getLatestModified(resourceUrl(DEFAULT_TILES_REFERENCE, `${maxNativeZoom}/update.json`))
			layerControl.addBaseLayer(layer, layerLabel(DEFAULT_TILES_REFERENCE, defaultUpdated))

			async function getLayerModified(reference) {
				let modified = await getLatestModified(resourceUrl(reference, `${maxNativeZoom}/update.json`))
				if (modified != null) return modified
				for (let z = maxNativeZoom - 1; z >= 8; z--) {
					modified = await getLatestModified(resourceUrl(reference, `${z}/update.json`))
					if (modified != null) return modified
				}
				return null
			}

			function shouldSkipHistorical(reference, latestModified) {
				if (reference === DEFAULT_TILES_REFERENCE) return true
				if (!isMainnet || latestModified == null || defaultUpdated == null) return false
				return latestModified.toISOString().substring(0, 10) === defaultUpdated.toISOString().substring(0, 10)
			}

			const probe = latLonToTileXY(lat, lon, Math.min(zoom, maxNativeZoom))
			const historical = urlRoots.filter((ref) => ref !== DEFAULT_TILES_REFERENCE)
			await Promise.all(historical.map(async (reference) => {
				const reachable = await layerTilesReachable(reference, probe.z, probe.x, probe.y)
				if (!reachable) {
					if (SHOW_ALL_LAYERS) log(`Layer ${reference}: tiles unavailable (listed via alllayers)`)
					else {
						log(`Layer ${reference}: hidden (tiles not on this node)`)
						return
					}
				}
				const latestModified = await getLayerModified(reference)
				if (latestModified == null && DEBUG) log(`Layer ${reference}: no update.json`)
				if (shouldSkipHistorical(reference, latestModified)) return
				let label = layerLabel(reference, latestModified)
				if (SHOW_ALL_LAYERS && !reachable) label += ' (unavailable)'
				const historicalLayer = createTileLayer(
					resourceUrl(reference, '{z}/{x}/{y}.png'),
					reference,
					latestModified
				)
				layerControl.addBaseLayer(historicalLayer, label)
			}))
		}

		addLayers()
		window.setTimeout(function () { getZoomUpdate(mymap.getZoom()) }, 500)
	}

	if (urlParams.has('lat') && !Number.isNaN(+urlParams.get('lat')) && urlParams.has('lon') && !Number.isNaN(+urlParams.get('lon'))) {
		makeMap(+urlParams.get('lat'), +urlParams.get('lon'))
	} else {
		getLocation()
	}
})()
