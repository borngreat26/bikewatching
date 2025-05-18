// map.js (Steps 1.1 → 6.2)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3       from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// 1. Your Mapbox public token
mapboxgl.accessToken = 'pk.eyJ1IjoiYm9ybmdyZWF0NiIsImEiOiJjbWFzd2pobWswcGszMmxxN3oweW5zZzJzIn0.RAun8Mv7ckk34ukyUxilEQ';

// 2. Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style:     'mapbox://styles/mapbox/streets-v12',
  center:    [-71.09415, 42.36027],
  zoom:      12,
  minZoom:    5,
  maxZoom:   18,
});

// helper: convert Date → minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// helper: format slider‐time for display
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

map.on('load', async () => {
  // 3. Add bike‐lane layers
  const bikeLaneStyle = {
    'line-color':   '#32D400',
    'line-width':    5,
    'line-opacity':  0.6
  };
  map.addSource('boston_route', {
    type: 'geojson',
    data:
      'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id:    'boston-lanes',
    type:  'line',
    source:'boston_route',
    paint: bikeLaneStyle,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/resource/9aey-9g9p.geojson',
  });
  map.addLayer({
    id:    'cambridge-lanes',
    type:  'line',
    source:'cambridge_route',
    paint: bikeLaneStyle,
  });

  // 4. Load station list + traffic
  const jsonData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );

  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at   = new Date(trip.ended_at);
      return trip;
    }
  );

  // 5. Prepare stations array
  let stations = jsonData.data.stations.map(st => ({
    ...st,
    arrivals:     0,
    departures:   0,
    totalTraffic: 0
  }));

  // helper: compute arrivals/departures counts
  function computeStationTraffic(stations, tripsSubset) {
    const arr = d3.rollup(
      tripsSubset,
      v => v.length,
      d => d.end_station_id
    );
    const dep = d3.rollup(
      tripsSubset,
      v => v.length,
      d => d.start_station_id
    );
    return stations.map(st => {
      const id = st.short_name;
      st.arrivals     = arr.get(id)   ?? 0;
      st.departures   = dep.get(id)   ?? 0;
      st.totalTraffic = st.arrivals + st.departures;
      return st;
    });
  }

  // helper: filter trips by ±60 min of the slider
  function filterTripsByTime(trips, minute) {
    if (minute === -1) return trips;
    return trips.filter(t => {
      const s = minutesSinceMidnight(t.started_at);
      const e = minutesSinceMidnight(t.ended_at);
      return Math.abs(s - minute) <= 60 || Math.abs(e - minute) <= 60;
    });
  }

  // compute initial totals & radius scale
  stations = computeStationTraffic(stations, trips);
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  // ▶ STEP 6.1: quantize scale for three discrete flow‐levels
  const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  // 5. Draw initial circles (with departure‐ratio CSS var)
  const svg = d3.select('#map svg');
  const circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill-opacity', 0.6)
      .attr('stroke',       'white')
      .attr('stroke-width', 1)
      .style('--departure-ratio', d =>
        stationFlow(d.departures / d.totalTraffic)
      )
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (` +
            `${d.departures} dep, ${d.arrivals} arr)`
          );
      });

  // project to screen coords
  function updatePositions() {
    circles
      .attr('cx', d => map.project([+d.lon, +d.lat]).x)
      .attr('cy', d => map.project([+d.lon, +d.lat]).y);
  }
  map.on('move',    updatePositions);
  map.on('zoom',    updatePositions);
  map.on('resize',  updatePositions);
  map.on('moveend', updatePositions);
  updatePositions();

  // ▶ STEP 5.2: wire up the time‐slider
  const timeSlider   = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    let filteredStations = stations;

    if (timeFilter === -1) {
      selectedTime.textContent    = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent    = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
      const subset = filterTripsByTime(trips, timeFilter);
      filteredStations = computeStationTraffic(jsonData.data.stations, subset);
    }

    // ▶ STEP 6.1: update radius & departure‐ratio on every circle
    circles
      .data(filteredStations, d => d.short_name)
      .join('circle')
        .attr('r', d => {
          if (timeFilter === -1) radiusScale.range([0, 25]);
          else                    radiusScale.range([3, 50]);
          return radiusScale(d.totalTraffic);
        })
        .style('--departure-ratio', d =>
          stationFlow(d.departures / d.totalTraffic)
        );

    updatePositions();
  }

  updateTimeDisplay();
  timeSlider.addEventListener('input', updateTimeDisplay);
}); // end map.on('load')
