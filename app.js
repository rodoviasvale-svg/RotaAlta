const API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg5OTBkMGZlYTQ3MjQ0Mzg4Mjk4NjRjMjM2MjZkNGRkIiwiaCI6Im11cm11cjY0In0='; 

// 1. Inicializa o Mapa
const map = L.map('map').setView([-23.5505, -46.6333], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;
let warningMarkers = [];
let selectedOriginCoords = null;
let selectedDestCoords = null;

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

// 5. Chamada de Rota à API
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

// 6. Submissão e Mapeamento de Pontos de Alerta
document.getElementById('truck-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('btn-calculate');
  btn.innerText = "Analisando rota...";
  btn.disabled = true;

  try {
    const height = parseFloat(document.getElementById('height').value);
    const width = parseFloat(document.getElementById('width').value);
    const weight = parseFloat(document.getElementById('weight').value);
    const originText = document.getElementById('origin').value;
    const destText = document.getElementById('destination').value;

    const originCoords = selectedOriginCoords || await getCoordinates(originText);
    const destCoords = selectedDestCoords || await getCoordinates(destText);
    const coordsPair = [originCoords, destCoords];

    // Busca a Rota Mais Rápida e a Rota com Filtros de Carga
    const [fastData, safeData] = await Promise.all([
      fetchRoute('driving-car', coordsPair),
      fetchRoute('driving-hgv', coordsPair, { height, width, weight })
    ]);

    if (fastData.features && fastData.features.length > 0) {
      const fastSummary = fastData.features[0].properties.summary;
      const fastDistKm = (fastSummary.distance / 1000).toFixed(1);
      const fastTimeMin = Math.round(fastSummary.duration / 60);

      document.getElementById('fast-dist-val').innerText = fastDistKm;
      document.getElementById('fast-time-val').innerText = fastTimeMin;

      // Desenha a Rota Mais Rápida no Mapa
      renderFastRoute(fastData);

      // Identifica onde a Rota Segura teve que desviar da Rota Rápida
      const criticalPoints = findCriticalPoints(fastData, safeData);
      plotWarningMarkers(criticalPoints, height, weight);

      // Atualiza o painel de status
      const statusCard = document.getElementById('status-card');
      statusCard.classList.remove('hidden', 'alert-warning', 'alert-success');

      if (criticalPoints.length > 0) {
        statusCard.classList.add('alert-warning');
        statusCard.innerHTML = `⚠️ <strong>Atenção!</strong> Foram identificados <strong>${criticalPoints.length} ponto(s) crítico(s)</strong> de restrição física (viaduto/ponte/limite de peso) na Rota Mais Rápida. Verifique os marcadores ⚠️ no mapa.`;
      } else {
        statusCard.classList.add('alert-success');
        statusCard.innerHTML = `✅ <strong>Rota Livre!</strong> A rota mais rápida não apresenta bloqueios críticos para as dimensões informadas (${height}m alt / ${weight}t).`;
      }

      document.getElementById('route-info').classList.remove('hidden');
    } else {
      alert('Não foi possível calcular a rota para os pontos fornecidos.');
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

// 7. Algoritmo para identificar desvios críticos entre a rota rápida e a segura
function findCriticalPoints(fastData, safeData) {
  if (!safeData.features || safeData.features.length === 0) return [];

  const fastCoords = fastData.features[0].geometry.coordinates;
  const safeCoords = safeData.features[0].geometry.coordinates;

  const criticalPoints = [];
  const step = Math.max(1, Math.floor(fastCoords.length / 20)); // Amostragem de pontos ao longo da rota

  for (let i = 0; i < fastCoords.length; i += step) {
    const ptFast = fastCoords[i]; // [lng, lat]

    // Procura o ponto mais próximo na rota de caminhão
    let minDistance = Infinity;
    for (let j = 0; j < safeCoords.length; j += Math.max(1, Math.floor(safeCoords.length / 100))) {
      const ptSafe = safeCoords[j];
      const dist = Math.hypot(ptFast[0] - ptSafe[0], ptFast[1] - ptSafe[1]);
      if (dist < minDistance) minDistance = dist;
    }

    // Se o ponto da rota mais rápida está muito distante da rota segura (desvio > ~300m em graus)
    if (minDistance > 0.003) {
      // Garante distância mínima entre alertas para não poluir o mapa
      const isNewArea = criticalPoints.every(p => Math.hypot(p[0] - ptFast[0], p[1] - ptFast[1]) > 0.015);
      if (isNewArea) {
        criticalPoints.push(ptFast);
      }
    }
  }

  return criticalPoints;
}

// 8. Renderiza a Rota Rápida no mapa
function renderFastRoute(fastGeojson) {
  if (routeLayer) map.removeLayer(routeLayer);
  
  routeLayer = L.geoJSON(fastGeojson, {
    style: { color: '#0284c7', weight: 6, opacity: 0.85 }
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds());
}

// 9. Desenha os Marcadores de Alerta ⚠️
function plotWarningMarkers(points, height, weight) {
  // Limpa marcadores anteriores
  warningMarkers.forEach(m => map.removeLayer(m));
  warningMarkers = [];

  points.forEach((pt, index) => {
    const lat = pt[1];
    const lng = pt[0];

    const customIcon = L.divIcon({
      className: 'warning-marker',
      html: '⚠️',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    
    marker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 13px;">
        <strong style="color: #dc2626;">⚠️ Ponto Crítico #${index + 1}</strong><br>
        Risco de restrição física para seu veículo (Ex: Viaduto baixo < ${height}m ou Ponte com limite de peso < ${weight}t).<br>
        <small style="color: #64748b;">A Rota de Carga evita este trecho.</small>
      </div>
    `);

    warningMarkers.push(marker);
  });
}
