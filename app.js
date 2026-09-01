const API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg5OTBkMGZlYTQ3MjQ0Mzg4Mjk4NjRjMjM2MjZkNGRkIiwiaCI6Im11cm11cjY0In0='; 

// 1. Inicializa o Mapa
const map = L.map('map').setView([-23.5505, -46.6333], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let safeRouteLayer = null;
let fastRouteLayer = null;
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

// 5. Função para consultar a API OpenRouteService
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

// 6. Submissão e Comparação de Rotas
document.getElementById('truck-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('btn-calculate');
  btn.innerText = "Calculando comparativo...";
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

    // Faz as 2 chamadas simultaneamente
    const [safeData, fastData] = await Promise.all([
      fetchRoute('driving-hgv', coordsPair, { height, width, weight }),
      fetchRoute('driving-car', coordsPair)
    ]);

    if (safeData.features && safeData.features.length > 0) {
      const safeSummary = safeData.features[0].properties.summary;
      const fastSummary = fastData.features[0].properties.summary;

      const safeDistKm = (safeSummary.distance / 1000).toFixed(1);
      const safeTimeMin = Math.round(safeSummary.duration / 60);

      const fastDistKm = (fastSummary.distance / 1000).toFixed(1);
      const fastTimeMin = Math.round(fastSummary.duration / 60);

      // Preenche dados no painel
      document.getElementById('dist-val').innerText = safeDistKm;
      document.getElementById('time-val').innerText = safeTimeMin;
      
      document.getElementById('fast-dist-val').innerText = fastDistKm;
      document.getElementById('fast-time-val').innerText = fastTimeMin;

      // Calcula a diferença entre as rotas
      const diffDist = (safeDistKm - fastDistKm).toFixed(1);
      const diffTime = safeTimeMin - fastTimeMin;

      const alertBox = document.getElementById('alert-box');
      if (diffDist > 0.5 || diffTime > 2) {
        document.getElementById('diff-dist').innerText = Math.max(0, diffDist);
        document.getElementById('diff-time').innerText = Math.max(0, diffTime);
        alertBox.classList.remove('hidden');
      } else {
        alertBox.classList.add('hidden');
      }

      document.getElementById('route-info').classList.remove('hidden');

      // Desenha as duas rotas no mapa
      renderRoutesOnMap(safeData, fastData);
    } else {
      alert('Não foi possível calcular a rota com as restrições informadas.');
    }

  } catch (error) {
    console.error(error);
    alert(error.message || 'Erro ao comunicar com a API de rotas.');
  } finally {
    btn.innerText = "Calcular e Comparar Rotas";
    btn.disabled = false;
    selectedOriginCoords = null;
    selectedDestCoords = null;
  }
});

// 7. Renderiza as duas linhas no mapa
function renderRoutesOnMap(safeGeojson, fastGeojson) {
  if (safeRouteLayer) map.removeLayer(safeRouteLayer);
  if (fastRouteLayer) map.removeLayer(fastRouteLayer);

  // Linha Vermelha (Rota Mais Rápida / Sem Restrições)
  fastRouteLayer = L.geoJSON(fastGeojson, {
    style: { color: '#ef4444', weight: 4, opacity: 0.6, dashArray: '8, 8' }
  }).addTo(map);

  // Linha Azul (Rota Segura Caminhão)
  safeRouteLayer = L.geoJSON(safeGeojson, {
    style: { color: '#0284c7', weight: 6, opacity: 0.9 }
  }).addTo(map);

  map.fitBounds(safeRouteLayer.getBounds());
}
