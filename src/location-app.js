import { LOCATION_PROGRAM } from "./location-program.js";

const $ = selector => document.querySelector(selector);
const button = $("#locate-button");
const status = $("#geo-runtime-status");
const message = $("#geo-message");
const mapStatus = $("#map-status");
const mapEmpty = $("#map-empty");
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAP_ATTRIBUTION = '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>';
const isSecureContext = window.isSecureContext;
const geolocationApiAvailable = "geolocation" in navigator;
const geolocationPolicy = document.permissionsPolicy || document.featurePolicy;
let geolocationPolicyAllows = true;
try {
  if (geolocationPolicy && typeof geolocationPolicy.allowsFeature === "function") {
    geolocationPolicyAllows = geolocationPolicy.allowsFeature("geolocation");
  }
} catch {
  geolocationPolicyAllows = true;
}
const supported = isSecureContext && geolocationApiAvailable && geolocationPolicyAllows;
const worker = new Worker(new URL("./worker.js?v=lume-print-20261101-r2", import.meta.url), { type: "module" });
let moduleReady = false;
let moduleFailed = false;
let requestPending = false;
let pendingPosition = null;
let geoRequestId = 0;
let geoWaitTimer = null;
let mapLibrePromise = null;
let mapLibre = null;
let map = null;
let mapLoaded = false;
let mapViewportReady = false;
let mapErrorShown = false;
let mapViewGeneration = 0;
let mapWaitTimer = null;
let locationMarker = null;
let locationPopupTitle = null;
let locationPopupAccuracy = null;
let pendingMapPosition = null;

