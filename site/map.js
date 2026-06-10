(function () {
	'use strict'

	const cfg = window.FREEMAP_CONFIG
	const BZZ_HASH_RE = /^[a-fA-F0-9]{64}([a-fA-F0-9]{64})?$/
	const BZZ_PATH_RE = /^(.*?)\/bzz\/([a-fA-F0-9]{64}(?:[a-fA-F0-9]{64})?)\//i
	const ZOOM_METADATA_DELAY_MS = 400
	const GEOLOCATION_TIMEOUT_MS = 8000

	const urlParams = new URLSearchParams(window.location.search)
	const DEBUG = urlParams.has('debug')

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

	function isLocalHost(host) {
		if (!host) return false
		const lower = host.toLowerCase()
		return lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0' || lower.endsWith('.local')
	}

	const proto = window.location.protocol
	const pathname = window.location.pathname
	const host = window.location.hostname
	const pathMatch = pathname.match(BZZ_PATH_RE)

	let bzzGatewayBase = cfg.defaultBeeGateway
	if (urlParams.has('bee')) {
		bzzGatewayBase = (urlParams.get('bee') || '').replace(/\/$/, '')
	} else if (proto === 'bzz:') {
		bzzGatewayBase = ''
	} else if ((proto === 'http:' || proto === 'https:') && pathMatch) {
		bzzGatewayBase = pathMatch[1] || ''
	} else if ((proto === 'http:' || proto === 'https:') && !isLocalHost(host)) {
		bzzGatewayBase = (cfg.defaultPublicGateway || '').replace(/\/$/, '')
	}

	let bzzReference
	let bzzRoot = ''
	if (pathMatch) {
		bzzReference = pathMatch[2]
		bzzRoot = `${pathMatch[1]}/bzz/${pathMatch[2]}/`
	} else if (proto === 'bzz:') {
		if (isBzzHash(host)) {
			bzzReference = host
		} else if (isEnsHost(host)) {
			bzzReference = host.toLowerCase()
		}
	}

	function bzzResourceRoot(reference) {
		if (proto === 'bzz:') return `bzz://${reference}/`
		return `${bzzGatewayBase}/bzz/${reference}/`
	}

	function resourceUrl(reference, path) {
		if (proto === 'bzz:' && isBzzHash(bzzReference) && reference === bzzReference) return path
		return bzzResourceRoot(reference) + path
	}

	const TILE_ROOT = cfg.tileRoot

	if (proto === 'file:' && !bzzReference) {
		bzzReference = TILE_ROOT
		bzzRoot = `/bzz/${bzzReference}/`
		bzzGatewayBase = (urlParams.get('bee') || cfg.defaultBeeGateway || '').replace(/\/$/, '')
	}

	log('location', { href: window.location.href, proto, host, bzzReference, bzzRoot, bzzGatewayBase, tileRoot: TILE_ROOT })

	const defLat = cfg.defaultLat
	const defLon = cfg.defaultLon

	let zoom = 5
	let minZoom = 0
	let maxZoom = 18
	let maxNativeZoom = 18

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
		const mymap = L.map('mapid')
		let zoomMetadataTimer = null

		function updateAttribution(text) {
			if (currentAttribution) mymap.attributionControl.removeAttribution(currentAttribution)
			if (text) mymap.attributionControl.addAttribution(text)
			currentAttribution = text
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

			clearTimeout(zoomMetadataTimer)
			zoomMetadataTimer = window.setTimeout(async function () {
				if (zoomLevel !== mymap.getZoom()) return
				const latestModified = await getLatestModified(resourceUrl(TILE_ROOT, `${zoomLevel}/update.json`))
				setZoomUpdate(zoomLevel, latestModified)
			}, ZOOM_METADATA_DELAY_MS)
		}

		const osmAttribution = 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
			'<a href="https://www.ethswarm.org/">Swarm</a>'

		const tileTemplate = resourceUrl(TILE_ROOT, '{z}/{x}/{y}.png')
		const tileOptions = {
			id: TILE_ROOT,
			minZoom,
			maxZoom,
			maxNativeZoom,
			attribution: osmAttribution,
		}
		const layer = (minZoom === maxZoom && maxZoom === maxNativeZoom)
			? L.tileLayer(tileTemplate, tileOptions)
			: L.tileLayer.fallback(tileTemplate, tileOptions)
		layer.addTo(mymap)

		mymap.on('zoomend', function () { getZoomUpdate(mymap.getZoom()) })
		mymap.setView([lat, lon], zoom)

		window.setTimeout(function () { getZoomUpdate(mymap.getZoom()) }, 500)
	}

	if (urlParams.has('lat') && !Number.isNaN(+urlParams.get('lat')) && urlParams.has('lon') && !Number.isNaN(+urlParams.get('lon'))) {
		makeMap(+urlParams.get('lat'), +urlParams.get('lon'))
	} else {
		getLocation()
	}
})()
