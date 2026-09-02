const API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg5OTBkMGZlYTQ3MjQ0Mzg4Mjk4NjRjMjM2MjZkNGRkIiwiaCI6Im11cm11cjY0In0='; 

// 1. Inicializa o Mapa
const map = L.map('map').setView([-23.5505, -46.6333], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;
let safeRouteLayer = null;
let warningMarkers = [];
let selectedOriginCoords = null;
let selectedDestCoords = null;
let lastSafeData = null; // Armazena a rota de desvio carregada

// 2. Geocoding
async function getCoordinates(locationName) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (data && data.length > 0) {
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } else {
    throw new Error(`Endereço não encontrado: "${locationName}"`);
  }
}

// 3. Autocompletar
function setupAutocomplete(inputId, suggestionsId, onSelect) {
  const input = document.getElementById(inputId);
  const suggestionsBox = document.getElementById(suggestionsId);
  if (!input || !suggestionsBox) return;

  let timeout = null;

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const query = input.value.trim();

    if (query.length < 3) {
      suggestionsBox.innerHTML = '';
      suggestionsBox.classList.add('hidden');
      return;
    }

    timeout = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=br`;
        const res = await fetch(url);
        const results = await res.json();

        suggestionsBox.innerHTML = '';
        if (results.length > 0) {
          suggestionsBox.classList.remove('hidden');
          results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerText = item.display_name;
            div.addEventListener('click', () => {
              input.value = item.display_name;
              suggestionsBox.classList.add('hidden');
              onSelect([parseFloat(item.lon), parseFloat(item.lat)]);
            });
            suggestionsBox.appendChild(div);
          });
        } else {
          suggestionsBox.classList.add('hidden');
        }
      } catch (err) {
        console.error("Erro no autocompletar:", err);
      }
    }, 400);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });
}

// 4. GPS
function pegarLocalizacaoGPS() {
  const btnGps = document.getElementById('btn-gps');
  if (!navigator.geolocation) {
    alert("Seu navegador não suporta geolocalização.");
    return;
  }

  btnGps.innerText = "⏳ Busca...";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      selectedOriginCoords = [lng, lat];

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        document.getElementById('origin').value = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      } catch (e) {
        document.getElementById('origin').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      } finally {
        btnGps.innerText = "📍 GPS";
      }
    },
    (error) => {
      btnGps.innerText = "📍 GPS";
      alert("Erro ao obter GPS.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  setupAutocomplete('origin', 'origin-suggestions', (coords) => { selectedOriginCoords = coords; });
  setupAutocomplete('destination', 'dest-suggestions', (coords) => { selectedDestCoords = coords; });
});

// 5. Chamada à API
async function fetchRoute(profile, coordinates, restrictions = null) {
  const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;
  
  const requestBody = { coordinates };
  if (restrictions) {
    requestBody.options = { profile_params: { restrictions } };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  return await response.json();
}

// 6. Análise Inicial
document.getElementById('truck-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('btn-calculate');
  btn.innerText = "Analisando rota...";
  btn.disabled = true;

  // Limpa desvios anteriores
  if (safeRouteLayer) map.removeLayer(safeRouteLayer);
  document.getElementById('safe-summary').classList.add('hidden');
  document.getElementById('btn-apply-bypass').classList.add('hidden');

  try {
    const height = parseFloat(document.getElementById('height').value);
    const width = parseFloat(document.getElementById('width').value);
    const weight = parseFloat(document.getElementById('weight').value);
    const originText = document.getElementById('origin').value;
    const destText = document.getElementById('destination').value;

    const originCoords = selectedOriginCoords || await getCoordinates(originText);
    const destCoords = selectedDestCoords || await getCoordinates(destText);
    const coordsPair = [originCoords, destCoords];

    const [fastData, safeData] = await Promise.all([
      fetchRoute('driving-car', coordsPair),
      fetchRoute('driving-hgv', coordsPair, { height, width, weight })
    ]);

    lastSafeData = safeData; // Guarda para o botão de acionamento

    if (fastData.features && fastData.features.length > 0) {
      const fastSummary = fastData.features[0].properties.summary;
      document.getElementById('fast-dist-val').innerText = (fastSummary.distance / 1000).toFixed(1);
      document.getElementById('fast-time-val').innerText = Math.round(fastSummary.duration / 60);

      renderFastRoute(fastData);

      const criticalPoints = findCriticalPoints(fastData, safeData);
      plotWarningMarkers(criticalPoints, height, weight);

      const statusCard = document.getElementById('status-card');
      statusCard.classList.remove('hidden', 'alert-warning', 'alert-success');

      if (criticalPoints.length > 0) {
        statusCard.classList.add('alert-warning');
        statusCard.innerHTML = `⚠️ <strong>Atenção!</strong> Foram identificados <strong>${criticalPoints.length} ponto(s) crítico(s)</strong> de restrição na Rota Rápida.`;
        
        // Exibe o botão para aplicar os desvios
        document.getElementById('btn-apply-bypass').classList.remove('hidden');
      } else {
        statusCard.classList.add('alert-success');
        statusCard.innerHTML = `✅ <strong>Rota Livre!</strong> Não foram identificados bloqueios para as dimensões do seu veículo.`;
      }

      document.getElementById('route-info').classList.remove('hidden');
    } else {
      alert('Não foi possível calcular a rota para esses pontos.');
    }

  } catch (error) {
    console.error(error);
    alert(error.message || 'Erro ao processar o diagnóstico.');
  } finally {
    btn.innerText = "Analisar Pontos de Alerta";
    btn.disabled = false;
    selectedOriginCoords = null;
    selectedDestCoords = null;
  }
});

// 7. Evento para Traçar a Rota de Desvio
document.getElementById('btn-apply-bypass').addEventListener('click', () => {
  if (!lastSafeData || !lastSafeData.features) return;

  const safeSummary = lastSafeData.features[0].properties.summary;
  document.getElementById('safe-dist-val').innerText = (safeSummary.distance / 1000).toFixed(1);
  document.getElementById('safe-time-val').innerText = Math.round(safeSummary.duration / 60);
  document.getElementById('safe-summary').classList.remove('hidden');

  // Desenha a linha azul de desvio por cima da rota
  if (safeRouteLayer) map.removeLayer(safeRouteLayer);

  safeRouteLayer = L.geoJSON(lastSafeData, {
    style: { color: '#0284c7', weight: 6, opacity: 0.9 }
  }).addTo(map);

  map.fitBounds(safeRouteLayer.getBounds());
});

// Helper Functions
function findCriticalPoints(fastData, safeData) {
  if (!safeData.features || safeData.features.length === 0) return [];

  const fastCoords = fastData.features[0].geometry.coordinates;
  const safeCoords = safeData.features[0].geometry.coordinates;
  const criticalPoints = [];
  const step = Math.max(1, Math.floor(fastCoords.length / 20));

  for (let i = 0; i < fastCoords.length; i += step) {
    const ptFast = fastCoords[i];
    let minDistance = Infinity;

    for (let j = 0; j < safeCoords.length; j += Math.max(1, Math.floor(safeCoords.length / 100))) {
      const ptSafe = safeCoords[j];
      const dist = Math.hypot(ptFast[0] - ptSafe[0], ptFast[1] - ptSafe[1]);
      if (dist < minDistance) minDistance = dist;
    }

    if (minDistance > 0.003) {
      const isNewArea = criticalPoints.every(p => Math.hypot(p[0] - ptFast[0], p[1] - ptFast[1]) > 0.015);
      if (isNewArea) criticalPoints.push(ptFast);
    }
  }

  return criticalPoints;
}

function renderFastRoute(fastGeojson) {
  if (routeLayer) map.removeLayer(routeLayer);
  
  routeLayer = L.geoJSON(fastGeojson, {
    style: { color: '#ef4444', weight: 5, opacity: 0.7, dashArray: '6, 6' }
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds());
}

function plotWarningMarkers(points, height, weight) {
  warningMarkers.forEach(m => map.removeLayer(m));
  warningMarkers = [];

  points.forEach((pt, index) => {
    const customIcon = L.divIcon({
      className: 'warning-marker',
      html: '⚠️',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([pt[1], pt[0]], { icon: customIcon }).addTo(map);
    marker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 13px;">
        <strong style="color: #dc2626;">⚠️ Ponto Crítico #${index + 1}</strong><br>
        Risco de restrição física (${height}m alt / ${weight}t peso).
      </div>
    `);

    warningMarkers.push(marker);
  });
}