function setStatus(text, state = "") {
  status.textContent = text;
  const dot = $("#geo-runtime-dot");
  if (state) dot.dataset.state = state; else delete dot.dataset.state;
}
function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}
function setMapStatus(text, isError = false) {
  mapStatus.textContent = text;
  mapStatus.classList.toggle("is-error", isError);
}
function clearGeoWait() {
  if (geoWaitTimer !== null) window.clearTimeout(geoWaitTimer);
  geoWaitTimer = null;
}
function clearMapWait() {
  if (mapWaitTimer !== null) window.clearTimeout(mapWaitTimer);
  mapWaitTimer = null;
}
function locationAvailabilityMessage() {
  if (!isSecureContext) return "A API HTML5 de localização exige HTTPS ou localhost.";
  if (!geolocationApiAvailable) return "Este navegador não oferece a API de geolocalização HTML5.";
  if (!geolocationPolicyAllows) return "Esta prévia incorporada bloqueia geolocalização. Abra a página publicada em uma aba própria do navegador.";
  return "A geolocalização não está disponível neste contexto do navegador.";
}
function updateButton() {
  button.disabled = !supported || requestPending || moduleFailed;
  $("#button-label").textContent = moduleFailed
    ? "Lume indisponível"
    : !supported ? "Localização indisponível"
      : requestPending ? "Aguardando o navegador…" : "Localizar minha posição";
}
function showFailure(text) {
  clearGeoWait();
  geoRequestId += 1;
  requestPending = false;
  pendingPosition = null;
  updateButton();
  setStatus("localização não obtida", "error");
  setMessage(text, true);
}
function accuracyText(meters) {
  if (!Number.isFinite(meters) || meters < 0) return "Precisão não informada";
  return meters >= 1000 ? `Precisão estimada: ${(meters / 1000).toFixed(1)} km` : `Precisão estimada: ${Math.round(meters)} m`;
}
function sendPositionToLume(position) {
  worker.postMessage({ type: "location", ...position });
  setStatus("Lume classificando a posição…", "busy");
  setMessage("A posição foi recebida; o módulo Lume está calculando o quadrante.");
}
function loadMapLibre() {
  if (!mapLibrePromise) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("../vendor/maplibre-gl/maplibre-gl.css", import.meta.url);
    stylesheet.dataset.maplibre = "true";
    const cssReady = new Promise((resolve, reject) => {
      stylesheet.onload = resolve;
      stylesheet.onerror = () => reject(new Error("A folha de estilos local do MapLibre não carregou."));
    });
    document.head.append(stylesheet);
    mapLibrePromise = Promise.all([
      import("../vendor/maplibre-gl/maplibre-gl.mjs"),
      cssReady,
    ]).then(([module]) => module).catch(error => {
      stylesheet.remove();
      mapLibrePromise = null;
      throw error;
    });
  }
  return mapLibrePromise;
}
function accuracyFeature(latitude, longitude, radiusMeters) {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const earthRadius = 6378137;
  const angularRadius = radiusMeters / earthRadius;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  const coordinates = [];
  for (let index = 0; index <= 64; index += 1) {
    const bearing = 2 * Math.PI * index / 64;
    const destinationLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularRadius)
      + Math.cos(latitudeRadians) * Math.sin(angularRadius) * Math.cos(bearing),
    );
    const destinationLongitude = longitudeRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latitudeRadians),
      Math.cos(angularRadius) - Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
    );
    const longitudeDegrees = destinationLongitude * 180 / Math.PI;
    coordinates.push([((longitudeDegrees + 540) % 360) - 180, destinationLatitude * 180 / Math.PI]);
  }
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [coordinates] },
    }],
  };
}
function updateMapPosition(position) {
  pendingMapPosition = position;
  if (!map || !mapLibre) return;
  const { latitude, longitude, accuracy, quadrant } = position;
  const coordinates = [longitude, latitude];

  if (!locationMarker) {
    const markerElement = document.createElement("div");
    markerElement.className = "user-location-marker";
    markerElement.setAttribute("role", "img");
    markerElement.setAttribute("aria-label", "Sua posição autorizada pelo navegador");
    locationMarker = new mapLibre.Marker({ element: markerElement, anchor: "center" })
      .setLngLat(coordinates)
      .addTo(map);
    const popupContent = document.createElement("div");
    popupContent.className = "map-location-popup";
    locationPopupTitle = document.createElement("strong");
    locationPopupAccuracy = document.createElement("span");
    popupContent.append(locationPopupTitle, locationPopupAccuracy);
    locationMarker.setPopup(new mapLibre.Popup({ offset: 18, closeButton: false }).setDOMContent(popupContent));
  } else {
    locationMarker.setLngLat(coordinates);
  }
  locationPopupTitle.textContent = `Sua posição · ${quadrant}`;
  locationPopupAccuracy.textContent = accuracyText(accuracy);

  if (!mapLoaded) return;
  const sourceId = "lume-position-accuracy";
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "lume-position-accuracy-fill",
      type: "fill",
      source: sourceId,
      paint: { "fill-color": "#ef4444", "fill-opacity": 0.18 },
    });
    map.addLayer({
      id: "lume-position-accuracy-outline",
      type: "line",
      source: sourceId,
      paint: { "line-color": "#b91c1c", "line-width": 2, "line-opacity": 0.9 },
    });
  }
  map.getSource(sourceId).setData(accuracyFeature(latitude, longitude, accuracy));
  mapEmpty.hidden = true;
}
function showMapFailure(text) {
  mapErrorShown = true;
  clearMapWait();
  mapEmpty.hidden = false;
  mapEmpty.textContent = "Não foi possível abrir o mapa OpenFreeMap. A posição e o resultado Lume continuam disponíveis abaixo.";
  setMapStatus(text, true);
}
function showMapTimeout(text) {
  clearMapWait();
  if (mapErrorShown) return;
  mapEmpty.hidden = false;
  mapEmpty.textContent = "O mapa está demorando para responder. A posição e o resultado Lume continuam disponíveis abaixo.";
  setMapStatus(text, true);
}
function watchMapIdle(generation) {
  map.once("idle", () => {
    if (generation !== mapViewGeneration) return;
    mapViewportReady = true;
    clearMapWait();
    if (!mapErrorShown) {
      mapEmpty.hidden = true;
      setMapStatus("Mapa carregado. Arraste para explorar; use Ctrl + rolagem ou os controles para ampliar.");
    }
  });
}
async function updateMap(position) {
  pendingMapPosition = position;
  mapViewGeneration += 1;
  const generation = mapViewGeneration;
  mapViewportReady = false;
  mapErrorShown = false;
  clearMapWait();
  mapEmpty.hidden = false;
  mapEmpty.textContent = "Carregando mapa OpenFreeMap após autorização…";
  setMapStatus("Carregando o estilo e os tiles OpenFreeMap…");
  mapWaitTimer = window.setTimeout(() => {
    if (!mapViewportReady && !mapErrorShown && generation === mapViewGeneration) {
      showMapTimeout("OpenFreeMap ainda está carregando. A posição e a classificação Lume já estão disponíveis; o mapa pode aparecer assim que terminar.");
    }
  }, 35000);

  try {
    mapLibre = await loadMapLibre();
    if (generation !== mapViewGeneration) return;
    const center = [position.longitude, position.latitude];
    if (!map) {
      map = new mapLibre.Map({
        container: "geo-map",
        style: OPENFREEMAP_STYLE,
        center,
        zoom: 14,
        minZoom: 2,
        maxZoom: 19,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: true,
        attributionControl: false,
      });
      map.addControl(new mapLibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new mapLibre.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }), "bottom-right");
      map.on("load", () => {
        mapLoaded = true;
        mapEmpty.hidden = true;
        if (pendingMapPosition) updateMapPosition(pendingMapPosition);
        map.resize();
      });
      map.on("zoomend", () => {
        $("#map-zoom-hint").textContent = `OPENFREEMAP · ZOOM ${map.getZoom().toFixed(1)}`;
      });
      map.on("error", event => {
        if (event && event.error) {
          showMapFailure("OpenFreeMap não carregou parte do mapa. Confira sua conexão; o cálculo Lume continua disponível.");
        }
      });
      updateMapPosition(position);
      watchMapIdle(generation);
    } else {
      map.jumpTo({ center, zoom: 14 });
      if (mapLoaded) updateMapPosition(position);
      watchMapIdle(generation);
    }
    $("#map-zoom-hint").textContent = `OPENFREEMAP · ZOOM ${map.getZoom().toFixed(1)}`;
    requestAnimationFrame(() => map.resize());
  } catch {
    if (generation !== mapViewGeneration) return;
    showMapFailure("Não foi possível iniciar o mapa. Verifique a rede e se o navegador oferece suporte a WebGL; o resultado Lume continua visível.");
  }
}
function showLocation(data) {
  clearGeoWait();
  geoRequestId += 1;
  requestPending = false;
  updateButton();
  const latitude = data.latitude;
  const longitude = data.longitude;
  const quadrants = ["Norte / Leste", "Norte / Oeste", "Sul / Leste", "Sul / Oeste"];
  const quadrant = quadrants[data.quadrant];
  if (!quadrant || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showFailure("O módulo Lume retornou uma posição inválida. Tente novamente.");
    return;
  }

  $("#latitude-value").textContent = `${latitude >= 0 ? "+" : ""}${latitude.toFixed(5)}°`;
  $("#longitude-value").textContent = `${longitude >= 0 ? "+" : ""}${longitude.toFixed(5)}°`;
  $("#quadrant-value").textContent = quadrant;
  $("#accuracy-value").textContent = accuracyText(data.accuracy);
  $("#geo-results").hidden = false;
  void updateMap({ latitude, longitude, accuracy: data.accuracy, quadrant });
  setStatus("posição classificada por Lume/WASM", "ready");
  setMessage("Lume calculou a posição. O navegador agora carrega o mapa da região no OpenFreeMap.");
}
function geolocationError(error) {
  if (error.code === 1) return showFailure("Permissão negada ou bloqueada pelo navegador. Autorize a localização nas configurações do site e tente de novo.");
  if (error.code === 2) return showFailure("O navegador não conseguiu determinar sua posição. Verifique o sensor ou a conexão e tente novamente.");
  if (error.code === 3) return showFailure("A posição não chegou em 15 segundos. Confira a permissão do site, o sinal de localização e se a página está aberta em uma aba normal, não em uma prévia incorporada.");
  showFailure(`Não foi possível obter a localização${error.message ? `: ${error.message}` : ". Tente novamente."}`);
}

