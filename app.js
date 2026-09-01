// Sua API Key do OpenRouteService configurada
const API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijg5OTBkMGZlYTQ3MjQ0Mzg4Mjk4NjRjMjM2MjZkNGRkIiwiaCI6Im11cm11cjY0In0='; 

// 1. Inicializa o Mapa usando Leaflet.js
const map = L.map('map').setView([-23.5505, -46.6333], 7);

// Adiciona as imagens do mapa (OpenStreetMap)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let routeLayer = null;

// 2. Função para converter Nome da Cidade/Endereço em Coordenadas [Lng, Lat]
async function getCoordinates(locationName) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}`;
  
  const response = await fetch(url);
  const data = await response.json();

  if (data && data.length > 0) {
    // Retorna [Longitude, Latitude] como número
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } else {
    throw new Error(`Endereço ou cidade não encontrada: "${locationName}"`);
  }
}

// 3. Evento do Formulário (Ao Clicar ou Dar Enter)
document.getElementById('truck-form').addEventListener('submit', async (e) => {
  e.preventDefault(); // Impede a página de recarregar

  const btn = document.getElementById('btn-calculate');
  btn.innerText = "Calculando rota...";
  btn.disabled = true;

  try {
    // Captura os dados do formulário
    const height = parseFloat(document.getElementById('height').value);
    const width = parseFloat(document.getElementById('width').value);
    const weight = parseFloat(document.getElementById('weight').value);
    const originText = document.getElementById('origin').value;
    const destText = document.getElementById('destination').value;

    // Busca as coordenadas dos nomes digitados
    const originCoords = await getCoordinates(originText);
    const destCoords = await getCoordinates(destText);

    // Endpoint da API do OpenRouteService para veículos pesados (driving-hgv)
    const url = 'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson';

    const requestBody = {
      coordinates: [originCoords, destCoords],
      options: {
        profile_params: {
          restrictions: {
            height: height,
            width: width,
            weight: weight
          }
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
      
      // Exibe Distância e Tempo
      document.getElementById('dist-val').innerText = (summary.distance / 1000).toFixed(1);
      document.getElementById('time-val').innerText = Math.round(summary.duration / 60);
      document.getElementById('route-info').classList.remove('hidden');

      // Desenha a linha no mapa
      renderRouteOnMap(data);
    } else {
      alert('Não foi possível calcular a rota para esses pontos com as restrições informadas.');
    }

  } catch (error) {
    console.error(error);
    alert(error.message || 'Erro ao comunicar com o servidor. Verifique se a chave de API está ativa.');
  } finally {
    btn.innerText = "Calcular Rota Segura";
    btn.disabled = false;
  }
});

// 4. Desenha a rota no mapa
function renderRouteOnMap(geojsonData) {
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  routeLayer = L.geoJSON(geojsonData, {
    style: { color: '#0284c7', weight: 6, opacity: 0.8 }
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds());
}