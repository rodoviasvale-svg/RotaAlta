const API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg5OTBkMGZlYTQ3MjQ0Mzg4Mjk4NjRjMjM2MjZkNGRkIiwiaCI6Im11cm11cjY0In0='; 

// 1. Inicializa o Mapa
const map = L.map('map').setView([-23.5505, -46.6333], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;
let selectedOriginCoords = null;
let selectedDestCoords = null;

// 2. Geocoding Principal
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

// 3. Função de Autocompletar
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

// 4. Função do GPS
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
      alert("Erro ao pegar GPS. Verifique se a localização está permitida no navegador/celular.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Inicializa Autocompletar após o carregamento da página
document.addEventListener('DOMContentLoaded', () => {
  setupAutocomplete('origin', 'origin-suggestions', (coords) => { selectedOriginCoords = coords; });
  setupAutocomplete('destination', 'dest-suggestions', (coords) => { selectedDestCoords = coords; });
});

// 5. Submit do Formulário
document.getElementById('truck-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('btn-calculate');
  btn.innerText = "Calculando rota...";
  btn.disabled = true;

  try {
    const height = parseFloat(document.getElementById('height').value);
    const width = parseFloat(document.getElementById('width').value);
    const weight = parseFloat(document.getElementById('weight').value);
    const originText = document.getElementById('origin').value;
    const destText = document.getElementById('destination').value;

    const originCoords = selectedOriginCoords || await getCoordinates(originText);
    const destCoords = selectedDestCoords || await getCoordinates(destText);

    const url = 'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson';
    const requestBody = {
      coordinates: [originCoords, destCoords],
      options: {
        profile_params: {
          restrictions: { height, width, weight }
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const summary = data.features[0].properties.summary;
      document.getElementById('dist-val').innerText = (summary.distance / 1000).toFixed(1);
      document.getElementById('time-val').innerText = Math.round(summary.duration / 60);
      document.getElementById('route-info').classList.remove('hidden');

      renderRouteOnMap(data);
    } else {
      alert('Não foi possível calcular a rota para esses pontos com as restrições informadas.');
    }

  } catch (error) {
    console.error(error);
    alert(error.message || 'Erro ao calcular a rota.');
  } finally {
    btn.innerText = "Calcular Rota Segura";
    btn.disabled = false;
    selectedOriginCoords = null;
    selectedDestCoords = null;
  }
});

function renderRouteOnMap(geojsonData) {
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  routeLayer = L.geoJSON(geojsonData, {
    style: { color: '#0284c7', weight: 6, opacity: 0.8 }
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds());
}