worker.onmessage = event => {
  const data = event.data || {};
  if (data.type === "compiled") {
    setStatus(`módulo WASM compilado · ${data.bytes} B`, "busy");
    return;
  }
  if (data.type === "running") {
    setStatus("inicializando a função Lume…", "busy");
    return;
  }
  if (data.type === "done") {
    moduleReady = true;
    moduleFailed = false;
    setStatus("classificador Lume pronto", "ready");
    if (!supported) {
      setMessage(locationAvailabilityMessage(), true);
    } else if (pendingPosition) {
      const position = pendingPosition;
      pendingPosition = null;
      sendPositionToLume(position);
    } else if (!requestPending) {
      setMessage("Clique para solicitar a posição; o navegador perguntará se você permite.");
    }
    updateButton();
    return;
  }
  if (data.type === "location-analyzed") {
    showLocation(data);
    return;
  }
  if (data.type === "error") {
    if (requestPending) return showFailure(`Erro no módulo Lume: ${data.message}`);
    moduleFailed = true;
    updateButton();
    setStatus("erro no módulo Lume", "error");
    setMessage(data.message || "Não foi possível preparar o módulo de localização.", true);
  }
};
worker.onerror = event => {
  moduleFailed = true;
  if (requestPending) return showFailure(event.message || "Falha ao iniciar o Worker Lume.");
  updateButton();
  setStatus("erro no Worker", "error");
  setMessage(event.message || "Falha ao iniciar o Worker Lume.", true);
};

button.addEventListener("click", () => {
  if (moduleFailed || !supported || requestPending) return;
  const requestId = ++geoRequestId;
  requestPending = true;
  updateButton();
  setStatus("aguardando permissão e posição…", "busy");
  setMessage("O navegador pode mostrar uma solicitação de permissão. O aplicativo só pede dados do mapa depois da sua autorização.");
  geoWaitTimer = window.setTimeout(() => {
    if (requestId !== geoRequestId || !requestPending) return;
    showFailure("O navegador não respondeu à solicitação de localização. Verifique se há um aviso de permissão aberto; se estiver numa prévia incorporada, abra a página publicada em uma aba própria.");
  }, 20000);
  try {
    navigator.geolocation.getCurrentPosition(
      position => {
        if (requestId !== geoRequestId || !requestPending) return;
        clearGeoWait();
        const { latitude, longitude, accuracy } = position.coords;
        const coordinates = { latitude, longitude, accuracy };
        if (moduleReady) {
          sendPositionToLume(coordinates);
        } else {
          pendingPosition = coordinates;
          setStatus("posição recebida · preparando Lume…", "busy");
          setMessage("A posição chegou. Ela será passada ao módulo Lume assim que o WebAssembly terminar de carregar.");
        }
      },
      error => {
        if (requestId !== geoRequestId || !requestPending) return;
        clearGeoWait();
        geolocationError(error);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  } catch (error) {
    showFailure(`O navegador bloqueou a solicitação de localização: ${error.message || error}`);
  }
});

setStatus("compilando programa Lume…", "busy");
if (!supported) setMessage(locationAvailabilityMessage(), true);
updateButton();
worker.postMessage({ type: "run", source: LOCATION_PROGRAM });
